import { describe, expect, test } from "bun:test"
import { descendants, rootSession } from "../src/session-tree"

const sessions = [
  { id: "root", parentID: undefined },
  { id: "a", parentID: "root" },
  { id: "b", parentID: "a" },
  { id: "c", parentID: "root" },
  { id: "other", parentID: undefined },
]

describe("session tree", () => {
  test("descendants includes root and every transitive child", () => {
    const ids = [...descendants("root", sessions)].sort()
    expect(ids).toEqual(["a", "b", "c", "root"])
  })

  test("rootSession walks up to the topmost ancestor", () => {
    expect(rootSession("b", sessions)).toBe("root")
    expect(rootSession("root", sessions)).toBe("root")
    expect(rootSession("other", sessions)).toBe("other")
  })
})
