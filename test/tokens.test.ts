import { describe, expect, test } from "bun:test"
import { groupRows, summary, tokens, type AssistantMessageLike } from "../src/tokens"

function assistant(overrides: Partial<AssistantMessageLike>): AssistantMessageLike {
  return {
    role: "assistant",
    agent: "primary",
    providerID: "provider",
    modelID: "vendor/model",
    tokens: { input: 100, output: 20, cache: { read: 40 } },
    ...overrides,
  }
}

describe("tokens aggregation", () => {
  test("groups by exact agent/providerID/modelID tuple", () => {
    const rows = groupRows([
      assistant({ agent: "primary", providerID: "p1", modelID: "m1", tokens: { input: 100, output: 10, cache: { read: 30 } } }),
      assistant({ agent: "primary", providerID: "p1", modelID: "m1", tokens: { input: 200, output: 20, cache: { read: 50 } } }),
      assistant({ agent: "sub", providerID: "p1", modelID: "m1", tokens: { input: 50, output: 5, cache: { read: 0 } } }),
      assistant({ agent: "primary", providerID: "p2", modelID: "m1", tokens: { input: 10, output: 1, cache: { read: 0 } } }),
    ])
    expect(rows).toHaveLength(3)
    const primary = rows.find((row) => row.agent === "primary" && row.model === "m1")
    expect(primary).toMatchObject({ hit: 80, miss: 220, out: 30 })
  })

  test("hit is cache.read, miss is input minus hit, out is output", () => {
    const t = tokens(assistant({ tokens: { input: 100, output: 20, cache: { read: 40 } } }))
    expect(t).toEqual({ hit: 40, miss: 60, out: 20 })
  })

  test("negative cache.read is clamped to zero", () => {
    const t = tokens(assistant({ tokens: { input: 100, output: 20, cache: { read: -5 } } }))
    expect(t).toEqual({ hit: 0, miss: 100, out: 20 })
  })

  test("summary aggregates every row", () => {
    const rows = groupRows([
      assistant({ tokens: { input: 100, output: 10, cache: { read: 30 } } }),
      assistant({ tokens: { input: 200, output: 20, cache: { read: 50 } } }),
    ])
    expect(summary(rows)).toEqual({ hit: 80, miss: 220, out: 30 })
  })

  test("rebuilds the same totals after UI state recreation from message history", () => {
    const history = [
      assistant({ tokens: { input: 100, output: 10, cache: { read: 25 } } }),
      assistant({ agent: "worker", tokens: { input: 80, output: 15, cache: { read: 0 } } }),
    ]

    const firstUiInstance = summary(groupRows(history))
    const recreatedUiInstance = summary(groupRows([...history]))

    expect(recreatedUiInstance).toEqual(firstUiInstance)
    expect(recreatedUiInstance).toEqual({ hit: 25, miss: 155, out: 25 })
  })
})
