/**
 * Toolbox view mounting.
 *
 * The `conversation` slot is single-occupant and external plugins cannot
 * declare slots, so the toolbox takes over the center column at the DOM
 * level (the task-board precedent): a container is appended inside the
 * `[data-pane="conversation"]` grid item, and a stylesheet rule hides the
 * conversation content while the toolbox is active. Toggling is a data
 * attribute on <html> — no React involvement, so the conversation subtree
 * underneath stays mounted and stateful.
 *
 * Cross-plugin coordination: opening the toolbox evicts sibling panels
 * (task board / ssh) via their html activation attributes, and the shared
 * `dsh-panel-activate` CustomEvent keeps sibling controllers in sync.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { ToolboxController } from './controller.ts'
import { ToolboxView } from './ToolboxView.tsx'

/** The injected toolbox container (kept in the DOM, hidden when inactive). */
export const TOOLBOX_VIEW_SELECTOR = '[data-dsh-devtoolbox-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"]'
const ACTIVE_ATTR = 'data-dsh-devtoolbox-active'
/** Sibling panels' activation attributes, removed when this panel opens. */
const SIBLING_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'toolbox'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the toolbox React tree into the center column and bind its
 * visibility to the controller's open state.
 * @param controller - the controller driving the view.
 * @param save - save-to-project RPC (host `toolbox/save`), or undefined when
 *   the remote namespace is unavailable.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountToolboxView(
  controller: ToolboxController,
  save: ((request: { fileName: string; content: string; subdir?: string }) => Promise<{ path: string }>) | undefined,
): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) return
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshToolboxView = ''
    // No className here: the `dsh-devtoolbox-root` layout class lives on the
    // React tree's own root div inside this container. Giving the host
    // container both a data attribute and the layout class would make
    // `.dsh-devtoolbox-root { display: flex }` (same specificity, later in the
    // sheet) override the `[data-dsh-devtoolbox-view] { display: none }`
    // hide rule, so the view would stay painted over the conversation
    // forever — the "cannot return to chat" bug.
    column.appendChild(container)
    root = createRoot(container)
    root.render(<ToolboxView controller={controller} save={save} />)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().open) {
      for (const attr of SIBLING_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if ((detail === 'taskboard' || detail === 'ssh') && controller.getSnapshot().open) {
      controller.closeBoard()
    }
  }
  // Jump out on sidebar context clicks (session/workspace rows).
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().open) return
    const target = event.target as HTMLElement | null
    if (target !== null && target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.closeBoard()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
