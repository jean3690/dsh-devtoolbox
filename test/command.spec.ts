import { describe, expect, it } from 'vitest'
import { parseToolboxArgs, toolboxCommand } from '../src/command.ts'
import { resolveConfig } from '../src/config.ts'

type HandlerResult = { kind: 'success' | 'error'; text: string }

async function run(rawInput: string, agentTools: string[] = []): Promise<HandlerResult> {
  const def = toolboxCommand(resolveConfig({ agentTools }))
  return await def.handler({ rawInput } as never) as HandlerResult
}

describe('parseToolboxArgs', () => {
  it('parses list, run and agent forms', () => {
    expect(parseToolboxArgs('')).toEqual({ kind: 'list' })
    expect(parseToolboxArgs('  ')).toEqual({ kind: 'list' })
    expect(parseToolboxArgs('run json_format text={"a":1}')).toEqual({
      kind: 'run',
      id: 'json_format',
      args: { text: '{"a":1}' },
    })
    expect(parseToolboxArgs('run base64 hello world')).toEqual({
      kind: 'run',
      id: 'base64',
      args: { text: 'hello' },
    })
    expect(parseToolboxArgs('run radix value=ff from=16 to=10')).toEqual({
      kind: 'run',
      id: 'radix',
      args: { value: 'ff', from: '16', to: '10' },
    })
    expect(parseToolboxArgs('agent')).toEqual({ kind: 'agent' })
    expect(parseToolboxArgs('agent enable json_format')).toEqual({ kind: 'agentToggle', id: 'json_format', on: true })
    expect(parseToolboxArgs('agent disable json_format')).toEqual({ kind: 'agentToggle', id: 'json_format', on: false })
  })

  it('falls back to usage for malformed input', () => {
    expect(parseToolboxArgs('bogus')).toEqual({ kind: 'usage' })
    expect(parseToolboxArgs('agent enable')).toEqual({ kind: 'usage' })
    expect(parseToolboxArgs('agent disable a b')).toEqual({ kind: 'usage' })
    expect(parseToolboxArgs('run')).toEqual({ kind: 'usage' })
  })
})

describe('toolboxCommand handler', () => {
  it('lists all tools with categories', async () => {
    const result = await run('')
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('52 个本地工具')
      expect(result.text).toContain('## 文本')
      expect(result.text).toContain('json_format — ')
    }
  })

  it('runs a tool and renders the result', async () => {
    const result = await run('run json_format text={"a":1}')
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('toolbox:json_format →')
      expect(result.text).toContain('{\n  "a": 1\n}')
    }
  })

  it('reports unknown tools and missing args', async () => {
    const unknown = await run('run nope')
    expect(unknown.kind).toBe('error')
    if (unknown.kind === 'error') expect(unknown.text).toContain('未知工具 "nope"')

    const missing = await run('run json_format')
    expect(missing.kind).toBe('error')
    if (missing.kind === 'error') expect(missing.text).toContain('missing required arg "text"')
  })

  it('returns usage text for malformed commands', async () => {
    const result = await run('frobnicate')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('用法：/toolbox')
  })

  it('shows agent exposure status', async () => {
    const result = await run('agent', ['json_format'])
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('json_format：已暴露')
      expect(result.text).toContain('md5：未暴露')
      expect(result.text).toContain('file_hash：未暴露')
    }
  })

  it('suggests patch lines for toggles', async () => {
    const enable = await run('agent enable md5', [])
    expect(enable.kind).toBe('success')
    if (enable.kind === 'success') {
      expect(enable.text).toContain("agentTools: ['md5']")
    }
    const already = await run('agent enable json_format', ['json_format'])
    expect(already.kind).toBe('success')
    if (already.kind === 'success') expect(already.text).toContain('is already 已暴露')
  })

  it('supports english output', async () => {
    const def = toolboxCommand(resolveConfig({ agentTools: ['json_format'] }), 'en')
    const result = await def.handler({ rawInput: '' } as never) as HandlerResult
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('52 local tools')
      expect(result.text).toContain('## Text')
    }
    const agent = await def.handler({ rawInput: 'agent' } as never) as HandlerResult
    if (agent.kind === 'success') {
      expect(agent.text).toContain('json_format: exposed')
      expect(agent.text).toContain('md5: not exposed')
    }
  })
})