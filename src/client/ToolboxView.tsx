/**
 * The toolbox main view: category navigation + searchable tool grid, and the
 * per-tool page (arg form → run → result with copy/save/download). All tool
 * execution is local (the pure tool library runs in the browser); the only
 * host round trip is the optional "save to project" RPC.
 *
 * @module dsh-toolbox/client/ToolboxView
 */

import { useMemo, useState } from 'react'
import type { ToolboxController } from './controller.ts'
import { CATEGORIES, TOOLS, coerceArgs, type CategoryId, type ToolFn, type ToolResult } from '../tools/index.ts'
import { renderResultText } from '../present.ts'
import { lookup, currentLang, type ToolboxLang } from '../i18n.ts'

/** The save RPC as the view needs it (undefined = host half unavailable). */
export type SaveFn = (request: { fileName: string; content: string; subdir?: string }) => Promise<{ path: string }>

interface ToolboxViewProps {
  controller: ToolboxController
  save?: SaveFn
}

/** The toolbox main view. */
export function ToolboxView({ controller, save }: ToolboxViewProps): JSX.Element {
  const lang = useMemo(() => currentLang(), [])
  const t = (key: string) => lookup(lang, key)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryId | 'all'>('all')
  const [query, setQuery] = useState('')

  const selected = selectedId === null ? undefined : TOOLS.find(tool => tool.id === selectedId)
  const close = (): void => { controller.closeBoard() }

  if (selected !== undefined) {
    return (
      <ToolPage key={selected.id} tool={selected} lang={lang} save={save} onBack={() => setSelectedId(null)} />
    )
  }

  const q = query.trim().toLocaleLowerCase()
  const visible = TOOLS.filter(tool => {
    if (category !== 'all' && tool.category !== category) return false
    if (q === '') return true
    const name = lookup(lang, tool.nameKey).toLocaleLowerCase()
    const desc = lookup(lang, tool.descKey).toLocaleLowerCase()
    return tool.id.includes(q) || name.includes(q) || desc.includes(q)
  })

  return (
    <div className="dsh-toolbox-root">
      <div className="dsh-toolbox-header">
        <button type="button" className="dsh-toolbox-back" onClick={close}>{t('view.close')}</button>
        <span className="dsh-toolbox-title">{t('view.title')}</span>
        <span className="dsh-toolbox-subtitle">{t('view.subtitle')}</span>
        <input
          className="dsh-toolbox-search"
          placeholder={t('view.search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>
      <div className="dsh-toolbox-cats">
        <button
          type="button"
          className="dsh-toolbox-cat"
          data-active={category === 'all' ? 'true' : undefined}
          onClick={() => setCategory('all')}
        >
          {t('view.all')}
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            type="button"
            className="dsh-toolbox-cat"
            data-active={category === cat.id ? 'true' : undefined}
            onClick={() => setCategory(cat.id)}
          >
            {cat.icon} {t(cat.nameKey)}
          </button>
        ))}
      </div>
      <div className="dsh-toolbox-grid">
        {visible.length === 0 && <div className="dsh-toolbox-empty">{t('view.empty')}</div>}
        {visible.map(tool => (
          <button
            key={tool.id}
            type="button"
            className="dsh-toolbox-card"
            onClick={() => setSelectedId(tool.id)}
          >
            <span className="dsh-toolbox-cardName">
              <span className="dsh-toolbox-entryIcon">{categoryIcon(tool.category)}</span>
              {lookup(lang, tool.nameKey)}
            </span>
            <span className="dsh-toolbox-cardDesc">{lookup(lang, tool.descKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Small per-category glyph for cards. */
function categoryIcon(category: CategoryId): string {
  return CATEGORIES.find(cat => cat.id === category)?.icon ?? '🛠️'
}

/* ------------------------------------------------------------------ */
/* Tool page                                                           */
/* ------------------------------------------------------------------ */

interface ToolPageProps {
  tool: ToolFn
  lang: ToolboxLang
  save?: SaveFn
  onBack: () => void
}

type FieldValue = string | number | boolean

function ToolPage({ tool, lang, save, onBack }: ToolPageProps): JSX.Element {
  const t = (key: string) => lookup(lang, key)
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const init: Record<string, FieldValue> = {}
    for (const [name, spec] of Object.entries(tool.args)) {
      if (spec.default !== undefined) init[name] = spec.default
      else if (spec.type === 'number') init[name] = ''
      else if (spec.type === 'boolean') init[name] = false
      else init[name] = ''
    }
    return init
  })
  const [result, setResult] = useState<ToolResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    setResult(null)
    setSaved(null)
    setSaveError(null)
    try {
      const coerced = coerceArgs(tool, values)
      if (!coerced.ok) {
        setError(coerced.error)
        return
      }
      const out = await tool.run(coerced.value)
      setResult(out)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRunning(false)
    }
  }

  const resultText = (): string => {
    if (result === null) return ''
    return result.kind === 'table' ? renderResultText(result) : renderResultText(result)
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(resultText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (permissions); fall back to selection.
    }
  }

  const download = (): void => {
    const blob = new Blob([resultText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `toolbox-${tool.id}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const saveToProject = async (): Promise<void> => {
    if (save === undefined) {
      setSaveError('save RPC unavailable')
      return
    }
    try {
      const out = await save({
        fileName: `toolbox-${tool.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
        content: resultText(),
      })
      setSaved(out.path)
      setSaveError(null)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const setField = (name: string, value: FieldValue): void => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const textArg = Object.entries(tool.args).find(([, spec]) => spec.type === 'string' && (spec.required || tool.textPayload === true))
  const otherArgs = Object.entries(tool.args).filter(([name]) => name !== textArg?.[0])

  return (
    <div className="dsh-toolbox-root">
      <div className="dsh-toolbox-header">
        <button type="button" className="dsh-toolbox-back" onClick={onBack}>{t('view.back')}</button>
        <span className="dsh-toolbox-title">{lookup(lang, tool.nameKey)}</span>
        <span className="dsh-toolbox-subtitle">{tool.id}</span>
      </div>
      <div className="dsh-toolbox-page">
        <div className="dsh-toolbox-pageDesc">{lookup(lang, tool.descKey)}</div>

        {textArg !== undefined && (
          <div className="dsh-toolbox-field">
            <label className="dsh-toolbox-fieldLabel" htmlFor={`tb-${tool.id}-text`}>
              {tool.textPayload === true ? t('page.textPayload') : textArg[1].description ?? textArg[0]}
            </label>
            <textarea
              id={`tb-${tool.id}-text`}
              className="dsh-toolbox-input"
              rows={8}
              value={String(values[textArg[0]] ?? '')}
              onChange={event => setField(textArg[0], event.target.value)}
            />
          </div>
        )}

        {otherArgs.map(([name, spec]) => (
          <div key={name} className="dsh-toolbox-field">
            {spec.type === 'boolean' ? (
              <label className="dsh-toolbox-check">
                <input
                  type="checkbox"
                  checked={values[name] === true}
                  onChange={event => setField(name, event.target.checked)}
                />
                {name} — {spec.description ?? ''}
              </label>
            ) : (
              <>
                <label className="dsh-toolbox-fieldLabel" htmlFor={`tb-${tool.id}-${name}`}>
                  {name}{spec.required ? ' *' : ''} — {spec.description ?? ''}
                </label>
                <input
                  id={`tb-${tool.id}-${name}`}
                  className={`dsh-toolbox-input dsh-toolbox-inputSmall`}
                  type={spec.type === 'number' ? 'number' : 'text'}
                  value={String(values[name] ?? '')}
                  onChange={event => setField(name, spec.type === 'number' ? event.target.value : event.target.value)}
                />
              </>
            )}
          </div>
        ))}

        <button type="button" className="dsh-toolbox-run" onClick={() => void run()} disabled={running}>
          {running ? t('page.running') : t('page.run')}
        </button>

        {error !== null && <div className="dsh-toolbox-error">{error}</div>}

        {result !== null && (
          <div className="dsh-toolbox-result">
            <div className="dsh-toolbox-resultBar">
              <span className="dsh-toolbox-resultLabel">{t('page.result')}</span>
              <button type="button" className="dsh-toolbox-action" onClick={() => void copy()}>
                {copied ? t('page.copied') : t('page.copy')}
              </button>
              <button type="button" className="dsh-toolbox-action" onClick={download}>{t('page.download')}</button>
              <button type="button" className="dsh-toolbox-action" onClick={() => void saveToProject()}>
                {t('page.save')}
              </button>
            </div>
            <ResultView result={result} />
            {saved !== null && <div className="dsh-toolbox-note">{t('page.saved')}: {saved}</div>}
            {saveError !== null && <div className="dsh-toolbox-error">{t('page.saveFail')}: {saveError}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/** Render one ToolResult (text / json / table). */
function ResultView({ result }: { result: ToolResult }): JSX.Element {
  if (result.kind === 'table') {
    return (
      <>
        {result.note !== undefined && <div className="dsh-toolbox-note">{result.note}</div>}
        <div className="dsh-toolbox-tableWrap">
          <table className="dsh-toolbox-table">
            <thead>
              <tr>{result.columns.map(col => <th key={col}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      {j === 0 && isHexColor(cell) && <span className="dsh-toolbox-swatch" style={{ background: String(cell) }} />}
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }
  const text = result.kind === 'json' ? JSON.stringify(result.json, null, 2) : result.text
  return <pre className="dsh-toolbox-pre">{text}</pre>
}

/** Swatch for the color tool's hex output row. */
function isHexColor(value: string | number): boolean {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}
