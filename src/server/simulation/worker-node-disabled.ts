/** Worker builds replace the Node allocator with this fail-closed platform boundary. */
export function newNodeTrialDatabase(): never {
  throw new Error("Workers trials require the isolated SIMULATIONS binding.");
}
