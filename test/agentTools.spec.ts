import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { buildAgentTools, exposableIds } from '../src/agentTools.ts'
import { AGENT_EXPOSABLE_IDS } from '../src/tools/index.ts'

const dirs: string[] = []

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-toolbox-agent-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('buildAgentTools', () => {
  it('registers nothing by default', () => {
    expect(buildAgentTools(resolveConfig({}), undefined)).toEqual([])
  })

  it('registers only the exposed built-ins', () => {
    const tools = buildAgentTools(resolveConfig({ agentTools: ['json_format'] }), undefined)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('toolbox_json_format')
    expect(tools[0]!.description).toContain('Data stays local.')
  })

  it("exposes every agent tool plus host tools with '*'", () => {
    const tools = buildAgentTools(resolveConfig({ agentTools: ['*'] }), undefined)
    expect(tools).toHaveLength(AGENT_EXPOSABLE_IDS.length + 2)
    expect(tools.some(t => t.name === 'toolbox_file_hash')).toBe(true)
    expect(tools.some(t => t.name === 'toolbox_file_encode')).toBe(true)
  })

  it('registers host file tools on demand', async () => {
    const dir = tmpDir()
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'abc')
    const tools = buildAgentTools(resolveConfig({ agentTools: ['file_hash'] }), dir)
    expect(tools).toHaveLength(1)
    const out = await tools[0]!.execute({ path: 'a.txt' }, {} as never) as { algorithm: string; hex: string; bytes: number }
    expect(out).toEqual({ algorithm: 'sha256', hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', bytes: 3 })
  })

  it('compiles user tools and runs them', async () => {
    const resolved = resolveConfig({
      agentTools: ['double', 'sum'],
      userTools: [
        { name: 'double', description: 'double it', args: { x: { type: 'number', required: true } }, run: '(args) => args.x * 2' },
        { name: 'sum', description: 'sum it', args: {}, run: '(args) => ({ total: args.a + args.b })' },
      ],
    })
    const tools = buildAgentTools(resolved, undefined)
    expect(tools.map(t => t.name)).toEqual(['toolbox_double', 'toolbox_sum'])
    expect(tools[0]!.description).toContain('[dsh-devtoolbox user]')

    const doubled = await tools[0]!.execute({ x: 21 }, {} as never) as { result: number }
    expect(doubled).toEqual({ result: 42 })
    const summed = await tools[1]!.execute({ a: 1, b: 2 }, {} as never) as { result: { total: number } }
    expect(summed).toEqual({ result: { total: 3 } })
  })

  it('skips user tools not listed in agentTools', () => {
    const resolved = resolveConfig({
      agentTools: [],
      userTools: [{ name: 'secret', description: 'd', args: {}, run: '(a) => a' }],
    })
    expect(buildAgentTools(resolved, undefined)).toEqual([])
  })

  it('wraps user tool errors and non-JSON results', async () => {
    const resolved = resolveConfig({
      agentTools: ['boom', 'void'],
      userTools: [
        { name: 'boom', description: 'd', args: {}, run: '(args) => { throw new Error("kaboom") }' },
        { name: 'void', description: 'd', args: {}, run: '(args) => undefined' },
      ],
    })
    const tools = buildAgentTools(resolved, undefined)
    await expect(tools[0]!.execute({}, {} as never)).rejects.toThrow(/toolbox_boom: kaboom/)
    expect(await tools[1]!.execute({}, {} as never) as { result: null }).toEqual({ result: null })
  })

  it('executes built-ins through the agent contract', async () => {
    const tools = buildAgentTools(resolveConfig({ agentTools: ['json_format', 'text_stats'] }), undefined)
    const byName = (name: string) => tools.find(t => t.name === name)!
    const formatted = await byName('toolbox_json_format').execute({ text: '{"a":1}', mode: 'minify' }, {} as never)
    expect(formatted).toEqual({ kind: 'text', text: '{"a":1}' })
    const stats = await byName('toolbox_text_stats').execute({ text: 'hi' }, {} as never) as {
      kind: string
      columns: string[]
      rows: (string | number)[][]
    }
    expect(stats).toMatchObject({ kind: 'table', columns: ['metric', 'value'] })
    if (stats.kind === 'table') expect(stats.rows[0]).toEqual(['characters', 2])
    await expect(byName('toolbox_json_format').execute({}, {} as never)).rejects.toThrow('missing required property "text"')
  })

  it('uses the requested description language', () => {
    const zh = buildAgentTools(resolveConfig({ agentTools: ['json_format'] }), undefined, 'zh')
    const en = buildAgentTools(resolveConfig({ agentTools: ['json_format'] }), undefined, 'en')
    expect(zh[0]!.description).toContain('JSON 格式化')
    expect(en[0]!.description).toContain('Format, minify and validate JSON')
  })
})

describe('exposableIds', () => {
  it('lists built-ins, host tools and user tools', () => {
    const resolved = resolveConfig({
      agentTools: ['*'],
      userTools: [{ name: 'double', description: 'd', args: {}, run: '(a) => a' }],
    })
    const ids = exposableIds(resolved)
    expect(ids).toContain('json_format')
    expect(ids).toContain('file_hash')
    expect(ids).toContain('file_encode')
    expect(ids).toContain('double')
    expect(Object.isFrozen(ids)).toBe(true)
  })

  it('never exposes regex or picker to the agent', () => {
    const ids = exposableIds(resolveConfig({ agentTools: ['*'] }))
    expect(ids).not.toContain('regex')
    expect(ids).not.toContain('picker')
  })
})