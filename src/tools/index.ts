/**
 * dsh-toolbox tool registry: the single catalog shared by all three faces —
 * the browser toolbox UI, the `/toolbox` host command, and the config-driven
 * agent tool registration. A tool is a pure function plus metadata; nothing
 * here touches the DOM, the filesystem, or the network, so the same code runs
 * identically in the web GUI and in the host process.
 *
 * @module dsh-toolbox/tools
 */

import { textTools } from './text.ts'
import { encodeTools } from './encode.ts'
import { dataTools } from './data.ts'
import { securityTools } from './security.ts'
import { extractTools } from './extract.ts'
import { convertTools } from './convert.ts'
import { referenceTools } from './reference.ts'

/** Tool argument declaration (JSON-schema-ish, kept minimal). */
export interface ToolArgSpec {
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description?: string
  default?: string | number | boolean
}

/** A pure toolbox function. */
export interface ToolFn<A extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id (also the agent tool suffix and /toolbox run name). */
  id: string
  /** Human name (browser label; localized). */
  nameKey: string
  /** One-line description (localized). */
  descKey: string
  /** Category id. */
  category: CategoryId
  /** Argument declarations; {} for no-arg tools. */
  args: Record<string, ToolArgSpec>
  /** Input hint: whether the primary payload is a text blob (affects UI + agent description). */
  textPayload?: boolean
  /** Pure implementation (may be async, e.g. WebCrypto SHA). */
  run: (args: A) => ToolResult | Promise<ToolResult>
}

/** Tool output: text, structured JSON, or a table (rendered in the UI). */
export type ToolResult =
  | { kind: 'text'; text: string }
  | { kind: 'json'; json: unknown }
  | { kind: 'table'; columns: string[]; rows: readonly (readonly (string | number)[])[]; note?: string }

/** Category ids. */
export type CategoryId =
  | 'text' | 'encode' | 'data' | 'security' | 'extract' | 'convert' | 'reference' | 'life'

export const CATEGORIES: readonly { id: CategoryId; nameKey: string; icon: string }[] = [
  { id: 'text', nameKey: 'category.text', icon: '✍️' },
  { id: 'encode', nameKey: 'category.encode', icon: '🔣' },
  { id: 'data', nameKey: 'category.data', icon: '🧮' },
  { id: 'security', nameKey: 'category.security', icon: '🔐' },
  { id: 'extract', nameKey: 'category.extract', icon: '🔍' },
  { id: 'convert', nameKey: 'category.convert', icon: '🔄' },
  { id: 'reference', nameKey: 'category.reference', icon: '📖' },
  { id: 'life', nameKey: 'category.life', icon: '⏱️' },
]

/** All built-in tools, grouped. */
export const TOOLS: readonly ToolFn[] = Object.freeze([
  ...textTools,
  ...encodeTools,
  ...dataTools,
  ...securityTools,
  ...extractTools,
  ...convertTools,
  ...referenceTools,
])

/** Index for /toolbox run and agent registration. */
export const TOOL_BY_ID: ReadonlyMap<string, ToolFn> = new Map(TOOLS.map(t => [t.id, t]))

/** Tools safe to expose to the agent (deterministic, cheap, pure). */
export const AGENT_EXPOSABLE_IDS: readonly string[] = Object.freeze(
  TOOLS.filter(t => t.category !== 'life' && t.id !== 'regex').map(t => t.id),
)

/** Human-readable agent description for one tool (built from metadata). */
export function agentDescription(tool: ToolFn): string {
  const argList = Object.entries(tool.args)
    .map(([name, spec]) => `${name}${spec.required ? '' : '?'}:${spec.type}`)
    .join(', ')
  return `${tool.descKey}${argList === '' ? '' : ` (args: ${argList})`}`
}

/** Validate + coerce raw string args into the typed shape a tool expects. */
export function coerceArgs(
  tool: ToolFn,
  raw: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(tool.args)) {
    const present = raw[name] !== undefined && raw[name] !== ''
    if (!present) {
      if (spec.required) return { ok: false, error: `missing required arg "${name}"` }
      if (spec.default !== undefined) value[name] = spec.default
      continue
    }
    const r = raw[name]
    switch (spec.type) {
      case 'string':
        value[name] = String(r)
        break
      case 'number': {
        const n = Number(r)
        if (!Number.isFinite(n)) return { ok: false, error: `arg "${name}" must be a number` }
        value[name] = n
        break
      }
      case 'boolean': {
        if (r === true || r === 'true' || r === '1') value[name] = true
        else if (r === false || r === 'false' || r === '0') value[name] = false
        else return { ok: false, error: `arg "${name}" must be a boolean` }
        break
      }
    }
  }
  return { ok: true, value }
}

export * from './text.ts'
export * from './encode.ts'
export * from './data.ts'
export * from './security.ts'
export * from './extract.ts'
export * from './convert.ts'
export * from './reference.ts'
