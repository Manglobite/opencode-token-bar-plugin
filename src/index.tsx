/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Message, Session } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  ActiveTimeTracker,
  createActiveTimePersistence,
  createExpandedPersistence,
  createPeakPersistence,
} from "./persistence"
import { groupRows, header, renderRow, summary, formatDuration, type Row } from "./tokens"
import { formatSpeed, rowKey, SpeedTracker, PEAK_SAVE_INTERVAL_MS } from "./speed"
import { descendants, rootSession } from "./session-tree"

type SessionClient = {
  session: {
    list: (input?: Record<string, unknown>) => Promise<unknown>
    messages: (input: { sessionID: string }) => Promise<unknown>
  }
}

type MessageEntry = {
  info: Message
}

const TOGGLE_COLOR = "#6fbf73"

function value(response: unknown): unknown {
  if (!response || typeof response !== "object") return []
  const record = response as Record<string, unknown>
  return record.data ?? record
}

function array(response: unknown): unknown[] {
  const result = value(response)
  return Array.isArray(result) ? result : []
}

function messages(response: unknown): Message[] {
  return array(response).flatMap((entry) => {
    if (entry && typeof entry === "object" && "info" in entry) {
      return [(entry as MessageEntry).info]
    }
    return [entry as Message]
  })
}

function isSession(input: unknown): input is Session {
  return !!input && typeof input === "object" && typeof (input as Session).id === "string"
}

function isAssistant(input: Message): input is Extract<Message, { role: "assistant" }> {
  return input.role === "assistant"
}

const tui: TuiPlugin = async (api) => {
  const [revision, setRevision] = createSignal(0)
  const [clock, setClock] = createSignal(Date.now())
  const [expanded, setExpanded] = createSignal(createExpandedPersistence(api.kv).load())
  const [status, setStatus] = createSignal<Record<string, "busy" | "idle" | "retry">>({})
  const activeTimes = new Map<string, ActiveTimeTracker>()
  const activeTimePersistence = createActiveTimePersistence(api.kv)
  const expandedPersistence = createExpandedPersistence(api.kv)
  const peakPersistence = createPeakPersistence(api.kv)
  const sessionRoots = new Map<string, string>()
  const dirtyPeaks = new Set<string>()
  const peaksByRoot = new Map<string, Map<string, number>>()
  const tracked = new Map<string, number>()
  let lastPeakSaveAt = 0
  const client = api.client as unknown as SessionClient

  // Only sessions belonging to an open panel tree are tracked, so the global
  // event stream does not retain buffers for unrelated sessions.
  const track = (sessionIDs: string[]) => {
    for (const sessionID of sessionIDs) tracked.set(sessionID, (tracked.get(sessionID) ?? 0) + 1)
  }
  const untrack = (sessionIDs: string[]) => {
    for (const sessionID of sessionIDs) {
      const count = (tracked.get(sessionID) ?? 0) - 1
      if (count > 0) tracked.set(sessionID, count)
      else {
        tracked.delete(sessionID)
        streams.clear(sessionID)
        sessionRoots.delete(sessionID)
      }
    }
  }

  const peaksFor = (rootID: string): Map<string, number> => {
    const existing = peaksByRoot.get(rootID)
    if (existing) return existing
    const loaded = peakPersistence.load(rootID)
    peaksByRoot.set(rootID, loaded)
    return loaded
  }
  const savePeaks = () => {
    const now = Date.now()
    if (dirtyPeaks.size === 0 || now - lastPeakSaveAt < PEAK_SAVE_INTERVAL_MS) return
    lastPeakSaveAt = now
    for (const rootID of dirtyPeaks) peakPersistence.save(rootID, peaksFor(rootID))
    dirtyPeaks.clear()
  }
  const streams = new SpeedTracker((sessionID, key, value) => {
    const rootID = sessionRoots.get(sessionID)
    if (!rootID) return
    const peaks = peaksFor(rootID)
    if (value <= (peaks.get(key) ?? 0)) return
    peaks.set(key, value)
    dirtyPeaks.add(rootID)
    savePeaks()
  })

  const refresh = () => setRevision((current) => current + 1)
  const stopMessage = api.event.on("message.updated", (event) => {
    const info = event.properties.info
    if (isAssistant(info) && tracked.has(info.sessionID)) {
      streams.bind(info.sessionID, info.id, rowKey(info.agent, info.providerID, info.modelID))
    }
    refresh()
  })
  const stopPart = api.event.on("message.part.updated", refresh)
  const stopSession = api.event.on("session.created", refresh)
  const stopStatus = api.event.on("session.status", (event) => {
    if (event.properties.status.type !== "busy") streams.clear(event.properties.sessionID)
    setStatus((current) => ({ ...current, [event.properties.sessionID]: event.properties.status.type }))
    refresh()
  })
  const stopDelta = api.event.on("message.part.delta", (event) => {
    if (event.properties.field !== "text") return
    const { sessionID, messageID, delta } = event.properties
    if (!delta || !tracked.has(sessionID)) return
    streams.append(sessionID, messageID, delta, performance.now())
  })
  const forgetSession = (sessionID: string) => {
    streams.clear(sessionID)
  }
  const stopIdle = api.event.on("session.idle", (event) => {
    forgetSession(event.properties.sessionID)
  })
  const stopDeleted = api.event.on("session.deleted", (event) => {
    const sessionID = event.properties.sessionID
    forgetSession(sessionID)
    setStatus((current) => {
      if (!(sessionID in current)) return current
      const next = { ...current }
      delete next[sessionID]
      return next
    })
    activeTimes.delete(sessionID)
    peaksByRoot.delete(sessionID)
    dirtyPeaks.delete(sessionID)
    sessionRoots.delete(sessionID)
  })
  const interval = setInterval(() => {
    savePeaks()
    setClock(Date.now())
  }, 1_000)
  api.lifecycle.onDispose(() => {
    const now = Date.now()
    for (const [sessionID, tracker] of activeTimes) {
      activeTimePersistence.save(sessionID, tracker.dispose(now))
    }
    if (peaksByRoot.size > 0) peakPersistence.saveAll(peaksByRoot)
    stopMessage()
    stopPart()
    stopSession()
    stopStatus()
    stopDelta()
    stopIdle()
    stopDeleted()
    clearInterval(interval)
  })

  api.slots.register({
    slots: {
      session_prompt(ctx, props) {
        const Prompt = api.ui.Prompt
        const Slot = api.ui.Slot
        const [rows, setRows] = createSignal<Row[]>([])
        const [rootID, setRootID] = createSignal(props.session_id)
        const [sessionIDs, setSessionIDs] = createSignal<Set<string>>(new Set([props.session_id]))
        let request = 0
        let initialized = false
        let trackedIds: string[] = [props.session_id]
        track(trackedIds)

        const load = async () => {
          const id = ++request
          try {
            const sessions = array(await client.session.list({ roots: false })).filter(isSession)
            const root = rootSession(props.session_id, sessions)
            const ids = [...descendants(root, sessions)]
            const messageSets = await Promise.all(ids.map(async (sessionID) => messages(await client.session.messages({ sessionID }))))
            if (id !== request) return
            const rootChanged = root !== rootID()
            setRootID(root)
            setSessionIDs(new Set(ids))
            track(ids)
            untrack(trackedIds)
            trackedIds = ids
            for (const sessionID of ids) sessionRoots.set(sessionID, root)
            if (!initialized || rootChanged) {
              activeTimes.set(root, new ActiveTimeTracker(activeTimePersistence.load(root)))
            }
            initialized = true

            const assistantMessages = messageSets.flat().filter(isAssistant)
            for (const message of assistantMessages) {
              streams.bind(message.sessionID, message.id, rowKey(message.agent, message.providerID, message.modelID))
            }
            setRows(groupRows(assistantMessages))
          } catch {
            if (id === request) setRows([])
          }
        }

        createEffect(() => {
          revision()
          void load()
        })
        onCleanup(() => {
          request += 1
          untrack(trackedIds)
          trackedIds = []
        })

        const duration = (): string => {
          const now = clock()
          const states = status()
          const working = [...sessionIDs()].some((sessionID) => {
            const current = states[sessionID]
            return current ? current === "busy" || current === "retry" : ["busy", "retry"].includes(api.state.session.status(sessionID)?.type ?? "idle")
          })
          const key = rootID()
          const tracker = activeTimes.get(key) ?? new ActiveTimeTracker()
          activeTimes.set(key, tracker)
          if (working) {
            activeTimePersistence.save(key, tracker.start(now))
          } else {
            activeTimePersistence.save(key, tracker.stop(now))
          }
          return formatDuration(tracker.display(now))
        }
        const currentSpeed = (): string => {
          clock()
          return `${formatSpeed(streams.current(props.session_id, performance.now()))} t/s`
        }
        const renderSummary = (): string => {
          return renderRow({ ...summary(rows()), agent: duration(), model: currentSpeed() })
        }
        const expandedRows = () => {
          clock()
          const peaks = peaksFor(rootID())
          return rows().map((row) => (
            <text fg={ctx.theme.current.text}>{renderRow({ ...row, peak: peaks.get(row.key) ?? 0 })}</text>
          ))
        }
        const toggle = () => {
          const next = !expanded()
          setExpanded(next)
          expandedPersistence.save(next)
        }

        return (
          <box flexDirection="column" width="100%">
            <box flexDirection="row" width="100%">
              <box flexGrow={1} flexShrink={1} overflow="hidden">
                <text fg={ctx.theme.current.textMuted}>{header()}</text>
              </box>
              <box flexShrink={0} paddingLeft={1}>
                <text fg={ctx.theme.current.textMuted}> </text>
              </box>
            </box>
            <box flexDirection="row" width="100%">
              <box flexGrow={1} flexShrink={1} overflow="hidden">
                <text fg={ctx.theme.current.textMuted}>{renderSummary()}</text>
              </box>
              <box flexShrink={0} onMouseUp={toggle} paddingLeft={1}>
                <text fg={TOGGLE_COLOR}>{expanded() ? "v" : "^"}</text>
              </box>
            </box>
            {expanded() ? expandedRows() : null}
            <Prompt
              sessionID={props.session_id}
              visible={props.visible}
              disabled={props.disabled}
              onSubmit={props.on_submit}
              ref={props.ref}
              right={<Slot name="session_prompt_right" session_id={props.session_id} />}
            />
          </box>
        )
      },
    },
  })
}

export default {
  id: "session-token-bar",
  tui,
} satisfies TuiPluginModule
