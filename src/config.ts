/**
 * dsh-devtoolbox plugin configuration and its explicit resolve step (the
 * explicit-resolve contract: defaults and bounds re-judged at load so
 * programmatic construction fails loud instead of running with hidden
 * defaults).
 *
 * Key design: agent exposure is config-driven — the plugin ships no
 * hard-coded agent tools. `agentTools` lists which built-ins the user wants
 * visible to the model (`'*'` = all); `userTools` lets the user define their
 * own deterministic tools as JS expressions (the patch layer already trusts
 * `!!js`), registered as `toolbox_<name>`.
 *
 * @module dsh-devtoolbox/config
 */

import z from '@deepseek-ai/schemastery'

/** One user-defined tool (a JS expression evaluated as `(args) => result`). */
export interface UserToolSpec {
  /** Tool suffix: registered as `toolbox_<name>`. */
  name: string
  /** Model-visible one-line description. */
  description: string
  /** Arg declarations (JSON-schema-ish). */
  args: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean; description?: string }>
  /** JS expression `(args) => any` (evaluated via `new Function`). */
  run: string
}

/** Raw loader configuration for the toolbox. */
export interface Config {
  /** Built-in tools to expose to the agent; `'*'` = all, [] = none (default). */
  agentTools?: string[]
  /** User-defined tools (also gated by `agentTools`). */
  userTools?: UserToolSpec[]
  /** Whether the browser "save to project" RPC is served (default true). */
  saveEnabled?: boolean
  /** Directory for saved outputs; relative to the profile root (default `toolbox-saves`). */
  saveDir?: string
}

/** Fully resolved configuration captured at plugin load. */
export interface ResolvedConfig {
  /** Built-in ids to expose; `'*'` means every agent-exposable built-in. */
  agentTools: readonly string[]
  /** User-defined tool specs (validated). */
  userTools: readonly UserToolSpec[]
  /** Whether the save RPC is served. */
  saveEnabled: boolean
  /** Save directory (absolute, resolved at load). */
  saveDir: string
}

/** Schemastery schema for loader-validated configuration. */
export const Config: z<Config> = z.object({
  agentTools: z.array(z.string()).default([]),
  userTools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    args: z.dict(z.object({
      type: z.union(['string', 'number', 'boolean'] as const),
      required: z.boolean().default(false),
      description: z.string().default(''),
    })).default({}),
    run: z.string().min(1),
  })).default([]),
  saveEnabled: z.boolean().default(true),
  saveDir: z.string().default('toolbox-saves'),
})

/** Resolve raw config into the frozen runtime policy. */
export function resolveConfig(config: Config | undefined): ResolvedConfig {
  const agentTools = config?.agentTools ?? []
  if (!Array.isArray(agentTools) || agentTools.some(v => typeof v !== 'string')) {
    throw new TypeError('dsh-devtoolbox: config.agentTools must be an array of strings')
  }
  const userTools = config?.userTools ?? []
  if (!Array.isArray(userTools)) throw new TypeError('dsh-devtoolbox: config.userTools must be an array')
  for (const spec of userTools) {
    if (typeof spec?.name !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(spec.name)) {
      throw new Error(`dsh-devtoolbox: user tool name must match ^[a-z][a-z0-9_]{1,31}$, got ${JSON.stringify(spec?.name)}`)
    }
    if (typeof spec?.run !== 'string' || spec.run === '') {
      throw new Error(`dsh-devtoolbox: user tool "${spec?.name}" needs a non-empty run expression`)
    }
    if (typeof spec?.description !== 'string' || spec.description === '') {
      throw new Error(`dsh-devtoolbox: user tool "${spec?.name}" needs a description`)
    }
  }
  const saveEnabled = config?.saveEnabled ?? true
  if (typeof saveEnabled !== 'boolean') throw new TypeError('dsh-devtoolbox: config.saveEnabled must be a boolean')
  const saveDir = config?.saveDir ?? 'toolbox-saves'
  if (typeof saveDir !== 'string' || saveDir === '') {
    throw new TypeError('dsh-devtoolbox: config.saveDir must be a non-empty string')
  }
  return Object.freeze({ agentTools: Object.freeze([...agentTools]), userTools: Object.freeze([...userTools]), saveEnabled, saveDir })
}
