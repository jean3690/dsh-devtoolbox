/**
 * dsh-toolbox styles: one injected <style> element, scoped by the plugin's
 * own data attributes so nothing leaks into the rest of the GUI. Colors ride
 * the dsh `--dsw-*` tokens so the toolbox follows the active theme
 * (light/dark and skins).
 *
 * @module dsh-toolbox/client/styles
 */

const CSS = `
/* --- center-column takeover (attribute-scoped, sibling-panel aware) --------- */
[data-pane='conversation'] {
  position: relative;
}

[data-dsh-toolbox-view] {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 60;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}

/* Single-occupant center column: the view shows only while this plugin is
   active AND no sibling panel (task board / ssh) claims the column. */
html[data-dsh-toolbox-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-toolbox-view] {
  display: flex;
  flex-direction: column;
}

/* While the toolbox is active, hide the conversation subtree underneath
   (it stays mounted and stateful). !important beats the shell's inline
   display: contents wrapper. */
html[data-dsh-toolbox-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-toolbox-view]),
html[data-dsh-toolbox-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-toolbox-view]) {
  display: none !important;
}

/* --- sidebar entry row ------------------------------------------------------- */
.dsh-toolbox-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.dsh-toolbox-entry:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-toolbox-entry[data-active] {
  background: var(--dsw-specific-sidebar-nav-item-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.dsh-toolbox-entryIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
}

/* --- toolbox view internals --------------------------------------------------- */
.dsh-toolbox-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 14px;
  color: var(--dsw-alias-label-primary);
}
.dsh-toolbox-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-subtle);
  flex: none;
}
.dsh-toolbox-back {
  background: transparent;
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.dsh-toolbox-back:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-strong);
}
.dsh-toolbox-title {
  font-size: 15px;
  font-weight: 600;
  flex: none;
}
.dsh-toolbox-subtitle {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  flex: none;
}
.dsh-toolbox-search {
  flex: 1;
  min-width: 160px;
  background: var(--dsw-alias-bg-raised);
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  padding: 6px 12px;
  font-size: 13px;
  outline: none;
}
.dsh-toolbox-search:focus {
  border-color: var(--dsw-alias-accent);
}
.dsh-toolbox-cats {
  display: flex;
  gap: 6px;
  padding: 10px 20px 0;
  flex-wrap: wrap;
  flex: none;
}
.dsh-toolbox-cat {
  background: transparent;
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12.5px;
}
.dsh-toolbox-cat:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh-toolbox-cat[data-active] {
  background: var(--dsw-alias-accent);
  border-color: var(--dsw-alias-accent);
  color: var(--dsw-alias-label-on-accent, #fff);
  font-weight: 600;
}
.dsh-toolbox-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
  padding: 14px 20px 20px;
  align-content: start;
}
.dsh-toolbox-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--dsw-alias-bg-raised);
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  color: var(--dsw-alias-label-primary);
}
.dsh-toolbox-card:hover {
  border-color: var(--dsw-alias-accent);
  background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-bg-raised));
}
.dsh-toolbox-cardName {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 13.5px;
}
.dsh-toolbox-cardDesc {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsh-toolbox-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
  padding: 40px 0;
}

/* --- tool page ----------------------------------------------------------------- */
.dsh-toolbox-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dsh-toolbox-pageTitle {
  font-size: 16px;
  font-weight: 600;
}
.dsh-toolbox-pageDesc {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  margin-top: -8px;
}
.dsh-toolbox-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dsh-toolbox-fieldLabel {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  font-weight: 600;
}
.dsh-toolbox-input {
  background: var(--dsw-alias-bg-raised);
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  padding: 8px 12px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
  resize: vertical;
}
.dsh-toolbox-input:focus {
  border-color: var(--dsw-alias-accent);
}
.dsh-toolbox-inputSmall {
  max-width: 240px;
}
.dsh-toolbox-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-toolbox-run {
  align-self: flex-start;
  background: var(--dsw-alias-accent);
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-on-accent, #fff);
  padding: 8px 22px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.dsh-toolbox-run:hover {
  filter: brightness(1.08);
}
.dsh-toolbox-run:disabled {
  opacity: 0.6;
  cursor: default;
}
.dsh-toolbox-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-toolbox-resultBar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-toolbox-resultLabel {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  flex: 1;
}
.dsh-toolbox-action {
  background: transparent;
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.dsh-toolbox-action:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-strong);
}
.dsh-toolbox-pre {
  background: var(--dsw-alias-bg-raised);
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 8px;
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  max-height: 46vh;
  margin: 0;
  color: var(--dsw-alias-label-primary);
}
.dsh-toolbox-tableWrap {
  overflow: auto;
  max-height: 46vh;
  border: 1px solid var(--dsw-alias-border-subtle);
  border-radius: 8px;
}
.dsh-toolbox-table {
  border-collapse: collapse;
  font-size: 12.5px;
  width: 100%;
}
.dsh-toolbox-table th,
.dsh-toolbox-table td {
  border: 1px solid var(--dsw-alias-border-subtle);
  padding: 5px 10px;
  text-align: left;
  white-space: nowrap;
}
.dsh-toolbox-table th {
  background: var(--dsw-alias-bg-raised);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.dsh-toolbox-note {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-toolbox-error {
  font-size: 13px;
  color: var(--dsw-alias-danger, #e5484d);
  white-space: pre-wrap;
}
.dsh-toolbox-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-strong);
  vertical-align: middle;
  margin-right: 6px;
}
`

let installed = false

/** Inject the toolbox stylesheet once (idempotent); returns the disposer. */
export function installToolboxStyles(): () => void {
  if (installed) return () => {}
  installed = true
  const style = document.createElement('style')
  style.dataset.dshToolboxStyles = ''
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
