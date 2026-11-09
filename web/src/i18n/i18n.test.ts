// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { ADMIN_TEXTS, ALBUM_SORT_LABELS, FIELD_LABELS as DETAIL_LABELS, ARTIST_SORT_LABELS, COLLECTION_SORT_LABELS, FILTER_LABELS, HOME_ROW_LABEL, TRANSCODE_REASONS, SORT_LABELS, TRACK_SORT_LABELS } from '../core'
import { ADMIN_SERVER_TEXTS } from '../core/extra'
import { ACCENTS, CANVASES } from '../theme/themes'
import { de, dePatterns } from './de'
import { es, esPatterns } from './es'
import { fr, frPatterns } from './fr'
import { getLanguage, resolveLanguage, setLanguage, t, type Language } from './index'
import { pt, ptPatterns } from './pt'

afterEach(async () => {
  await setLanguage('en')
})

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('t', () => {
  it('returns the English text as it is, with placeholders filled in', () => {
    expect(t('Continue watching')).toBe('Continue watching')
    expect(t('Open {title}', { title: 'Anora' })).toBe('Open Anora')
    expect(t('{count} songs', { count: 3 })).toBe('3 songs')
    expect(t('Nothing {here}', {})).toBe('Nothing {here}') // an unknown placeholder is left alone
  })

  it('uses the Spanish text, with placeholders, once the language is Spanish', async () => {
    await setLanguage('es')
    expect(getLanguage()).toBe('es')
    expect(t('Continue watching')).toBe('Continuar viendo')
    expect(t('Resume from {time}', { time: '32:48' })).toBe('Continuar desde 32:48')
  })

  it('shows English for a text that has no translation, never a blank or a key', async () => {
    await setLanguage('es')
    expect(t('A text nobody translated')).toBe('A text nobody translated')
  })

  it('translates messages with numbers or names in them by pattern', async () => {
    await setLanguage('es')
    expect(t('The server reported an error (HTTP 503).')).toBe('El servidor informó un error (HTTP 503).')
    expect(t('Could not play “Song 1.1”. The connection to the server was lost.')).toBe(
      'No se pudo reproducir “Song 1.1”. The connection to the server was lost.',
    )
    await setLanguage('en')
    expect(t('The server reported an error (HTTP 503).')).toBe('The server reported an error (HTTP 503).')
  })
})

describe('setLanguage', () => {
  it('lets the last choice win when an earlier one is still being fetched', async () => {
    const slow = setLanguage('es')
    const quick = setLanguage('en')
    await Promise.all([slow, quick])
    expect(getLanguage()).toBe('en')
    expect(t('Continue watching')).toBe('Continue watching')
  })

  it('keeps the Spanish texts in memory once they were fetched', async () => {
    await setLanguage('es')
    await setLanguage('en')
    await setLanguage('es')
    expect(t('Continue watching')).toBe('Continuar viendo')
  })
})

describe('resolveLanguage', () => {
  it('follows the browser for "auto", and a chosen language wins', () => {
    expect(resolveLanguage('auto', ['es-CO', 'en-US'])).toBe('es')
    expect(resolveLanguage('auto', ['fr-FR', 'en-GB'])).toBe('fr')
    expect(resolveLanguage('auto', ['pt-BR'])).toBe('pt')
    expect(resolveLanguage('auto', ['pt-PT', 'es'])).toBe('pt')
    expect(resolveLanguage('auto', ['de-AT'])).toBe('de')
    expect(resolveLanguage('auto', ['ja-JP', 'de'])).toBe('de') // the first language we have texts for
    expect(resolveLanguage('auto', ['ja-JP'])).toBe('en')
    expect(resolveLanguage('auto', [])).toBe('en')
    expect(resolveLanguage('en', ['es'])).toBe('en')
    expect(resolveLanguage('es', ['en'])).toBe('es')
  })
})

describe('the Spanish dictionary', () => {
  it('keeps every placeholder of the English text', () => {
    const wrong = Object.entries(es).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
    expect(wrong.map(([key]) => key)).toEqual([])
  })

  it('has a translation for every text used in the code', () => {
    const missing = new Set<string>()
    let scanned = 0
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? walk(path) : [path]
      })
    const root = join(import.meta.dirname, '..')
    const files = walk(root).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/[\\/]i18n[\\/]/.test(f))
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const texts: string[] = []
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 't' || node.expression.text === 'tr')) {
          const arg = node.arguments[0]
          const literals = arg && ts.isConditionalExpression(arg) ? [arg.whenTrue, arg.whenFalse] : arg ? [arg] : []
          for (const literal of literals) {
            if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) texts.push(literal.text)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      scanned += texts.length
      for (const text of texts) if (!(text in es)) missing.add(`${file.slice(root.length + 1)}: ${text}`)
    }
    expect(scanned).toBeGreaterThan(250) // the scan really did find the texts
    expect([...missing].sort()).toEqual([])
  })

  it('covers the labels the core keeps for sorting and filtering', () => {
    const labels = [
      ...Object.values(SORT_LABELS),
      ...Object.values(FILTER_LABELS),
      ...Object.values(ALBUM_SORT_LABELS),
      ...Object.values(TRACK_SORT_LABELS),
      ...Object.values(ARTIST_SORT_LABELS),
      ...Object.values(COLLECTION_SORT_LABELS),
      ...Object.values(HOME_ROW_LABEL),
      ...Object.values(TRANSCODE_REASONS),
      ...ADMIN_TEXTS,
      ...ADMIN_SERVER_TEXTS,
      ...Object.values(DETAIL_LABELS),
      ...CANVASES.map((c) => c.label),
      ...ACCENTS.map((a) => a.label),
      'Compact',
      'Comfortable',
      'Default',
    ]
    expect(labels.filter((label) => !(label in es))).toEqual([])
  })

  it('has valid patterns', () => {
    for (const [pattern, template] of esPatterns) {
      const groups = new RegExp(`${pattern.source}|`).exec('')?.length ?? 0
      expect(template.match(/\$\d/g)?.length ?? 0).toBeLessThanOrEqual(groups)
    }
  })
})

/** The other languages are checked against the Spanish dictionary, which the code is checked against. */
const others: Array<[Language, Record<string, string>, Array<[RegExp, string]>, string]> = [
  ['pt', pt, ptPatterns, 'Continuar assistindo'],
  ['fr', fr, frPatterns, 'Reprendre la lecture'],
  ['de', de, dePatterns, 'Weiterschauen'],
]

describe.each(others)('the %s dictionary', (language, dictionary, patterns, continueWatching) => {
  it('has exactly the texts the Spanish one has, with the same placeholders', () => {
    const keys = Object.keys(es)
    expect(Object.keys(dictionary).filter((key) => !(key in es))).toEqual([])
    expect(keys.filter((key) => !(key in dictionary))).toEqual([])
    const wrong = Object.entries(dictionary).filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
    expect(wrong.map(([key]) => key)).toEqual([])
  })

  it('has no empty text, and translates what matters', () => {
    expect(Object.entries(dictionary).filter(([, value]) => !value.trim())).toEqual([])
    // Most texts differ from the English one (names such as Jellyflix, Anime or Quick Connect legitimately do not).
    const same = Object.entries(dictionary).filter(([key, value]) => key === value).length
    expect(same / Object.keys(dictionary).length).toBeLessThan(0.15)
  })

  it('has valid patterns that translate the messages with numbers in them', async () => {
    for (const [pattern, template] of patterns) {
      const groups = new RegExp(`${pattern.source}|`).exec('')?.length ?? 0
      expect(template.match(/\$\d/g)?.length ?? 0).toBeLessThanOrEqual(groups)
    }
    await setLanguage(language)
    const text = t('The server reported an error (HTTP 503).')
    expect(text).not.toBe('The server reported an error (HTTP 503).')
    expect(text).toContain('503')
  })

  it('is loaded by setLanguage and used by t', async () => {
    await setLanguage(language)
    expect(getLanguage()).toBe(language)
    expect(t('Continue watching')).toBe(continueWatching)
    expect(t('Resume from {time}', { time: '32:48' })).toContain('32:48')
  })
})
