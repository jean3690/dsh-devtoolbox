/**
 * Config-driven agent tool registration. The plugin ships NO hard-coded
 * agent tools: the user decides what the model can call through the
 * `agentTools` config list (`'*'` = all built-ins) and can define their own
 * deterministic utilities as `userTools` JS expressions. Every registered
 * tool is `toolbox_<name>`.
 *
 * @module dsh-devtoolbox/agentTools
 */

import type { ToolDefinition, ParameterSchemaSpec, JsonValue } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './config.ts'
import { AGENT_EXPOSABLE_IDS, coerceArgs, TOOL_BY_ID, type ToolResult } from './tools/index.ts'
import { fileEncodeTool, fileHashTool } from './hostTools.ts'
import { lookup, type ToolboxLang } from './i18n.ts'
import { renderResultText } from './present.ts'

export { renderResultText } from './present.ts'

/** Host-only tools available for agent exposure (file system capabilities). */
export const HOST_ONLY_IDS = ['file_hash', 'file_encode'] as const

/** JSON-safe value of a ToolResult for the wire (never functions/undefined). */
function jsonValue(result: ToolResult): {
  kind: string
  text?: string
  json?: JsonValue
  columns?: string[]
  rows?: string[][]
  note?: string
} {
  switch (result.kind) {
    case 'text':
      return { kind: 'text', text: result.text }
    case 'json':
      return { kind: 'json', json: JSON.parse(JSON.stringify(result.json)) as JsonValue }
    case 'table':
      return {
        kind: 'table',
        columns: result.columns,
        rows: result.rows.map(row => row.map(v => (typeof v === 'number' ? v : String(v))) as string[]),
        ...(result.note === undefined ? {} : { note: result.note }),
      }
  }
}

/** ToolResult output schema for defineTool. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    text: { type: 'string' },
    json: { type: 'json' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    note: { type: 'string' },
  },
} as const

/** Map a built-in toolbox ToolFn to a dsh-tools ToolDefinition. */
function builtinDefinition(toolId: string, lang: ToolboxLang): ToolDefinition | undefined {
  const tool = TOOL_BY_ID.get(toolId)
  if (tool === undefined) return undefined
  const parameters: ParameterSchemaSpec = {}
  for (const [name, spec] of Object.entries(tool.args)) {
    parameters[name] = {
      type: spec.type,
      ...(spec.required === true ? { required: true } : {}),
      description: spec.description ?? '',
    }
  }
  const argList = Object.entries(tool.args)
    .map(([name, spec]) => `${name}${spec.required ? '' : '?'}:${spec.type}`)
    .join(', ')
  return defineTool({
    name: `toolbox_${tool.id}`,
    description: `[dsh-devtoolbox] ${lookup(lang, tool.descKey)}${argList === '' ? '' : ` (args: ${argList})`} Data stays local.`,
    parameters,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: renderResultText(value as ToolResult),
      }],
    },
    async execute(args) {
      const coerced = coerceArgs(tool, args as Record<string, unknown>)
      if (!coerced.ok) throw new Error(`toolbox_${tool.id}: ${coerced.error}`)
      const result = await tool.run(coerced.value)
      return jsonValue(result)
    },
  })
}

/** Compile one userTool spec into a ToolDefinition (trusted local code). */
function userDefinition(spec: { name: string; description: string; args: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean; description?: string }>; run: string }): ToolDefinition {
  const parameters: ParameterSchemaSpec = {}
  for (const [name, arg] of Object.entries(spec.args)) {
    parameters[name] = {
      type: arg.type,
      ...(arg.required === true ? { required: true } : {}),
      description: arg.description ?? '',
    }
  }
  const fn = new Function('args', `"use strict"; return (${spec.run})(args)`) as (args: Record<string, unknown>) => unknown
  return defineTool({
    name: `toolbox_${spec.name}`,
    description: `[dsh-devtoolbox user] ${spec.description}`,
    parameters,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          result: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: typeof value.result === 'string' ? value.result : JSON.stringify(value.result, null, 2),
      }],
    },
    async execute(args) {
      let result: unknown
      try {
        result = await fn(args as Record<string, unknown>)
      } catch (error) {
        throw new Error(`toolbox_${spec.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
      return { result: JSON.parse(JSON.stringify(result ?? null)) }
    },
  })
}

/** Is this built-in id exposed by the config? */
function exposed(agentTools: readonly string[], id: string): boolean {
  return agentTools.includes('*') || agentTools.includes(id)
}

/**
 * Build the agent tool set for the resolved config.
 *
 * @param resolved - resolved plugin config.
 * @param baseUrl - profile root (for file tools' relative paths).
 * @param lang - description language (default zh).
 * @returns the ToolDefinitions to register (may be empty).
 */
export function buildAgentTools(resolved: ResolvedConfig, baseUrl: string | undefined, lang: ToolboxLang = 'zh'): ToolDefinition[] {
  const out: ToolDefinition[] = []
  for (const id of AGENT_EXPOSABLE_IDS) {
    if (!exposed(resolved.agentTools, id)) continue
    const def = builtinDefinition(id, lang)
    if (def !== undefined) out.push(def)
  }
  for (const id of HOST_ONLY_IDS) {
    if (!exposed(resolved.agentTools, id)) continue
    if (id === 'file_hash') out.push(fileHashTool(baseUrl))
    if (id === 'file_encode') out.push(fileEncodeTool(baseUrl))
  }
  for (const spec of resolved.userTools) {
    if (!exposed(resolved.agentTools, spec.name)) continue
    out.push(userDefinition(spec))
  }
  return out
}

/** All ids the user can expose (built-ins + host-only + user tools). */
export function exposableIds(resolved: ResolvedConfig): readonly string[] {
  return Object.freeze([...AGENT_EXPOSABLE_IDS, ...HOST_ONLY_IDS, ...resolved.userTools.map(u => u.name)])
}
