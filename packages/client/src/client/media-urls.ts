/**
 * Map textbook / editor-local media URLs to browser-fetchable paths, and back.
 *
 * @module harness-client-smart-edit/client/media-urls
 */

const MEDIA_RE = /^(textbook|editor-local):\/\/([^/]+)\/media\/(.+)$/i
const API_MEDIA_PREFIX = '/api/textbook/media?'

export function mediaApiUrl(bookId: string, filename: string): string {
  const params = new URLSearchParams({ bookId, name: filename })
  return `${API_MEDIA_PREFIX}${params.toString()}`
}

/** Turn a stored media URL into one the browser can load. */
export function mediaUrlForDisplay(src: string): string {
  const match = MEDIA_RE.exec(src)
  if (!match) return src
  const bookId = match[2]!
  const name = decodeURIComponent(match[3]!)
  return mediaApiUrl(bookId, name)
}

/** Restore textbook:// URLs when persisting to the host. */
export function mediaUrlForSave(src: string, bookId: string): string {
  if (!src.startsWith(API_MEDIA_PREFIX)) return src
  try {
    const q = src.slice(API_MEDIA_PREFIX.length)
    const params = new URLSearchParams(q)
    const bid = params.get('bookId') ?? ''
    const name = params.get('name') ?? ''
    if (bid === bookId && name) return `textbook://${bookId}/media/${encodeURIComponent(name)}`
  } catch {
    return src
  }
  return src
}

function mapNodeMedia(node: unknown, bookId: string, mode: 'display' | 'save'): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const record = node as Record<string, unknown>
  const next: Record<string, unknown> = { ...record }
  if (record.type === 'image' && record.attrs && typeof record.attrs === 'object') {
    const attrs = { ...(record.attrs as Record<string, unknown>) }
    const src = attrs.src
    if (typeof src === 'string') {
      attrs.src = mode === 'display' ? mediaUrlForDisplay(src) : mediaUrlForSave(src, bookId)
    }
    next.attrs = attrs
  }
  if (Array.isArray(record.content)) {
    next.content = record.content.map((child) => mapNodeMedia(child, bookId, mode))
  }
  return next
}

/** Deep-clone a Tiptap document and rewrite image `src` values. */
export function rewriteDocMedia(doc: unknown, bookId: string, mode: 'display' | 'save'): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc
  return mapNodeMedia(doc, bookId, mode)
}