/** One compiled Rust module, shared by the numerical services of one game. */
export interface RustRuntime {
  readonly memory: WebAssembly.Memory;
  call(name: string, ...args: number[]): number;
  view(pointer: number, length: number): Float64Array;
}

export function createRustRuntime(module: WebAssembly.Module): RustRuntime {
  const legacyQuery = () => { throw new Error('Production Rust services must use native world queries'); };
  const instance = new WebAssembly.Instance(module, {
    env: { surface_height: legacyQuery, obstacle_hit: legacyQuery },
  });
  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('Rust module has no linear memory');
  let calling = false;
  return {
    memory,
    call(name, ...args) {
      const fn = exports[name];
      if (typeof fn !== 'function') throw new Error(`Missing Rust export: ${name}`);
      if (calling) throw new Error('Rust numerical services cannot reenter a call');
      calling = true;
      try { return Number(fn(...args) ?? 0); } finally { calling = false; }
    },
    view(pointer, length) {
      if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer % 8 !== 0
        || !Number.isSafeInteger(length) || length < 0 || pointer + length * 8 > memory.buffer.byteLength) {
        throw new Error('Rust buffer is outside linear memory');
      }
      // Obtain a fresh view: another service may have grown the shared memory.
      return new Float64Array(memory.buffer, pointer, length);
    },
  };
}
