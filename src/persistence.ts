import { ActiveTimeTracker, parseActiveTime, restoredActiveTime, type ActiveTime } from "./active-time"

export const EXPANDED_KEY = "session-token-bar.expanded"
export const ACTIVE_TIME_KEY = "session-token-bar.active-time"
export const PEAK_KEY = "session-token-bar.peak"
export const PEAK_ROOTS_MAX = 20

export function activeTimeKey(sessionID: string): string {
  return `${ACTIVE_TIME_KEY}.${sessionID}`
}

export type KVStore = {
  get: <Value = unknown>(key: string, fallback?: Value) => Value
  set: (key: string, value: unknown) => void
}

export type ActiveTimePersistence = {
  load: (sessionID: string) => ActiveTime
  save: (sessionID: string, value: ActiveTime) => void
}

export function createActiveTimePersistence(kv: KVStore): ActiveTimePersistence {
  return {
    load: (sessionID) => restoredActiveTime(kv.get(activeTimeKey(sessionID), { elapsed: 0 })),
    save: (sessionID, value) => kv.set(activeTimeKey(sessionID), value),
  }
}

export type ExpandedPersistence = {
  load: () => boolean
  save: (value: boolean) => void
}

export function createExpandedPersistence(kv: KVStore): ExpandedPersistence {
  return {
    load: () => kv.get(EXPANDED_KEY, false),
    save: (value) => kv.set(EXPANDED_KEY, value),
  }
}

export type PeakPersistence = {
  load: (rootID: string) => Map<string, number>
  save: (rootID: string, peaks: Map<string, number>) => void
  saveAll: (peaksByRoot: Map<string, Map<string, number>>) => void
}

/**
 * Peaks are scoped to a session tree (rootID). All trees share one KV value to
 * avoid creating an ever-growing key per root; at most `PEAK_ROOTS_MAX` trees
 * are kept, least-recently-written first. The in-memory store is cached for the
 * lifetime of the persistence object.
 */
export function createPeakPersistence(kv: KVStore): PeakPersistence {
  let store: Record<string, Record<string, number>> | undefined

  const read = (): Record<string, Record<string, number>> => {
    if (store) return store
    const raw = kv.get(PEAK_KEY, {})
    store = raw && typeof raw === "object" ? (raw as Record<string, Record<string, number>>) : {}
    return store
  }
  const write = (entries: Iterable<[string, Map<string, number>]>) => {
    const current = read()
    for (const [rootID, peaks] of entries) {
      delete current[rootID]
      current[rootID] = Object.fromEntries(peaks)
    }
    const keys = Object.keys(current)
    for (const stale of keys.slice(0, Math.max(0, keys.length - PEAK_ROOTS_MAX))) delete current[stale]
    kv.set(PEAK_KEY, current)
  }

  return {
    load: (rootID) => {
      const loaded = new Map<string, number>()
      const stored = read()[rootID]
      if (stored && typeof stored === "object") {
        for (const [key, value] of Object.entries(stored)) {
          if (typeof value === "number" && Number.isFinite(value) && value > 0) loaded.set(key, value)
        }
      }
      return loaded
    },
    save: (rootID, peaks) => write([[rootID, peaks]]),
    saveAll: (peaksByRoot) => write(peaksByRoot),
  }
}

export { ActiveTimeTracker, parseActiveTime, restoredActiveTime }
export type { ActiveTime }
