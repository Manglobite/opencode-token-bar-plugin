export type DeltaEntry = {
  t: number
  chars: number
}

export const PEAK_WIDTH = 9
export const CHARS_PER_TOKEN = 4
export const SPEED_WINDOW_MS = 3_000
export const PEAK_SAVE_INTERVAL_MS = 2_000

/**
 * Stable identity for a table row. Deliberately separate from the displayed
 * (clipped) agent/model text so peaks survive UI re-renders.
 */
export function rowKey(agent: string, providerID: string, modelID: string): string {
  return `${agent}\u0000${providerID}\u0000${modelID}`
}

export function formatSpeed(tokensPerSecond: number): string {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return "0.0"
  return tokensPerSecond < 100 ? tokensPerSecond.toFixed(1) : tokensPerSecond.toFixed(0)
}

/**
 * Streaming speed in estimated tokens per second over a sliding window.
 * OpenCode only publishes real token counts on `step-finish`, so deltas are
 * counted as characters and converted with `CHARS_PER_TOKEN`. The span is
 * floored at one second to keep the first chunk of a burst from spiking.
 */
export function speed(entries: DeltaEntry[], now: number): number {
  let chars = 0
  let oldest = now
  let count = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (now - entry.t > SPEED_WINDOW_MS) break
    chars += entry.chars
    oldest = entry.t
    count += 1
  }
  if (count === 0) return 0
  const span = Math.max((now - oldest) / 1_000, 1)
  return chars / span / CHARS_PER_TOKEN
}

/** Append a delta and trim entries older than two windows to bound memory. */
export function appendDelta(entries: DeltaEntry[], entry: DeltaEntry): void {
  entries.push(entry)
  const cutoff = entry.t - SPEED_WINDOW_MS * 2
  while (entries.length > 0 && entries[0].t < cutoff) entries.shift()
}
