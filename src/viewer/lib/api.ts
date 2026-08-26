/** Fetches a JSON api route, throwing the server's error message on failure. */
export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
  return res.json();
}
