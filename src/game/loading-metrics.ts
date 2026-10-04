/** Small browser-readable measurements; absent from product UI and the animation loop. */
export function createLoadingMetrics(startedAt = performance.now(), now: () => number = () => performance.now()) {
  const phases: Record<string, { start: number; duration: number }> = {};
  return {
    measure(name: string) {
      const start = now();
      return () => { phases[name] = { start: start - startedAt, duration: now() - start }; };
    },
    record(name: string, start: number, end = now()) {
      phases[name] = { start: start - startedAt, duration: end - start };
    },
    snapshot() {
      return { total: Math.round((now() - startedAt) * 10) / 10,
        phases: Object.fromEntries(Object.entries(phases).map(([name, value]) => [name,
          { start: Math.round(value.start * 10) / 10, duration: Math.round(value.duration * 10) / 10 }])),
      };
    },
  };
}

export type LoadingMetrics = ReturnType<typeof createLoadingMetrics>;
