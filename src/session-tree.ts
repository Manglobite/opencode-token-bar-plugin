export type SessionLike = {
  id: string
  parentID?: string
}

export function descendants(root: string, sessions: SessionLike[]): Set<string> {
  const included = new Set([root])
  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (session.parentID && included.has(session.parentID) && !included.has(session.id)) {
        included.add(session.id)
        changed = true
      }
    }
  }
  return included
}

export function rootSession(sessionID: string, sessions: SessionLike[]): string {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  let current = sessionID
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const parent = byID.get(current)?.parentID
    if (!parent) break
    current = parent
  }
  return current
}
