import { ActiveTimeTracker, parseActiveTime, restoredActiveTime, type ActiveTime } from "./active-time"

export const EXPANDED_KEY = "session-token-bar.expanded"
export const ACTIVE_TIME_KEY = "session-token-bar.active-time"

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

export { ActiveTimeTracker, parseActiveTime, restoredActiveTime }
export type { ActiveTime }
