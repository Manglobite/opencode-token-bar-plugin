/**
 * Minimal ambient declarations for the `bun:test` module used by the unit
 * tests. This keeps the repository self-contained and lets `tsc --noEmit`
 * typecheck the test files without requiring the `@types/bun` package.
 */
declare module "bun:test" {
  export interface Expect {
    not: Expect
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toMatchObject: (expected: Record<string, unknown>) => void
    toHaveLength: (length: number) => void
    toBeGreaterThan: (expected: number) => void
  }

  export function expect(received: unknown): Expect
  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
}
