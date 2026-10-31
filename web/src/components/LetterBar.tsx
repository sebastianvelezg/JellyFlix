import { t } from '../i18n'

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

/**
 * A row of letters above an A-Z list: choosing one shows the list from the first title that starts with it, so a library of
 * thousands is crossed in one click. "#" is the beginning (numbers and symbols come first).
 */
export function LetterBar({ value, onChange }: { value: string; onChange: (letter: string) => void }) {
  return (
    <div role="group" aria-label={t('Jump to letter')} className="no-scrollbar -mx-1 mb-4 flex gap-0.5 overflow-x-auto px-1">
      {['#', ...LETTERS].map((letter) => {
        const current = (value || '#') === letter
        return (
          <button
            key={letter}
            type="button"
            aria-pressed={current}
            aria-label={letter === '#' ? t('From the beginning') : letter}
            onClick={() => onChange(letter === '#' ? '' : letter)}
            className={`h-8 min-w-8 shrink-0 rounded-full px-2 text-[13px] font-medium transition-colors duration-150 pointer-coarse:h-10 pointer-coarse:min-w-10 ${
              current
                ? 'bg-white text-black'
                : 'text-neutral-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}
