let locks = 0
let saved = ''

/**
 * Stops the page behind a full-screen player from scrolling, and returns the function that lets it scroll again.
 *
 * Several things can hold the page still at once (the video player, the full-screen music player), and they let go in any order,
 * so the page only scrolls again when the last of them has let go. Remembering and putting back the previous value instead, as each
 * one did on its own, left the page stuck when they overlapped.
 */
export function lockPageScroll(): () => void {
  if (locks === 0) {
    saved = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  locks += 1
  let released = false
  return () => {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0) document.body.style.overflow = saved
  }
}
