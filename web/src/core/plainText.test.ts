// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { plainText } from './plainText'

describe('a description as plain text', () => {
  it('leaves plain text exactly as it is', () => {
    expect(plainText('A vampire hunter fights to save a city.')).toBe('A vampire hunter fights to save a city.')
    expect(plainText('Line one\nLine two')).toBe('Line one\nLine two')
    expect(plainText(undefined)).toBeUndefined()
    expect(plainText(null)).toBeUndefined()
    expect(plainText('')).toBeUndefined()
  })

  it('drops the tags and keeps the paragraphs apart', () => {
    expect(plainText('<p><b>Bold start.</b></p> <p>Second <em>paragraph</em>.</p>')).toBe('Bold start. Second paragraph.')
    expect(plainText('One<br>Two<br/>Three')).toBe('One Two Three')
    expect(plainText('<p>Dune</p><p>is a novel.</p>')).toBe('Dune is a novel.')
  })

  it('turns entities back into characters', () => {
    expect(plainText('Rock &amp; roll &mdash; &quot;live&quot; &#39;74 &#x41;')).toBe('Rock & roll &mdash; "live" \'74 A')
    expect(plainText('5 &lt; 6 &gt; 4&nbsp;now')).toBe('5 < 6 > 4 now')
  })

  it('does not run anything: a script tag only loses its tags', () => {
    expect(plainText('Hi<script>alert(1)</script> there')).toBe('Hialert(1) there')
  })

  it('is empty when nothing is left', () => {
    expect(plainText('<p> </p>')).toBeUndefined()
  })

  it('keeps a lone ampersand or a comparison', () => {
    expect(plainText('Tom & Jerry')).toBe('Tom & Jerry')
    expect(plainText('2 < 3')).toBe('2 < 3')
  })
})
