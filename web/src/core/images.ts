export type ImageKind = 'Primary' | 'Backdrop' | 'Logo'

/**
 * URL of an item (or person) image. Jellyfin serves images without authentication, so no
 * credentials are added; passing the image `tag` makes the URL cacheable and cache-busting.
 */
export function itemImageUrl(
  serverUrl: string,
  itemId: string,
  kind: ImageKind,
  options: { tag?: string; width?: number; height?: number } = {},
): string {
  const url = new URL(`${serverUrl}/Items/${itemId}/Images/${kind}`)
  if (options.width) url.searchParams.set('fillWidth', String(options.width))
  if (options.height) url.searchParams.set('fillHeight', String(options.height))
  // Small pictures (cards, avatars) look the same at 80 and are about a third lighter; big backdrops keep 90.
  url.searchParams.set('quality', (options.width ?? options.height ?? 0) > 800 ? '90' : '80')
  if (options.tag) url.searchParams.set('tag', options.tag)
  return url.toString()
}
