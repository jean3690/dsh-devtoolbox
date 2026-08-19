import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('applies safe defaults', () => {
    const resolved = resolveConfig(undefined)
    expect(resolved.agentTools).toEqual([])
    expect(resolved.userTools).toEqual([])
    expect(resolved.saveEnabled).toBe(true)
    expect(resolved.saveDir).toBe('toolbox-saves')
  })

  it('passes through explicit values', () => {
    const resolved = resolveConfig({
      agentTools: ['json_format', 'base64'],
      userTools: [{
        name: 'double',
        description: 'double the input',
        args: { x: { type: 'number', required: true } },
        run: '(args) => args.x * 2',
      }],
      saveEnabled: false,
      saveDir: 'out',
    })
    expect(resolved.agentTools).toEqual(['json_format', 'base64'])
    expect(resolved.userTools[0]!.name).toBe('double')
    expect(resolved.saveEnabled).toBe(false)
    expect(resolved.saveDir).toBe('out')
  })

  it("treats '*' as expose-all", () => {
    expect(resolveConfig({ agentTools: ['*'] }).agentTools).toEqual(['*'])
  })

  it('freezes the result', () => {
    const resolved = resolveConfig({ agentTools: ['*'] })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.agentTools)).toBe(true)
    expect(Object.isFrozen(resolved.userTools)).toBe(true)
  })

  it('rejects non-array agentTools', () => {
    expect(() => resolveConfig({ agentTools: 'json_format' as never })).toThrow(TypeError)
  })

  it('rejects non-string entries in agentTools', () => {
    expect(() => resolveConfig({ agentTools: [42] as never })).toThrow(TypeError)
  })

  it('rejects non-array userTools', () => {
    expect(() => resolveConfig({ userTools: {} as never })).toThrow(TypeError)
  })

  it('rejects invalid user tool names', () => {
    const base = { args: {}, description: 'd', run: '(args) => args' }
    expect(() => resolveConfig({ userTools: [{ name: 'Bad Name', ...base }] })).toThrow(/must match/)
    expect(() => resolveConfig({ userTools: [{ name: 'x', ...base }] })).toThrow(/must match/)
  })

  it('rejects user tools without run or description', () => {
    expect(() => resolveConfig({ userTools: [{ name: 'foo', args: {}, description: 'd', run: '' }] })).toThrow(/non-empty run/)
    expect(() => resolveConfig({ userTools: [{ name: 'foo', args: {}, description: '', run: '(a)=>a' }] })).toThrow(/description/)
  })

  it('rejects non-boolean saveEnabled and empty saveDir', () => {
    expect(() => resolveConfig({ saveEnabled: 'yes' as never })).toThrow(TypeError)
    expect(() => resolveConfig({ saveDir: '' })).toThrow(TypeError)
  })
})

describe('Config schema', () => {
  it('normalizes raw config with defaults', () => {
    const parsed = Config({})
    expect(parsed).toEqual({ agentTools: [], userTools: [], saveEnabled: true, saveDir: 'toolbox-saves' })
  })

  it('validates user tool entries', () => {
    const parsed = Config({ userTools: [{ name: 'echo', description: 'echo', args: {}, run: '(a)=>a' }] })
    expect(parsed.userTools![0]!.name).toBe('echo')
    expect(() => Config({ userTools: [{ name: 'echo', description: 'echo', args: {}, run: '' }] })).toThrow()
    expect(() => Config({ userTools: [{ name: 'echo', description: 'echo', args: { x: { type: 'date' as never } }, run: '(a)=>a' }] })).toThrow()
  })
})
