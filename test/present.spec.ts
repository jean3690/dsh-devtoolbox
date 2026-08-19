import { describe, expect, it } from 'vitest'
import { renderResultText } from '../src/present.ts'
import type { ToolResult } from '../src/tools/index.ts'

describe('renderResultText', () => {
  it('renders text results as-is', () => {
    expect(renderResultText({ kind: 'text', text: 'hello' })).toBe('hello')
  })

  it('pretty-prints json results', () => {
    expect(renderResultText({ kind: 'json', json: { a: 1 } })).toBe('{\n  "a": 1\n}')
  })

  it('renders tables as tab-separated lines with note', () => {
    const table: ToolResult = {
      kind: 'table',
      columns: ['metric', 'value'],
      rows: [['characters', 20], ['lines', 2]],
      note: '2 rows',
    }
    expect(renderResultText(table)).toBe('2 rows\nmetric\tvalue\ncharacters\t20\nlines\t2')
  })

  it('omits the note line when absent', () => {
    expect(renderResultText({ kind: 'table', columns: ['a'], rows: [['1']] })).toBe('a\n1')
  })
})