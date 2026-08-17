/**
 * Presentation helpers for ToolResult values: rendering to model-readable
 * text. Kept in a dependency-free module so the browser bundle can import it
 * without pulling the host's tool-registry chain (dsh-tools / dsh-llm) into
 * the client.
 *
 * @module dsh-devtoolbox/present
 */

import type { ToolResult } from './tools/index.ts'

/** Render a ToolResult as plain text (tables become tab-separated). */
export function renderResultText(result: ToolResult): string {
  switch (result.kind) {
    case 'text':
      return result.text
    case 'json':
      return JSON.stringify(result.json, null, 2)
    case 'table': {
      const header = result.columns.join('\t')
      const body = result.rows.map(row => row.join('\t')).join('\n')
      return `${result.note === undefined ? '' : `${result.note}\n`}${header}\n${body}`
    }
  }
}
