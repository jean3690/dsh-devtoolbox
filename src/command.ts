/**
 * The `/toolbox` human command. Read-only toward configuration: enable /
 * disable suggestions are printed, never written.
 *
 * - `/toolbox` — categories and tool ids with one-line descriptions.
 * - `/toolbox run <id> [key=value ...]` — run a built-in tool, print the
 *   result (model-readable, logged by the commands service).
 * - `/toolbox agent` — the exposable set, what is currently exposed, and a
 *   ready-to-paste patch snippet.
 * - `/toolbox agent enable <id>` / `disable <id>` — the exact
 *   `cordis.patch.yml` line to apply (never edited for you).
 *
 * @module dsh-toolbox/command
 */

import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ResolvedConfig } from './config.ts'
import { exposableIds } from './agentTools.ts'
import { renderResultText } from './present.ts'
import { CATEGORIES, TOOLS, TOOL_BY_ID, coerceArgs } from './tools/index.ts'
import { lookup, type ToolboxLang } from './i18n.ts'

export type CommandLanguage = 'en' | 'zh'

export interface CommandMessages {
  header: (count: number) => string
  category: (name: string) => string
  toolLine: (id: string, desc: string) => string
  usage: string
  unknownTool: (id: string, known: string) => string
  ran: (id: string) => string
  agentHeader: (count: number, exposed: string) => string
  agentStatus: (id: string, on: boolean) => string
  agentSuggestion: (id: string) => string
  agentNote: string
  enabled: string
  disabled: string
}

export const EN_MESSAGES: CommandMessages = {
  header: count => `dsh-toolbox: ${count} local tools (data never leaves this machine)`,
  category: name => `## ${name}`,
  toolLine: (id, desc) => `- ${id} — ${desc}`,
  usage: 'Usage: /toolbox | /toolbox run <id> [key=value ...] | /toolbox agent | /toolbox agent enable|disable <id>',
  unknownTool: (id, known) => `Unknown tool "${id}" (available: ${known === '' ? 'none' : known})`,
  ran: id => `toolbox:${id} →`,
  agentHeader: (count, exposed) => `Exposable tools (${count}; exposed: ${exposed === '' ? 'none' : exposed})`,
  agentStatus: (id, on) => `${id}: ${on ? 'exposed' : 'not exposed'}`,
  agentSuggestion: id => `To expose, add to the profile patch layer (cordis.patch.yml): agentTools: ['${id}']`,
  agentNote: 'agentTools: [] exposes nothing; agentTools: [\'*\'] exposes all. This command never edits your config.',
  enabled: 'exposed',
  disabled: 'not exposed',
}

export const ZH_MESSAGES: CommandMessages = {
  header: count => `dsh-toolbox：${count} 个本地工具（数据不出本机）`,
  category: name => `## ${name}`,
  toolLine: (id, desc) => `- ${id} — ${desc}`,
  usage: '用法：/toolbox | /toolbox run <id> [key=value ...] | /toolbox agent | /toolbox agent enable|disable <id>',
  unknownTool: (id, known) => `未知工具 "${id}"（可用：${known === '' ? '无' : known}）`,
  ran: id => `toolbox:${id} →`,
  agentHeader: (count, exposed) => `可暴露工具（${count} 个；已暴露：${exposed === '' ? '无' : exposed}）`,
  agentStatus: (id, on) => `${id}：${on ? '已暴露' : '未暴露'}`,
  agentSuggestion: id => `要暴露它，在 profile patch 层（cordis.patch.yml）添加：agentTools: ['${id}']`,
  agentNote: 'agentTools: [] 表示不暴露任何工具；agentTools: [\'*\'] 暴露全部。本命令绝不修改你的配置。',
  enabled: '已暴露',
  disabled: '未暴露',
}

export function parseToolboxArgs(rawInput: string): { kind: 'list' } | { kind: 'agent' } | { kind: 'agentToggle'; id: string; on: boolean } | { kind: 'run'; id: string; args: Record<string, string> } | { kind: 'usage' } {
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { kind: 'list' }
  const [head, ...rest] = tokens
  if (head === 'agent') {
    if (rest.length === 0) return { kind: 'agent' }
    if ((rest[0] === 'enable' || rest[0] === 'disable') && rest.length === 2) {
      return { kind: 'agentToggle', id: rest[1]!, on: rest[0] === 'enable' }
    }
    return { kind: 'usage' }
  }
  if (head === 'run' && rest.length >= 1) {
    const args: Record<string, string> = {}
    for (const token of rest.slice(1)) {
      const eq = token.indexOf('=')
      if (eq > 0) args[token.slice(0, eq)] = token.slice(eq + 1)
      else if (args.text === undefined) args.text = token
    }
    return { kind: 'run', id: rest[0]!, args }
  }
  return { kind: 'usage' }
}

/** Build the `/toolbox` command definition. */
export function toolboxCommand(resolved: ResolvedConfig, language: CommandLanguage = 'zh'): CommandDefinition {
  const messages = language === 'zh' ? ZH_MESSAGES : EN_MESSAGES
  const lang: ToolboxLang = language
  const exposed = new Set(resolved.agentTools.includes('*') ? exposableIds(resolved) : resolved.agentTools)
  return {
    name: 'toolbox',
    description: 'List and run dsh-toolbox local utilities (text/code/security/extract), and manage agent tool exposure',
    input: { hint: '[run <id> key=value ...| agent [enable|disable <id>]]' },
    handler: async ({ rawInput }) => {
      const parsed = parseToolboxArgs(rawInput)
      if (parsed.kind === 'usage') return { kind: 'error', text: messages.usage }

      if (parsed.kind === 'list') {
        const lines = [messages.header(TOOLS.length)]
        for (const cat of CATEGORIES) {
          const tools = TOOLS.filter(t => t.category === cat.id)
          lines.push(messages.category(lookup(lang, cat.nameKey)))
          for (const tool of tools) lines.push(messages.toolLine(tool.id, lookup(lang, tool.descKey)))
        }
        lines.push('', messages.agentNote)
        return { kind: 'success', text: lines.join('\n') }
      }

      if (parsed.kind === 'agent') {
        const ids = exposableIds(resolved)
        const lines = [messages.agentHeader(ids.length, [...exposed].join(', '))]
        for (const id of ids) lines.push(messages.agentStatus(id, exposed.has(id)))
        lines.push('', messages.agentNote)
        return { kind: 'success', text: lines.join('\n') }
      }

      if (parsed.kind === 'agentToggle') {
        if (parsed.on === exposed.has(parsed.id)) {
          return { kind: 'success', text: `toolbox:${parsed.id} is already ${parsed.on ? messages.enabled : messages.disabled}` }
        }
        return {
          kind: 'success',
          text: `${messages.agentSuggestion(parsed.id)}\n${messages.agentNote}`,
        }
      }

      // run
      const tool = TOOL_BY_ID.get(parsed.id)
      if (tool === undefined) {
        return { kind: 'error', text: messages.unknownTool(parsed.id, TOOLS.map(t => t.id).join(', ')) }
      }
      const coerced = coerceArgs(tool, parsed.args)
      if (!coerced.ok) return { kind: 'error', text: `toolbox:${parsed.id}: ${coerced.error}` }
      try {
        const result = await tool.run(coerced.value)
        return { kind: 'success', text: `${messages.ran(parsed.id)}\n${renderResultText(result)}` }
      } catch (error) {
        return { kind: 'error', text: `toolbox:${parsed.id}: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
}
