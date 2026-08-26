import { createBundledHighlighter, createSingletonShorthands } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export * from "@shikijs/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

/**
 * Stands in for the full `shiki` bundle at build time (vite alias). The full
 * bundle ships every grammar as its own chunk (~10MB of dist); the compare
 * view only diffs prose and schemas, so only these grammars ship. Anything
 * else falls back to unhighlighted text.
 */
export const bundledLanguages = {
  markdown: () => import("@shikijs/langs/markdown"),
  json: () => import("@shikijs/langs/json"),
};

export const bundledThemes = {};

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});

export const { codeToHtml, codeToHast, codeToTokens, getSingletonHighlighter } =
  createSingletonShorthands(createHighlighter);
