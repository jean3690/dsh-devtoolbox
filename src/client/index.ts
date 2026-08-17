/**
 * dsh-devtoolbox, browser half: mounts the `toolbox` Remote contribution, then
 * injects the sidebar entry row and the center-column toolbox view (DOM-level
 * surfaces following the task-board precedent). Failure policy: DOM mounting
 * problems are logged, never thrown — an external plugin must not take the
 * web GUI down.
 *
 * @module dsh-devtoolbox/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the 'settings.plugins.tab' SlotMap declaration into this
// program so the slot registration typechecks against the real declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ToolboxController } from './controller.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountToolboxView } from './view-mount.tsx'
import { TOOLBOX_REMOTE } from './remote.ts'
import { ZH, EN } from '../i18n.ts'
import type { SaveRequest, SaveResult } from '../wire.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Toolbox surface copy. */
    'toolbox': string
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'toolbox'

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-devtoolbox'

/** Services the surfaces read; `remote.toolbox` appears once this plugin mounts its contribution. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Browser plugin body: dictionaries, the scoped stylesheet, the Remote
 * contribution mount, and the sidebar entry + center-column view.
 *
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-devtoolbox: dictionaries')

  // $mount registers the 'remote.toolbox' namespace service and owns its
  // removal for this fiber's lifetime.
  await ctx.remote.$mount(TOOLBOX_REMOTE)

  const controller = new ToolboxController()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountToolboxView(controller, async request => {
      const result: RemoteResult<SaveResult> = await ctx.remote.toolbox.save(request as SaveRequest)
      if (!result.ok) {
        throw new Error(`toolbox.save failed: ${result.error.code}: ${result.error.message}`)
      }
      return { path: result.value.path }
    }))
  } catch (error) {
    // DOM failures degrade the toolbox, never the GUI.
    console.error('[dsh-devtoolbox] mount failed:', error)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-devtoolbox: surfaces')
}
