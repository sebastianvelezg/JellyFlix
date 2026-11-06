import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A QR code drawn as an image (SVG) in the browser: the text never leaves the page, nothing is asked of any other site. It is black on a
 * white square with its own quiet border, so a phone can read it on any background.
 */
export function QrCode({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const { cells, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
    }
    return { cells: d, count: n }
  }, [text])
  const quiet = 3
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`} shapeRendering="crispEdges" className="rounded-xl bg-white">
      <path d={cells} fill="#000" />
    </svg>
  )
}
