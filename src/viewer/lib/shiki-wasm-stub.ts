/**
 * Stands in for `shiki/wasm` at build time (vite alias). The viewer pins the
 * JavaScript regex engine, so the oniguruma wasm binary never loads - this
 * keeps its ~600KB chunk out of dist.
 */
export default {};
