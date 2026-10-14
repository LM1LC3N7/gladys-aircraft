// -----------------------------------------------------------------------------
// Fake timers: nothing fires by itself, the test runs what it wants.
// -----------------------------------------------------------------------------

export function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  const add = (kind, fn, ms) => {
    const id = nextId++;
    pending.set(id, { id, kind, fn, ms });
    return id;
  };
  return {
    pending,
    setTimeout: (fn, ms) => add('timeout', fn, ms),
    setInterval: (fn, ms) => add('interval', fn, ms),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    timeouts: () => [...pending.values()].filter((t) => t.kind === 'timeout'),
    intervals: () => [...pending.values()].filter((t) => t.kind === 'interval'),
    /** Run (and remove) every pending timeout once. */
    async runTimeouts() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'timeout')) {
        pending.delete(t.id);
        await t.fn();
      }
    },
    async runIntervals() {
      for (const t of [...pending.values()].filter((t) => t.kind === 'interval')) {
        await t.fn();
      }
    },
  };
}
