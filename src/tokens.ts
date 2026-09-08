export type Tokens = {
  hit: number
  miss: number
  out: number
}

export type Row = Tokens & {
  agent: string
  model: string
}

export type AssistantMessageLike = {
  role: "assistant"
  agent: string
  providerID: string
  modelID: string
  tokens: {
    input: number
    output: number
    cache: { read: number }
  }
}

export const AGENT_WIDTH = 16
export const MODEL_WIDTH = 20
export const HIT_WIDTH = 9
export const MISS_WIDTH = 10
export const OUT_WIDTH = 8
export const RATE_WIDTH = 8

export function tokens(message: AssistantMessageLike): Tokens {
  const hit = Math.max(0, message.tokens.cache.read || 0)
  return {
    hit,
    miss: Math.max(0, (message.tokens.input || 0) - hit),
    out: Math.max(0, message.tokens.output || 0),
  }
}

export function add(target: Tokens, source: Tokens): void {
  target.hit += source.hit
  target.miss += source.miss
  target.out += source.out
}

export function groupRows(messages: AssistantMessageLike[]): Row[] {
  const grouped = new Map<string, Row>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const key = `${message.agent}\u0000${message.providerID}\u0000${message.modelID}`
    const row = grouped.get(key) ?? {
      agent: message.agent,
      model: modelName(message.modelID),
      hit: 0,
      miss: 0,
      out: 0,
    }
    add(row, tokens(message))
    grouped.set(key, row)
  }
  return [...grouped.values()]
}

export function summary(rows: Row[]): Tokens {
  const total: Tokens = { hit: 0, miss: 0, out: 0 }
  for (const row of rows) add(total, row)
  return total
}

export function rate(tokens: Tokens): string {
  const input = tokens.hit + tokens.miss
  return `${input === 0 ? "0.0" : ((tokens.hit / input) * 100).toFixed(1)}%`
}

export function formatTokens(input: number): string {
  if (input < 1_000) return `${Math.round(input)}`
  if (input < 1_000_000) return `${(input / 1_000).toFixed(1)}k`
  return `${(input / 1_000_000).toFixed(1)}m`
}

export function modelName(modelID: string): string {
  const parts = modelID.split("/")
  return parts.at(-1) || modelID
}

export function textWidth(input: string): number {
  return Array.from(input).length
}

export function clip(input: string, width: number): string {
  if (textWidth(input) <= width) return input
  return `${Array.from(input).slice(0, Math.max(0, width - 1)).join("")}~`
}

export function fixed(input: string, width: number, align: "left" | "right" = "left"): string {
  const clipped = clip(input, width)
  const spaces = " ".repeat(Math.max(0, width - textWidth(clipped)))
  return align === "right" ? `${spaces}${clipped}` : `${clipped}${spaces}`
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => `${part}`.padStart(2, "0")).join(":")
}

export function header(): string {
  return [
    fixed("agent", AGENT_WIDTH),
    fixed("model", MODEL_WIDTH),
    fixed("hit", HIT_WIDTH, "right"),
    fixed("miss", MISS_WIDTH, "right"),
    fixed("out", OUT_WIDTH, "right"),
    fixed("rate", RATE_WIDTH, "right"),
  ].join(" | ")
}

export function renderRow(row: Partial<Row>): string {
  const data: Tokens = { hit: row.hit ?? 0, miss: row.miss ?? 0, out: row.out ?? 0 }
  return [
    fixed(row.agent ?? "", AGENT_WIDTH),
    fixed(row.model ?? "", MODEL_WIDTH),
    fixed(formatTokens(data.hit), HIT_WIDTH, "right"),
    fixed(formatTokens(data.miss), MISS_WIDTH, "right"),
    fixed(formatTokens(data.out), OUT_WIDTH, "right"),
    fixed(rate(data), RATE_WIDTH, "right"),
  ].join(" | ")
}
