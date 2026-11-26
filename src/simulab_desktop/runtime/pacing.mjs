/** @file Pure host scheduling policy; simulation time is always supplied by the genuine MCU engine. */

/** @brief Compute a bounded host delay without modifying clocks, firmware or MCU cycle budgets.
 * @param options Explicit execution mode, actual simulation microseconds and monotonic host clock/anchor milliseconds.
 * @returns Positive milliseconds only when realtime emulation is ahead; maximum or lagging execution yields immediately.
 */
export function pacingDelay({ mode, simulationMicros, originMicros, wallMs, originWallMs, maximumDelayMs = 50 }) {
  if (mode === "maximum") return 0;
  return Math.max(0, Math.min(maximumDelayMs, (simulationMicros - originMicros) / 1000 - (wallMs - originWallMs)));
}
