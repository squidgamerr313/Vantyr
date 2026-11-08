/** Synchronous duplicate-send and ownership guard; old completions cannot finish a newer request. */
export function createRequestGate() {
  let generation = 0;
  let busy = false;
  return {
    begin() { if (busy) return null; busy = true; return ++generation; },
    current(ticket: number) { return busy && generation === ticket; },
    finish(ticket: number) { if (generation === ticket) busy = false; },
    invalidate() { generation++; busy = false; },
  };
}
