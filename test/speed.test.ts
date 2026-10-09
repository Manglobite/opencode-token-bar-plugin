import { describe, expect, test } from "bun:test"
import { appendDelta, formatSpeed, rowKey, speed, SpeedTracker, CHARS_PER_TOKEN, SPEED_WINDOW_MS, type DeltaEntry } from "../src/speed"
import { createPeakPersistence, PEAK_KEY, PEAK_ROOTS_MAX, type KVStore } from "../src/persistence"

function memoryKV(): KVStore {
  const store = new Map<string, unknown>()
  return {
    get: (key, fallback) => (store.has(key) ? store.get(key) : fallback) as never,
    set: (key, value) => void store.set(key, value),
  }
}

describe("row identity", () => {
  test("separates agents that share a model", () => {
    expect(rowKey("primary", "p1", "m1")).not.toBe(rowKey("sub", "p1", "m1"))
  })

  test("separates the same model across providers", () => {
    expect(rowKey("primary", "p1", "m1")).not.toBe(rowKey("primary", "p2", "m1"))
  })
})

describe("streaming speed", () => {
  test("is zero without samples", () => {
    expect(speed([], 10_000)).toBe(0)
  })

  test("converts characters to tokens over the elapsed span", () => {
    const entries: DeltaEntry[] = [
      { t: 0, chars: 40 },
      { t: 1_000, chars: 40 },
    ]
    // 80 chars over 1s span -> 80 / 1 / 4 = 20 t/s
    expect(speed(entries, 1_000)).toBe(20)
  })

  test("ignores samples older than the window", () => {
    expect(speed([{ t: 0, chars: 4_000 }], SPEED_WINDOW_MS + 1)).toBe(0)
  })

  test("floors the span at one second to avoid first-chunk spikes", () => {
    const entries: DeltaEntry[] = [{ t: 9_999, chars: 4 }]
    expect(speed(entries, 10_000)).toBe(1)
  })
})

describe("speed regressions", () => {
  test("does not inflate speed when the oldest window sample expires", () => {
    const entries = [{ t: 0, chars: 400 }, { t: 2_000, chars: 400 }]
    expect(speed(entries, 2_999)).toBe(200 / 2.999)
    expect(speed(entries, 3_001)).toBe(100 / 3)
  })

  test("uses a half-open window for a steady stream", () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({ t: index * 1_000, chars: 40 }))
    expect(speed(entries, 3_000)).toBe(10)
    expect(speed(entries, 4_000)).toBe(10)
    expect(speed(entries, 7_000)).toBe(0)
  })

  test("does not count deltas from the future", () => {
    expect(speed([{ t: 1_001, chars: 400 }], 1_000)).toBe(0)
  })
})

describe("stream lifecycle", () => {
  test("captures a short burst before the render timer and retains its peak on idle", () => {
    const peaks = new Map<string, number>()
    const tracker = new SpeedTracker((sessionID, key, value) => peaks.set(`${sessionID}:${key}`, value))
    tracker.bind("s", "m", "row")
    tracker.append("s", "m", "a".repeat(400), 100)
    tracker.clear("s")
    expect(tracker.current("s", 200)).toBe(0)
    expect(peaks.get("s:row")).toBe(100)
  })

  test("associates delayed metadata with the exact message rather than history order", () => {
    const peaks = new Map<string, number>()
    const tracker = new SpeedTracker((_, key, value) => peaks.set(key, value))
    tracker.append("s", "new", "a".repeat(400), 100)
    tracker.bind("s", "old", "old-row")
    expect(peaks.size).toBe(0)
    tracker.bind("s", "new", "new-row")
    expect(peaks.get("new-row")).toBe(100)
  })

  test("does not combine successive messages or models", () => {
    const peaks = new Map<string, number>()
    const tracker = new SpeedTracker((_, key, value) => peaks.set(key, value))
    tracker.bind("s", "first", "first-row")
    tracker.bind("s", "second", "second-row")
    tracker.append("s", "first", "a".repeat(400), 100)
    tracker.append("s", "second", "a".repeat(40), 200)
    expect(tracker.current("s", 200)).toBe(10)
    expect(peaks.get("first-row")).toBe(100)
    expect(peaks.get("second-row")).toBe(10)
  })

  test("isolates concurrent sessions and counts Unicode code points", () => {
    const tracker = new SpeedTracker(() => {})
    tracker.append("a", "m", "\u{1F600}".repeat(40), 100)
    tracker.append("b", "m", "b".repeat(80), 100)
    expect(tracker.current("a", 100)).toBe(10)
    expect(tracker.current("b", 100)).toBe(20)
    tracker.clear("a")
    expect(tracker.current("b", 100)).toBe(20)
  })
})

describe("appendDelta", () => {
  test("retains one anchor when trimming older entries", () => {
    const entries: DeltaEntry[] = [{ t: 0, chars: 1 }, { t: 1, chars: 1 }]
    appendDelta(entries, { t: SPEED_WINDOW_MS * 2 + 2, chars: 1 })
    expect(entries).toHaveLength(2)
    expect(entries[0].t).toBe(1)
    expect(speed(entries, SPEED_WINDOW_MS * 2 + 2)).toBe(1 / 12)
  })
})

describe("formatSpeed", () => {
  test("renders decimals below 100 and integers above", () => {
    expect(formatSpeed(0)).toBe("0.0")
    expect(formatSpeed(-3)).toBe("0.0")
    expect(formatSpeed(12.34)).toBe("12.3")
    expect(formatSpeed(123.4)).toBe("123")
    expect(formatSpeed(Number.NaN)).toBe("0.0")
  })
})

describe("peak persistence", () => {
  test("round-trips the scoped peak map through one shared key", () => {
    const kv = memoryKV()
    const persistence = createPeakPersistence(kv)
    expect(persistence.load("root")).toEqual(new Map())

    const peaks = new Map<string, number>([["a\u0000p\u0000m", 42.5]])
    persistence.save("root", peaks)
    expect(persistence.load("root")).toEqual(peaks)
    expect(typeof kv.get(PEAK_KEY)).toBe("object")
  })

  test("scopes peaks to the session tree", () => {
    const kv = memoryKV()
    const persistence = createPeakPersistence(kv)
    persistence.save("root-a", new Map([["k", 10]]))
    persistence.save("root-b", new Map([["k", 99]]))
    expect(persistence.load("root-a").get("k")).toBe(10)
    expect(persistence.load("root-b").get("k")).toBe(99)
  })

  test("drops malformed stored values", () => {
    const kv = memoryKV()
    const persistence = createPeakPersistence(kv)
    kv.set(PEAK_KEY, { root: { good: 5, bad: "x", negative: -1, nan: Number.NaN } })
    expect(persistence.load("root")).toEqual(new Map([["good", 5]]))
  })

  test("caps the number of retained trees", () => {
    const kv = memoryKV()
    const persistence = createPeakPersistence(kv)
    for (let index = 0; index < PEAK_ROOTS_MAX + 5; index += 1) {
      persistence.save(`root-${index}`, new Map([["k", index]]))
    }
    expect(persistence.load("root-0")).toEqual(new Map())
    expect(persistence.load(`root-${PEAK_ROOTS_MAX + 4}`).get("k")).toBe(PEAK_ROOTS_MAX + 4)
  })

  test("saveAll writes every tree in one pass", () => {
    const kv = memoryKV()
    const persistence = createPeakPersistence(kv)
    persistence.saveAll(
      new Map([
        ["root-a", new Map([["k", 1]])],
        ["root-b", new Map([["k", 2]])],
      ]),
    )
    expect(persistence.load("root-a").get("k")).toBe(1)
    expect(persistence.load("root-b").get("k")).toBe(2)
  })
})

describe("character-to-token constant", () => {
  test("is a positive divisor", () => {
    expect(CHARS_PER_TOKEN).toBeGreaterThan(0)
  })
})
