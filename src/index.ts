/**
 * dsh-devtoolbox — a local toolbox for the DeepSeek Harness web GUI.
 *
 * Host half: the `/toolbox` command (list/run tools, manage agent exposure),
 * config-driven agent tool registration (`agentTools` / `userTools`, so the
 * user — not the plugin — decides what the model can call), host-only file
 * tools, and the `toolbox` Typert Remote service (save outputs into the
 * profile's save directory). The browser half (exports "./client") mounts
 * the sidebar entry and the toolbox view.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`).
 *
 * @module dsh-devtoolbox
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig } from './config.ts'
import { toolboxCommand } from './command.ts'
import { buildAgentTools } from './agentTools.ts'
import { ToolboxService } from './service.ts'

export const name = 'dsh-devtoolbox'

/** Hard services: the tool registry. Everything else is optional. */
export const inject = ['tools', 'loader']

export { Config, resolveConfig } from './config.ts'
export { ToolboxService, sanitizeFileName, sanitizeSubdir } from './service.ts'
export { toolboxCommand, parseToolboxArgs, EN_MESSAGES, ZH_MESSAGES } from './command.ts'
export { buildAgentTools, renderResultText, exposableIds, HOST_ONLY_IDS } from './agentTools.ts'
export { fileHashTool, fileEncodeTool } from './hostTools.ts'
export type * from './wire.ts'
export * from './tools/index.ts'

/**
 * Mount the toolbox: the save service, the `/toolbox` command (when commands
 * exist), and the config-driven agent tool set (when tools exist).
 *
 * @param ctx - context carrying tools + loader.
 * @param config - raw loader config; defaults applied through {@link resolveConfig}.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)

  // The save service: writes land in <profile>/toolbox-saves (configurable).
  await ctx.plugin(ToolboxService, ToolboxService.resolveSaveDir(ctx.baseUrl, resolved.saveDir))
  const service = ctx.get('toolbox') as ToolboxService

  // Config-driven agent tools: empty by default; the user opts in.
  ctx.inject(['tools'], (scope) => {
    const defs = buildAgentTools(resolved, ctx.baseUrl)
    scope.effect(() => {
      const disposers = defs.map(def => scope.tools.register(def))
      return () => { for (const dispose of disposers) dispose() }
    }, `dsh-devtoolbox: ${defs.length} agent tool(s)`)
  })

  // The /toolbox human command: only where a command registry is composed.
  ctx.inject(['commands'], (scope) => {
    scope.effect(() => scope.commands.register(toolboxCommand(resolved, 'zh')), 'dsh-devtoolbox: /toolbox command')
  })

  // Keep a reference so the service's fiber stays reachable (avoids
  // tree-shaking the class in bundled builds).
  void service
}
