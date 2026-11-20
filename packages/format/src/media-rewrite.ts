import { URL_EDITOR_LOCAL, URL_REL_MEDIA, URL_TEXTBOOK } from './constants.js'

/** Rewrite media URLs inside a Tiptap doc JSON tree (stringify walk). */
export function rewriteDocMediaUrls(
  doc: unknown,
  opts: {
    fromBookId: string
    toBookId: string
    toProtocol: 'textbook' | 'editor-local' | 'relative'
    fromProtocols?: ('textbook' | 'editor-local')[]
  },
): unknown {
  const fromProtocols = opts.fromProtocols ?? ['textbook', 'editor-local']
  let s = JSON.stringify(doc ?? { type: 'doc', content: [] })
  for (const proto of fromProtocols) {
    const prefix = proto === 'textbook' ? URL_TEXTBOOK : URL_EDITOR_LOCAL
    const fromRe = new RegExp(
      `${escapeRe(prefix)}${escapeRe(opts.fromBookId)}/media/`,
      'g',
    )
    if (opts.toProtocol === 'relative') {
      s = s.replace(fromRe, URL_REL_MEDIA)
    } else if (opts.toProtocol === 'textbook') {
      s = s.replace(fromRe, `${URL_TEXTBOOK}${opts.toBookId}/media/`)
    } else {
      s = s.replace(fromRe, `${URL_EDITOR_LOCAL}${opts.toBookId}/media/`)
    }
  }
  // Also rewrite relative ./media/ when exporting to editor-local
  if (opts.toProtocol === 'editor-local') {
    s = s.replace(/"\.\/media\//g, `"${URL_EDITOR_LOCAL}${opts.toBookId}/media/`)
  }
  return JSON.parse(s)
}

export function rewriteMediaBasenames(doc: unknown, renames: Map<string, string>): unknown {
  if (!renames.size) return doc
  let s = JSON.stringify(doc)
  for (const [from, to] of renames) {
    if (from === to) continue
    const esc = escapeRe(from)
    s = s.replace(
      new RegExp(`(${escapeRe(URL_TEXTBOOK)}[^/]+/media/)${esc}`, 'g'),
      `$1${to}`,
    )
    s = s.replace(
      new RegExp(`(${escapeRe(URL_EDITOR_LOCAL)}[^/]+/media/)${esc}`, 'g'),
      `$1${to}`,
    )
    s = s.replace(new RegExp(`(\\./media/)${esc}`, 'g'), `$1${to}`)
  }
  return JSON.parse(s)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}