export type ActiveTime = {
  elapsed: number
  started?: number
}

export function parseActiveTime(input: unknown): ActiveTime {
  if (!input || typeof input !== "object") return { elapsed: 0 }
  const value = input as Partial<ActiveTime>
  return {
    elapsed: typeof value.elapsed === "number" ? Math.max(0, value.elapsed) : 0,
    started: typeof value.started === "number" ? value.started : undefined,
  }
}

/**
 * Restore a persisted active time for display. The `started` marker is
 * deliberately dropped: a stale `started` from a previous process would
 * otherwise count the idle downtime between disposal and restoration.
 */
export function restoredActiveTime(input: unknown): ActiveTime {
  const value = parseActiveTime(input)
  return { elapsed: value.elapsed }
}

/**
 * Tracks the accumulated active time for a single session tree. Active time
 * only accrues while the tree is working (busy or retry). Idle downtime is
 * never counted: on disposal the in-progress interval is flushed into
 * `elapsed` and the `started` marker is cleared, so a later restoration
 * resumes from a fresh interval.
 */
export class ActiveTimeTracker {
  private current: ActiveTime

  constructor(initial: ActiveTime = { elapsed: 0 }) {
    this.current = parseActiveTime(initial)
  }

  /** Mark the tree as working. Returns the current state to persist. */
  start(now: number): ActiveTime {
    if (this.current.started === undefined) {
      this.current = { ...this.current, started: now }
    }
    return this.current
  }

  /** Mark the tree as idle, flushing any in-progress interval. */
  stop(now: number): ActiveTime {
    if (this.current.started !== undefined) {
      this.current = { elapsed: this.current.elapsed + now - this.current.started }
    }
    return this.current
  }

  /** Flush any in-progress interval on disposal. */
  dispose(now: number): ActiveTime {
    return this.stop(now)
  }

  /** Current display value: flushed elapsed plus any running portion. */
  display(now: number): number {
    return this.current.elapsed + (this.current.started !== undefined ? now - this.current.started : 0)
  }

  get state(): ActiveTime {
    return this.current
  }
}
