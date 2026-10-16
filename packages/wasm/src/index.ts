export interface JurfiWasm {
  add(a: number, b: number): number;
}

/** Lazily load the wasm-pack output (packages/wasm/pkg). Requires vite-plugin-wasm. */
export async function loadWasm(): Promise<JurfiWasm> {
  return (await import('@jurfi/wasm/pkg')) as unknown as JurfiWasm;
}
