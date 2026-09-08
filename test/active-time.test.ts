import { describe, expect, test } from "bun:test"
import { ActiveTimeTracker, parseActiveTime, restoredActiveTime } from "../src/active-time"
import { createActiveTimePersistence, createExpandedPersistence, type KVStore } from "../src/persistence"

function memoryKV(): KVStore {
  const store = new Map<string, unknown>()
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback) as never,
    set: (key, value) => void store.set(key, value),
  }
}

describe("active time persistence", () => {
  test("persists in-progress active interval on disposal", () => {
    const kv = memoryKV()
    const persistence = createActiveTimePersistence(kv)
    const tracker = new ActiveTimeTracker(persistence.load("root"))

    tracker.start(1_000)
    // working for 5s, then disposed
    const saved = tracker.dispose(6_000)
    persistence.save("root", saved)

    expect(saved).toEqual({ elapsed: 5_000, started: undefined })
    expect(persistence.load("root")).toEqual({ elapsed: 5_000 })
  })

  test("active time persists across working -> idle transitions", () => {
    const kv = memoryKV()
    const persistence = createActiveTimePersistence(kv)
    const tracker = new ActiveTimeTracker(persistence.load("root"))

    tracker.start(1_000)
    persistence.save("root", tracker.state)
    tracker.stop(4_000) // worked 3s, now idle
    persistence.save("root", tracker.state)

    expect(tracker.state).toEqual({ elapsed: 3_000, started: undefined })
    expect(persistence.load("root")).toEqual({ elapsed: 3_000 })
  })

  test("active time persists across disposal and recreation", () => {
    const kv = memoryKV()
    const persistence = createActiveTimePersistence(kv)

    // first lifecycle
    const first = new ActiveTimeTracker(persistence.load("root"))
    first.start(1_000)
    persistence.save("root", first.dispose(6_000)) // 5s worked

    // second lifecycle, restored from persisted state
    const second = new ActiveTimeTracker(persistence.load("root"))
    expect(second.state).toEqual({ elapsed: 5_000, started: undefined })
    second.start(10_000)
    persistence.save("root", second.dispose(13_000)) // +3s worked

    expect(persistence.load("root")).toEqual({ elapsed: 8_000, started: undefined })
  })

  test("no idle downtime is counted on restoration", () => {
    const kv = memoryKV()
    const persistence = createActiveTimePersistence(kv)

    // first lifecycle: worked 5s, disposed at t=6s
    const first = new ActiveTimeTracker(persistence.load("root"))
    first.start(1_000)
    persistence.save("root", first.dispose(6_000))

    // idle downtime of 10s passes before restoration
    const second = new ActiveTimeTracker(persistence.load("root"))
    // display at t=16s must NOT include the 10s idle gap
    expect(second.display(16_000)).toBe(5_000)
  })

  test("restoredActiveTime drops a stale started marker", () => {
    const restored = restoredActiveTime({ elapsed: 5_000, started: 1_000 })
    expect(restored).toEqual({ elapsed: 5_000, started: undefined })
  })

  test("parseActiveTime tolerates malformed input", () => {
    expect(parseActiveTime(null)).toEqual({ elapsed: 0 })
    expect(parseActiveTime({ elapsed: -5 })).toEqual({ elapsed: 0 })
    expect(parseActiveTime({ elapsed: 10, started: "x" })).toEqual({ elapsed: 10, started: undefined })
  })
})

describe("expanded persistence", () => {
  test("loads and saves collapsible state", () => {
    const kv = memoryKV()
    const persistence = createExpandedPersistence(kv)
    expect(persistence.load()).toBe(false)
    persistence.save(true)
    expect(persistence.load()).toBe(true)
  })
})
