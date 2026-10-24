import { useState } from 'react'
import {
  DEFAULT_HOME_LAYOUT,
  DEFAULT_MENU_LAYOUT,
  HOME_ROW_LABEL,
  isDefaultHomeLayout,
  isDefaultMenuLayout,
  isMenuItemVisible,
  isRowVisible,
  moveMenuItem,
  moveRow,
  toggleMenuItem,
  toggleRow,
  type HomeRowId,
  type MenuId,
} from '../core'
import {
  APPEARANCE_DEFAULTS,
  BANNER_SIZES,
  DENSITIES,
  NAV_STYLES,
  POSTER_SIZES,
  UI_SIZES,
  applyAppearance,
  resetAppearance,
  useAppearance,
  writeAppearance,
  type AppearancePrefs,
  type BannerSize,
  type Density,
  type NavStyle,
  type PosterSize,
  type UiSize,
} from '../platform/web/appearance'
import { t } from '../i18n'
import { ACCENTS, CANVASES, accentColor, resolveAccent, sanitizeTheme, type Canvas } from '../theme/themes'
import { BannerDrawing, DensityDrawing, NavDrawing, PickCards, UiSizeDrawing } from './LayoutCards'
import { TAB_LABELS } from './Header'
import { Card, Toggle } from './SettingsParts'

const POSTER_LABEL: Record<PosterSize, string> = { compact: 'Compact', comfortable: 'Comfortable', large: 'Large' }
/** How wide the little posters of each size are drawn in the picker (the real sizes are in index.css). */
const POSTER_DRAW: Record<PosterSize, number> = { compact: 22, comfortable: 28, large: 36 }

const UI_SIZE_LABEL: Record<UiSize, string> = { small: 'Small', default: 'Default', large: 'Large' }
const DENSITY_LABEL: Record<Density, string> = { comfortable: 'Comfortable', compact: 'Compact' }
const BANNER_LABEL: Record<BannerSize, string> = { large: 'Large', compact: 'Compact' }
const NAV_LABEL: Record<NavStyle, string> = { full: 'Icons and names', icons: 'Icons only', text: 'Names only' }

const ring =
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)]'

/** A small picture of the app in one background: the surfaces, a few posters, and the accent. */
function CanvasPreview({ canvas, accent }: { canvas: Canvas; accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="block overflow-hidden rounded-xl border"
      style={{ background: canvas.bg, borderColor: canvas.border }}
    >
      <span className="flex items-center gap-1.5 px-2 pt-2" style={{ color: accent }}>
        <span className="h-1.5 w-8 rounded-full" style={{ background: 'currentColor' }} />
        <span className="h-1.5 w-4 rounded-full" style={{ background: canvas.surface3 }} />
      </span>
      <span className="flex gap-1.5 p-2">
        {[canvas.surface, canvas.surface2, canvas.surface3].map((fill, i) => (
          <span key={i} className="h-9 flex-1 rounded-md border" style={{ background: fill, borderColor: canvas.border }} />
        ))}
      </span>
    </span>
  )
}

function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m6 15 6-6 6 6" />
    </svg>
  )
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/** Settings → Appearance: the colours, the size of the posters, and which rows the home page has. Everything is saved on this device only. */
export function AppearanceSettings() {
  const prefs = useAppearance()
  const [announcement, setAnnouncement] = useState('')

  // Every change is saved and shown at once, on this page and everywhere else.
  const save = (patch: Partial<AppearancePrefs>) => applyAppearance(writeAppearance(patch))

  const { theme, home } = prefs
  const pickedPreset = ACCENTS.find((a) => a.id === theme.accent)
  const customColor = pickedPreset ? null : accentColor(theme.accent)
  const rowLabel = (id: HomeRowId) => t(HOME_ROW_LABEL[id])

  const { menu } = prefs
  const moveButton = (id: MenuId, direction: -1 | 1) => {
    const next = moveMenuItem(menu, id, direction)
    save({ menu: next })
    setAnnouncement(t('{row} is now number {position}', { row: t(TAB_LABELS[id]), position: next.order.indexOf(id) + 1 }))
  }

  const move = (id: HomeRowId, direction: -1 | 1) => {
    const next = moveRow(home, id, direction)
    save({ home: next })
    setAnnouncement(t('{row} is now number {position}', { row: rowLabel(id), position: next.order.indexOf(id) + 1 }))
  }

  return (
    <>
      <Card title={t('Theme')} description={t('Pick the background and the accent colour. The whole app follows, and it is remembered on this device.')}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-neutral-100">{t('Background')}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CANVASES.map((canvas) => (
              <label key={canvas.id} className="cursor-pointer">
                <input
                  type="radio"
                  name="canvas"
                  className="peer sr-only"
                  checked={theme.canvas === canvas.id}
                  onChange={() => save({ theme: sanitizeTheme({ ...theme, canvas: canvas.id }) })}
                />
                <span className={`block rounded-2xl border-2 border-transparent p-1 transition hover:border-white/20 peer-checked:border-[var(--color-accent)] ${ring}`}>
                  <CanvasPreview canvas={canvas} accent={resolveAccent({ canvas: canvas.id, accent: theme.accent }).accent} />
                  <span className="mt-1.5 block px-1 pb-0.5 text-sm text-neutral-200">{t(canvas.label)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-neutral-100">{t('Accent colour')}</legend>
          <div className="flex flex-wrap items-center gap-3">
            {ACCENTS.map((accent) => (
              <label key={accent.id} className="cursor-pointer" title={t(accent.label)}>
                <input
                  type="radio"
                  name="accent"
                  className="peer sr-only"
                  aria-label={t(accent.label)}
                  checked={theme.accent === accent.id}
                  onChange={() => save({ theme: sanitizeTheme({ ...theme, accent: accent.id }) })}
                />
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-transparent p-0.5 transition hover:scale-105 peer-checked:border-white ${ring}`}
                >
                  <span className="block h-full w-full rounded-full" style={{ background: accent.color }} />
                </span>
              </label>
            ))}
            <label className="cursor-pointer" title={t('Choose any colour')}>
              <input
                type="color"
                className="peer sr-only"
                aria-label={t('Custom colour')}
                value={customColor ?? accentColor(theme.accent)}
                onChange={(e) => save({ theme: sanitizeTheme({ ...theme, accent: e.target.value }) })}
              />
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 p-0.5 transition hover:scale-105 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)] ${
                  customColor ? 'border-white' : 'border-transparent'
                }`}
              >
                <span
                  className="block h-full w-full rounded-full"
                  style={{ background: customColor ?? 'conic-gradient(#f87171, #fbbf24, #34d399, #38bdf8, #a78bfa, #f472b6, #f87171)' }}
                />
              </span>
            </label>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {t('Any colour works: it is adjusted automatically so text on it stays easy to read.')}
          </p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-3" aria-hidden="true">
          <span className="btn-primary pointer-events-none">{t('Play')}</span>
          <span className="chip-accent">4K</span>
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/15">
            <span className="block h-full w-2/3 rounded-full bg-[var(--color-accent)]" />
          </span>
          <span className="text-sm text-[var(--color-accent)]">{t('See all')}</span>
        </div>
      </Card>

      <Card title={t('Posters')} description={t('How large the posters are in rows and grids.')}>
        <fieldset>
          <legend className="sr-only">{t('Poster size')}</legend>
          <div className="grid grid-cols-3 gap-3">
            {POSTER_SIZES.map((size) => (
              <label key={size} className="cursor-pointer">
                <input
                  type="radio"
                  name="poster-size"
                  className="peer sr-only"
                  checked={prefs.posterSize === size}
                  onChange={() => save({ posterSize: size })}
                />
                <span
                  className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-white/10 px-2 py-3 transition hover:border-white/25 peer-checked:border-[var(--color-accent)] peer-checked:bg-[var(--color-accent)]/10 ${ring}`}
                >
                  <span aria-hidden="true" className="flex h-12 items-end gap-1">
                    {[0, 1].map((i) => (
                      <span
                        key={i}
                        className="rounded-sm bg-[var(--color-surface-3)] ring-1 ring-white/15"
                        style={{ width: POSTER_DRAW[size], height: POSTER_DRAW[size] * 1.5 }}
                      />
                    ))}
                  </span>
                  <span className="text-sm text-neutral-200">{t(POSTER_LABEL[size])}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card title={t('Layout')} description={t('How much fits on the screen.')}>
        <PickCards
          name="ui-size"
          legend={t('Interface size')}
          hint={t('Scales the text and the controls.')}
          options={UI_SIZES}
          labels={UI_SIZE_LABEL}
          value={prefs.uiSize}
          onChange={(uiSize) => save({ uiSize })}
          draw={(size) => <UiSizeDrawing size={size} />}
        />
        <PickCards
          name="density"
          legend={t('Space between rows')}
          options={DENSITIES}
          labels={DENSITY_LABEL}
          value={prefs.density}
          onChange={(density) => save({ density })}
          draw={(density) => <DensityDrawing density={density} />}
        />
        <PickCards
          name="banner-size"
          legend={t('Featured banner height')}
          options={BANNER_SIZES}
          labels={BANNER_LABEL}
          value={prefs.banner}
          onChange={(banner) => save({ banner })}
          draw={(size) => <BannerDrawing size={size} />}
        />
        <PickCards
          name="nav-style"
          legend={t('Menu buttons')}
          hint={t('What Home, Movies, Live TV and the other buttons of the menu show. With both, the names give way to the icons when there is no room.')}
          options={NAV_STYLES}
          labels={NAV_LABEL}
          value={prefs.nav}
          onChange={(nav) => save({ nav })}
          draw={(style) => <NavDrawing style={style} />}
        />
      </Card>

      <Card title={t('Top menu')} description={t('Show, hide and reorder the buttons at the top. A button for a kind of library you do not have is left out anyway. Home always stays.')}>
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
          {menu.order.map((id, index) => {
            const visible = isMenuItemVisible(menu, id)
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-2">
                <label className={`flex min-w-0 flex-1 items-center gap-3 ${id === 'home' ? '' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={visible}
                    disabled={id === 'home'}
                    onChange={() => save({ menu: toggleMenuItem(menu, id) })}
                    className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className={`truncate text-sm ${visible ? 'text-neutral-100' : 'text-neutral-500 line-through'}`}>{t(TAB_LABELS[id])}</span>
                </label>
                <button type="button" className="btn-ghost !px-2" aria-label={t('Move {row} up', { row: t(TAB_LABELS[id]) })} disabled={index === 0} onClick={() => moveButton(id, -1)}>
                  <UpIcon />
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  aria-label={t('Move {row} down', { row: t(TAB_LABELS[id]) })}
                  disabled={index === menu.order.length - 1}
                  onClick={() => moveButton(id, 1)}
                >
                  <DownIcon />
                </button>
              </li>
            )
          })}
        </ul>
        <div>
          <button type="button" className="btn" disabled={isDefaultMenuLayout(menu)} onClick={() => save({ menu: DEFAULT_MENU_LAYOUT })}>
            {t('Restore the menu')}
          </button>
        </div>
      </Card>

      <Card title={t('Home page')} description={t('Show, hide and reorder what the home page is made of. Rows for a kind of library you do not have are left out anyway.')}>
        <Toggle
          label={t('Featured banner')}
          hint={t('The large picture at the top of the home page.')}
          checked={home.banner}
          onChange={(banner) => save({ home: { ...home, banner } })}
        />
        <ul className="divide-y divide-white/10 rounded-2xl border border-white/10">
          {home.order.map((id, index) => {
            const visible = isRowVisible(home, id)
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={visible}
                    onChange={() => save({ home: toggleRow(home, id) })}
                    className="h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className={`truncate text-sm ${visible ? 'text-neutral-100' : 'text-neutral-500 line-through'}`}>{rowLabel(id)}</span>
                </label>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  aria-label={t('Move {row} up', { row: rowLabel(id) })}
                  disabled={index === 0}
                  onClick={() => move(id, -1)}
                >
                  <UpIcon />
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  aria-label={t('Move {row} down', { row: rowLabel(id) })}
                  disabled={index === home.order.length - 1}
                  onClick={() => move(id, 1)}
                >
                  <DownIcon />
                </button>
              </li>
            )
          })}
        </ul>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={isDefaultHomeLayout(home)} onClick={() => save({ home: DEFAULT_HOME_LAYOUT })}>
            {t('Restore the home page')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={JSON.stringify(prefs) === JSON.stringify(APPEARANCE_DEFAULTS)}
            onClick={() => {
              resetAppearance()
              setAnnouncement(t('Appearance restored to the original look.'))
            }}
          >
            {t('Reset all appearance')}
          </button>
        </div>
      </Card>
    </>
  )
}
