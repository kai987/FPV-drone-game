import flightCoreUrl from './generated/flight_core.wasm?url';

let compiled: Promise<WebAssembly.Module> | undefined;

/** Share compiled code between StrictMode mounts, with independent simulation memory. */
export function loadFlightCore(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    const response = await fetch(flightCoreUrl);
    if (!response.ok) throw new Error(`Flight core failed to load (${response.status})`);
    // Static hosts may serve WASM with an incorrect MIME type. The byte fallback
    // uses the exact same Rust module and leaves gameplay behavior unchanged.
    try {
      return await WebAssembly.compileStreaming(response.clone());
    } catch {
      return await WebAssembly.compile(await response.arrayBuffer());
    }
  })().catch(error => { compiled = undefined; throw error; });
  return compiled;
}
