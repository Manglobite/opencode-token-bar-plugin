/** @jsxImportSource @opentui/solid */
import { createEffect, createSignal, onCleanup } from "solid-js"
import type { Message, Session } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { ActiveTimeTracker, createActiveTimePersistence, createExpandedPersistence } from "./persistence"
import { groupRows, header, renderRow, summary, formatDuration, type Row } from "./tokens"
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
  const client = api.client as unknown as SessionClient

  const refresh = () => setRevision((current) => current + 1)
  const stopMessage = api.event.on("message.updated", refresh)
  const stopPart = api.event.on("message.part.updated", refresh)
  const stopSession = api.event.on("session.created", refresh)
  const stopStatus = api.event.on("session.status", (event) => {
    setStatus((current) => ({ ...current, [event.properties.sessionID]: event.properties.status.type }))
    refresh()
  })
  const interval = setInterval(() => setClock(Date.now()), 1_000)
  api.lifecycle.onDispose(() => {
    const now = Date.now()
    for (const [sessionID, tracker] of activeTimes) {
      activeTimePersistence.save(sessionID, tracker.dispose(now))
    }
    stopMessage()
    stopPart()
    stopSession()
    stopStatus()
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
            if (!initialized || rootChanged) {
              activeTimes.set(root, new ActiveTimeTracker(activeTimePersistence.load(root)))
            }
            initialized = true

            const assistantMessages = messageSets.flat().filter(isAssistant)
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
                <text fg={ctx.theme.current.textMuted}>{renderRow({ ...summary(rows()), agent: duration() })}</text>
              </box>
              <box flexShrink={0} onMouseUp={toggle} paddingLeft={1}>
                <text fg={TOGGLE_COLOR}>{expanded() ? "v" : "^"}</text>
              </box>
            </box>
            {expanded() ? rows().map((row) => <text fg={ctx.theme.current.text}>{renderRow(row)}</text>) : null}
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
