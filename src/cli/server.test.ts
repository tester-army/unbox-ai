import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeTrace } from "../core/normalize";
import type { RawTrace } from "../core/types";
import { createLiveSource } from "./live";
import { startServer, staticSource } from "./server";

const raw: RawTrace = {
  trace_id: "t1",
  timestamp: "2026-08-25T10:00:00.000Z",
  name: "test",
  total_tokens: { input: 1, output: 1 },
  total_cost: 0,
  events: [
    {
      type: "generation",
      name: "agent",
      model: "test-model",
      provider: "p",
      metrics: { latency: 1, tokens: { input: 1, output: 1 }, cost: 0 },
      messages: [{ role: "user", content: "hi" }],
    },
  ],
};

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

async function serve(source = staticSource([{ raw, trace: normalizeTrace(raw) }])) {
  // a random high port keeps parallel test runs from colliding
  const port = 21000 + Math.floor(Math.random() * 20000);
  const bound = await startServer(source, port);
  servers.push(...bound.servers);
  return { base: `http://127.0.0.1:${bound.port}`, port: bound.port };
}

describe("api routes", () => {
  it("serves the run list and id-addressed traces", async () => {
    const { base } = await serve();
    const list = (await (await fetch(`${base}/api/traces`)).json()) as { id: string }[];
    expect(list).toHaveLength(1);

    const trace = await (await fetch(`${base}/api/trace?id=${list[0]!.id}`)).json();
    expect((trace as { traceId: string }).traceId).toBe("t1");

    expect((await fetch(`${base}/api/trace?id=nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });

  it("resolves raw paths against the addressed trace", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/raw?id=t1&path=${encodeURIComponent("events[0].model")}`);
    expect(((await res.json()) as { value: string }).value).toBe("test-model");
  });

  it("announces the mode over the event stream", async () => {
    const { base } = await serve();
    const res = await fetch(`${base}/api/events`);
    const reader = res.body!.getReader();
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("event: hello");
    expect(frame).toContain('{"live":false}');
    await reader.cancel();
  });
});

describe("request guards", () => {
  it("rejects foreign Hosts (DNS rebinding) and Origins (cross-site)", async () => {
    const { base, port } = await serve();
    // fetch forbids overriding Host, so speak raw http for the rebinding case
    const rebind = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/api/trace", headers: { host: `evil.example:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(rebind).toBe(403);

    const crossSite = await fetch(`${base}/api/trace`, {
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);

    const sameOrigin = await fetch(`${base}/api/trace`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    expect(sameOrigin.status).toBe(200);
  });

  it("exposes notify and clear only on live sources", async () => {
    const { base } = await serve();
    expect((await fetch(`${base}/api/notify`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/api/clear`, { method: "POST" })).status).toBe(404);
  });
});

describe("live mode", () => {
  // must live under cwd - notify rejects paths outside the viewer's workspace
  const dir = join(process.cwd(), ".tmp-vitest-live", ".devtools");
  const dbPath = join(dir, "generations.json");
  afterAll(() => rmSync(join(process.cwd(), ".tmp-vitest-live"), { recursive: true, force: true }));

  function writeDb(runs: number) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      dbPath,
      JSON.stringify({
        runs: Array.from({ length: runs }, (_, i) => ({
          id: `run-${i}`,
          started_at: "2026-08-25T10:00:00.000Z",
          parent_run_id: null,
          parent_step_id: null,
          function_id: null,
        })),
        steps: [],
      }),
    );
  }

  it("ingests notify pings, validates paths, and clears the database", async () => {
    writeDb(1);
    const source = createLiveSource(dbPath);
    source.reload();
    const { base } = await serve(source);

    expect(((await (await fetch(`${base}/api/traces`)).json()) as unknown[]).length).toBe(1);

    writeDb(2);
    const notify = await fetch(`${base}/api/notify`, {
      method: "POST",
      body: JSON.stringify({ event: "run", dbPath }),
    });
    expect(notify.status).toBe(200);
    expect(((await (await fetch(`${base}/api/traces`)).json()) as unknown[]).length).toBe(2);

    const outside = await fetch(`${base}/api/notify`, {
      method: "POST",
      body: JSON.stringify({ dbPath: "/tmp/elsewhere/.devtools/generations.json" }),
    });
    expect(outside.status).toBe(400);

    const cleared = await fetch(`${base}/api/clear`, { method: "POST" });
    expect(cleared.status).toBe(200);
    expect(((await (await fetch(`${base}/api/traces`)).json()) as unknown[]).length).toBe(0);
  });

  it("drops oversized notify bodies without dying", async () => {
    writeDb(1);
    const source = createLiveSource(dbPath);
    const { base } = await serve(source);

    await expect(
      fetch(`${base}/api/notify`, { method: "POST", body: "x".repeat(128 * 1024) }),
    ).rejects.toThrow();
    // the server survives the dropped connection
    expect((await fetch(`${base}/api/traces`)).status).toBe(200);
  });
});
