import { afterEach, describe, expect, it } from 'vitest'
import { setLanguage } from '../../../i18n'
import { programTitle } from './programText'

afterEach(async () => {
  await setLanguage('en')
})

describe('what a program is called on screen', () => {
  it('is its title, and a plain note when this account may not see the title', async () => {
    expect(programTitle({ title: 'Film 1' })).toBe('Film 1')
    expect(programTitle({ title: 'Program not available', unavailable: true })).toBe('Program not available')
    await setLanguage('es')
    expect(programTitle({ title: 'Program not available', unavailable: true })).toBe('Programa no disponible')
    // A real title is never translated or changed.
    expect(programTitle({ title: 'Film 1' })).toBe('Film 1')
  })
})
