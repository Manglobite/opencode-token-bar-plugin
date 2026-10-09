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
  for (const entry of entries) {
    if (entry.t > now) continue
    oldest = Math.min(oldest, entry.t)
    if (now - entry.t >= SPEED_WINDOW_MS) continue
    chars += entry.chars
  }
  if (chars === 0) return 0
  const span = Math.max(Math.min(now - oldest, SPEED_WINDOW_MS) / 1_000, 1)
  return chars / span / CHARS_PER_TOKEN
}

/** Append a delta and trim entries older than two windows to bound memory. */
export function appendDelta(entries: DeltaEntry[], entry: DeltaEntry): void {
  entries.push(entry)
  const cutoff = entry.t - SPEED_WINDOW_MS * 2
  while (entries.length > 1 && entries[1].t < cutoff) entries.shift()
}

type StreamState = {
  messageID: string
  entries: DeltaEntry[]
  peak: number
  key?: string
}

export class SpeedTracker {
  private streams = new Map<string, StreamState>()
  private identities = new Map<string, Map<string, string>>()

  constructor(private onPeak: (sessionID: string, key: string, value: number) => void) {}

  bind(sessionID: string, messageID: string, key: string): void {
    const identities = this.identities.get(sessionID) ?? new Map<string, string>()
    identities.set(messageID, key)
    while (identities.size > 32) identities.delete(identities.keys().next().value!)
    this.identities.set(sessionID, identities)
    const stream = this.streams.get(sessionID)
    if (stream?.messageID === messageID) {
      stream.key = key
      if (stream.peak > 0) this.onPeak(sessionID, key, stream.peak)
    }
  }

  append(sessionID: string, messageID: string, delta: string, now: number): void {
    if (!delta) return
    let stream = this.streams.get(sessionID)
    if (!stream || stream.messageID !== messageID) {
      stream = { messageID, entries: [], peak: 0 }
      this.streams.set(sessionID, stream)
    }
    appendDelta(stream.entries, { t: now, chars: Array.from(delta).length })
    stream.peak = Math.max(stream.peak, speed(stream.entries, now))
    stream.key ??= this.identities.get(sessionID)?.get(messageID)
    if (stream.key) this.onPeak(sessionID, stream.key, stream.peak)
  }

  current(sessionID: string, now: number): number {
    return speed(this.streams.get(sessionID)?.entries ?? [], now)
  }

  clear(sessionID: string): void {
    this.streams.delete(sessionID)
    this.identities.delete(sessionID)
  }
}
