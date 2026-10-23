import type { ElementType } from 'react'

/**
 * A secondary line (a year, a count, an artist) that is drawn but is not part of the element's text. Cards and rows
 * are one button whose accessible name already says it all ("Open Test Movie (2012)"); if the same words also sat in
 * the button as text, voice-control software and screen readers would see two versions of the label that do not
 * match (WCAG 2.5.3, "label in name"). Drawing the line with CSS `content` keeps the look and leaves the name alone.
 * It cannot be selected or found with Ctrl+F; use it only for text that is also in the accessible name.
 */
export function Subtext({
  text,
  className = '',
  as: Tag = 'span',
}: {
  text: string | number | undefined
  className?: string
  as?: ElementType
}) {
  return <Tag aria-hidden="true" data-text={text ?? ''} className={`${className} after:content-[attr(data-text)]`} />
}
