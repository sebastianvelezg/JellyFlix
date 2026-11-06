import { useCallback, useEffect, useState } from 'react'
import { searchCollections, searchTitles, type Session } from '../../../core'
import {
  channelSuggestions,
  createChannel,
  deleteChannel,
  previewChannel,
  updateChannel,
  type Channel,
  type ChannelDef,
  type ChannelPreview,
  type ChannelSource,
  type RuleSource,
  type TimeBlock,
} from '../../../core/modules'
import { t } from '../../../i18n'
import { errorText, useAsync } from '../../useAsync'
import { useModulesClient } from '../ModulesProvider'

const COLORS = ['#4d8dff', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#0091ff']

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const blank = (): ChannelDef => ({
  name: '',
  number: 1,
  color: COLORS[0] as string,
  sources: [],
  mode: 'marathon',
  order: 'interleave',
  blocks: [],
  timezone: browserZone(),
  avoidRepeat: 5,
  enabled: true,
})

const weekday = (day: number): string => new Date(2024, 0, 7 + day).toLocaleDateString(undefined, { weekday: 'short' })
const timeOf = (seconds: number): string => new Date(seconds * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/** Creating and editing a channel: what it shows, in what order, and (for a weekly grid) the stretches of the week. */
export function ChannelEditor({ session, channel, onDone, onCancel }: { session: Session; channel: Channel | null; onDone: () => void; onCancel: () => void }) {
  const { client } = useModulesClient()
  const [def, setDef] = useState<ChannelDef>(() => (channel ? { ...channel } : blank()))
  const [preview, setPreview] = useState<ChannelPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = <K extends keyof ChannelDef>(key: K, value: ChannelDef[K]) => {
    setDef((d) => ({ ...d, [key]: value }))
    setPreview(null)
  }

  async function run(work: () => Promise<unknown>, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await work()
      after?.()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(() => (channel ? updateChannel(client, channel.id, def) : createChannel(client, def)), onDone)
  const check = () => run(async () => setPreview(await previewChannel(client, def)))
  const remove = () => run(() => deleteChannel(client, channel!.id), onDone)

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h2 className="text-xl font-semibold tracking-tight text-white">{channel ? t('Edit channel') : t('New channel')}</h2>

      <div className="glass grid gap-4 rounded-2xl p-4 sm:grid-cols-[1fr_7rem_auto]">
        <label className="block text-sm text-neutral-300">
          {t('Name')}
          <input className="field mt-1" value={def.name} maxLength={60} required onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="block text-sm text-neutral-300">
          {t('Number')}
          <input className="field mt-1" type="number" min={1} max={9999} value={def.number} required onChange={(e) => set('number', Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <fieldset>
          <legend className="text-sm text-neutral-300">{t('Colour')}</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="color" className="peer sr-only" checked={def.color === c} onChange={() => set('color', c)} />
                <span className="block h-8 w-8 rounded-lg ring-offset-2 ring-offset-black peer-checked:ring-2 peer-checked:ring-white peer-focus-visible:ring-2" style={{ background: c }} title={c} />
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <Sources session={session} sources={def.sources} onChange={(next) => set('sources', next)} />

      <div className="glass grid gap-4 rounded-2xl p-4 sm:grid-cols-2">
        <label className="block text-sm text-neutral-300">
          {t('How it is programmed')}
          <select className="select mt-1 w-full" value={def.mode} onChange={(e) => set('mode', e.target.value as ChannelDef['mode'])}>
            <option value="marathon">{t('Marathon: one title after another, for ever')}</option>
            <option value="grid">{t('Weekly grid: different titles at different times')}</option>
          </select>
        </label>
        {def.mode === 'marathon' ? (
          <label className="block text-sm text-neutral-300">
            {t('Order')}
            <select className="select mt-1 w-full" value={def.order} onChange={(e) => set('order', e.target.value as ChannelDef['order'])}>
              <option value="interleave">{t('Series in order, mixed with the rest')}</option>
              <option value="sequential">{t('Exactly as listed')}</option>
              <option value="shuffle">{t('Shuffled')}</option>
            </select>
          </label>
        ) : (
          <label className="block text-sm text-neutral-300">
            {t('Do not repeat a title until this many others have been shown')}
            <input className="field mt-1" type="number" min={0} max={50} value={def.avoidRepeat} onChange={(e) => set('avoidRepeat', Math.min(50, Math.max(0, Math.floor(Number(e.target.value) || 0))))} />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-neutral-300 sm:col-span-2">
          <input type="checkbox" checked={def.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {t('The channel is on')}
        </label>
      </div>

      {def.mode === 'grid' && <Blocks def={def} onChange={(blocks) => set('blocks', blocks)} onZone={(zone) => set('timezone', zone)} />}

      {preview && (
        <section aria-label={t('Preview')} className="glass rounded-2xl p-4">
          <h3 className="text-base font-semibold text-white">{t('Preview of the next hours')}</h3>
          <p className="mt-1 text-xs text-neutral-400">{t('{count} titles can be shown.', { count: preview.poolSize })}</p>
          {preview.warnings.map((w) => (
            <p key={w} className="mt-1 text-xs text-amber-300">
              {w}
            </p>
          ))}
          <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm">
            {preview.programs.map((p) => (
              <li key={p.start} className="flex gap-3">
                <span className="w-28 shrink-0 tabular-nums text-neutral-500">{timeOf(p.start)}</span>
                <span className="truncate text-neutral-200">
                  {p.title}
                  {p.subtitle ? <span className="text-neutral-500"> · {p.subtitle}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy || !def.name.trim() || def.sources.length === 0}>
          {busy ? t('Working…') : t('Save channel')}
        </button>
        <button type="button" className="btn" disabled={busy || def.sources.length === 0} onClick={() => void check()}>
          {t('Preview')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </button>
        {channel &&
          (confirmDelete ? (
            <button type="button" className="btn ml-auto !border-red-500/40 !text-red-300" disabled={busy} onClick={() => void remove()}>
              {t('Yes, delete this channel')}
            </button>
          ) : (
            <button type="button" className="btn-ghost ml-auto text-red-300" disabled={busy} onClick={() => setConfirmDelete(true)}>
              {t('Delete channel')}
            </button>
          ))}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------------------------------

type Found = { id: string; name: string; itemType: string; year?: number }

/** The list of things that feed the channel, with a search to add titles and a small form to add a rule. */
function Sources({ session, sources, onChange }: { session: Session; sources: ChannelSource[]; onChange: (next: ChannelSource[]) => void }) {
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [searching, setSearching] = useState(false)
  const [rule, setRule] = useState(false)

  useEffect(() => {
    const text = term.trim()
    if (text.length < 2) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      Promise.all([searchTitles(session, 'movie', text, { limit: 6 }), searchTitles(session, 'series', text, { limit: 6 }), searchCollections(session, text, 6)])
        .then(([movies, shows, boxes]) => {
          if (cancelled) return
          setFound([
            ...movies.movies.map((m) => ({ id: m.id, name: m.name, itemType: 'Movie', ...(m.year ? { year: m.year } : {}) })),
            ...shows.movies.map((m) => ({ id: m.id, name: m.name, itemType: 'Series', ...(m.year ? { year: m.year } : {}) })),
            ...boxes.map((c) => ({ id: c.id, name: c.name, itemType: 'BoxSet' })),
          ])
        })
        .catch(() => {
          if (!cancelled) setFound([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [session, term])

  const shown = term.trim().length >= 2 ? found : []
  const add = (f: Found) => {
    if (sources.some((s) => s.kind === 'item' && s.id === f.id)) return
    onChange([...sources, { kind: 'item', id: f.id, name: f.name, itemType: f.itemType }])
  }
  const kindName = (type: string) => (type === 'Series' ? t('Series') : type === 'BoxSet' ? t('Collection') : t('Movie'))

  return (
    <section aria-label={t('What the channel shows')} className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-base font-semibold text-white">{t('What the channel shows')}</h3>
      {sources.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Add films, series or collections, or a rule such as “comedies from the 90s”.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {sources.map((s, i) => (
            <li key={`${s.kind}-${i}`} className="flex items-center gap-2 rounded-lg bg-white/[.04] px-3 py-1.5 text-sm">
              <span className="truncate text-neutral-100">
                {s.kind === 'item' ? s.name : describeRule(s)}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">{s.kind === 'item' ? kindName(s.itemType ?? 'Movie') : t('Rule')}</span>
              <button type="button" className="btn-ghost ml-auto !px-2 !py-1 text-xs" aria-label={t('Remove {name}', { name: s.name })} onClick={() => onChange(sources.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className="block text-sm text-neutral-300">
          {t('Search a film, a series or a collection')}
          <input className="field mt-1" type="search" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        {searching && <p role="status" className="mt-2 text-xs text-neutral-500">{t('Searching…')}</p>}
        {shown.length > 0 && (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {shown.map((f) => (
              <li key={`${f.itemType}-${f.id}`}>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-white/[.06]" onClick={() => add(f)}>
                  <span className="truncate text-neutral-100">
                    {f.name}
                    {f.year ? ` (${f.year})` : ''}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-neutral-500">{kindName(f.itemType)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rule ? (
        <RuleForm
          onAdd={(r) => {
            onChange([...sources, r])
            setRule(false)
          }}
          onCancel={() => setRule(false)}
        />
      ) : (
        <button type="button" className="btn" onClick={() => setRule(true)}>
          {t('Add a rule')}
        </button>
      )}
    </section>
  )
}

function describeRule(rule: RuleSource): string {
  const parts = [rule.genres.join(', ') || t('Any genre'), rule.types.map((x) => (x === 'Movie' ? t('films') : t('episodes'))).join(' + ')]
  if (rule.yearFrom || rule.yearTo) parts.push(`${rule.yearFrom ?? ''}–${rule.yearTo ?? ''}`)
  if (rule.unwatched) parts.push(t('not watched'))
  return parts.join(' · ')
}

function RuleForm({ onAdd, onCancel }: { onAdd: (rule: RuleSource) => void; onCancel: () => void }) {
  const { client } = useModulesClient()
  const load = useCallback(() => channelSuggestions(client), [client])
  const { state } = useAsync(load)
  const [genres, setGenres] = useState<string[]>([])
  const [films, setFilms] = useState(true)
  const [episodes, setEpisodes] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unwatched, setUnwatched] = useState(false)

  const types: RuleSource['types'] = [...(films ? (['Movie'] as const) : []), ...(episodes ? (['Episode'] as const) : [])]
  const year = (v: string) => (/^\d{4}$/.test(v) ? Number(v) : undefined)
  const rule: RuleSource = {
    kind: 'rule',
    name: genres.join(', ') || 'Rule',
    genres,
    types,
    ...(year(from) ? { yearFrom: year(from) as number } : {}),
    ...(year(to) ? { yearTo: year(to) as number } : {}),
    ...(unwatched ? { unwatched: true } : {}),
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 p-3">
      <fieldset>
        <legend className="text-sm text-neutral-300">{t('Genres')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {state.status === 'ready' &&
            state.data.genres.map((g) => (
              <label key={g} className={`chip cursor-pointer ${genres.includes(g) ? 'chip-accent' : ''}`}>
                <input type="checkbox" className="sr-only" checked={genres.includes(g)} onChange={() => setGenres((list) => (list.includes(g) ? list.filter((x) => x !== g) : [...list, g]))} />
                {g}
              </label>
            ))}
          {state.status === 'loading' && <span className="text-xs text-neutral-500">{t('Loading…')}</span>}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm text-neutral-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={films} onChange={(e) => setFilms(e.target.checked)} />
          {t('Films')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={episodes} onChange={(e) => setEpisodes(e.target.checked)} />
          {t('Series episodes')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={unwatched} onChange={(e) => setUnwatched(e.target.checked)} />
          {t('Only what I have not watched')}
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm text-neutral-300">
        <label>
          {t('From year')}
          <input className="field mt-1 w-28" inputMode="numeric" placeholder="1990" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('To year')}
          <input className="field mt-1 w-28" inputMode="numeric" placeholder="1999" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={types.length === 0} onClick={() => onAdd(rule)}>
          {t('Add this rule')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  )
}

/** The stretches of the week of a grid channel: which days, from when to when, and which of the channel's sources they draw from. */
function Blocks({ def, onChange, onZone }: { def: ChannelDef; onChange: (blocks: TimeBlock[]) => void; onZone: (zone: string) => void }) {
  const update = (i: number, patch: Partial<TimeBlock>) => onChange(def.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])
  return (
    <section aria-label={t('Weekly grid')} className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-base font-semibold text-white">{t('Weekly grid')}</h3>
      <p className="text-sm text-neutral-400">{t('Each block draws only from the sources you tick. When no block covers a moment, the channel draws from everything. Times are in {zone}.', { zone: def.timezone })}</p>
      <label className="block w-64 text-sm text-neutral-300">
        {t('Time zone')}
        <input className="field mt-1" value={def.timezone} onChange={(e) => onZone(e.target.value)} />
      </label>
      {def.blocks.map((b, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-white/10 p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Days')}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} className={`chip cursor-pointer ${b.days.includes(d) ? 'chip-accent' : ''}`}>
                <input type="checkbox" className="sr-only" checked={b.days.includes(d)} onChange={() => update(i, { days: toggle(b.days, d) })} />
                {weekday(d)}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-neutral-300">
            <label>
              {t('From')}
              <input className="field mt-1" type="time" value={b.start} onChange={(e) => update(i, { start: e.target.value })} />
            </label>
            <label>
              {t('To')}
              <input className="field mt-1" type="time" value={b.end} onChange={(e) => update(i, { end: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Sources of this block')}>
            {def.sources.map((s, si) => (
              <label key={si} className={`chip cursor-pointer ${b.sources.includes(si) ? 'chip-accent' : ''}`}>
                <input type="checkbox" className="sr-only" checked={b.sources.includes(si)} onChange={() => update(i, { sources: toggle(b.sources, si) })} />
                {s.name}
              </label>
            ))}
          </div>
          <button type="button" className="btn-ghost text-xs text-red-300" onClick={() => onChange(def.blocks.filter((_, j) => j !== i))}>
            {t('Remove this block')}
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...def.blocks, { days: [6], start: '16:00', end: '22:00', sources: [] }])}>
        {t('Add a block')}
      </button>
    </section>
  )
}
