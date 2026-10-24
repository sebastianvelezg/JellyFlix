/** Hands a file to the browser's own "save as", from what is in memory. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start the save a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
