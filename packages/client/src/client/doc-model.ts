/**
 * Read a stored Tiptap document without trusting it.
 *
 * The panel may open documents written by FutureEditor, by the `textbook__*`
 * tools, or by hand. A Tiptap editor only keeps nodes, marks and attributes
 * its schema declares, so before creating one we describe exactly what the
 * document uses: the editor then registers a generic node for every unknown
 * block, and the panel refuses lossy rich-text editing when it sees marks it
 * cannot represent (those chapters stay in the JSON tab).
 *
 * @module harness-client-smart-edit/client/doc-model
 */

/** How a node holds its children. */
export type ContentKind = 'none' | 'inline' | 'block'

/** One node type observed in a document. */
export interface NodeShape {
  readonly attrs: ReadonlySet<string>
  readonly contentKind: ContentKind
}

/** Everything a stored document uses. */
export interface DocScan {
  readonly nodes: ReadonlyMap<string, NodeShape>
  /** True when the root looks like a Tiptap `doc`. */
  readonly valid: boolean
}

/** A JSON object, as an untrusted document value. */
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strengthen one observed child kind, ignoring `none`. */
function mergeKind(current: ContentKind, next: ContentKind): ContentKind {
  if (current === 'none') return next
  if (current === next) return current
  // Mixed children cannot be represented; treat the node as a block container
  // so the editor keeps every child instead of rejecting the document.
  return 'block'
}

/**
 * Walk a stored document and collect its node types, attribute keys and child
 * kinds.
 * @param doc - parsed `content_json` value.
 * @returns the scan; `valid` is false when the root is not a Tiptap doc.
 */
export function scanDoc(doc: unknown): DocScan {
  const nodes = new Map<string, { attrs: Set<string>; contentKind: ContentKind }>()
  const visit = (value: unknown): void => {
    if (!isRecord(value) || typeof value.type !== 'string') return
    const type = value.type
    const shape = nodes.get(type) ?? { attrs: new Set<string>(), contentKind: 'none' as ContentKind }
    nodes.set(type, shape)
    if (isRecord(value.attrs)) {
      for (const key of Object.keys(value.attrs)) shape.attrs.add(key)
    }
    if (Array.isArray(value.content) && value.content.length > 0) {
      const children = value.content.filter(isRecord)
      const inline = children.every((child) => child.type === 'text' || Array.isArray(child.marks))
      shape.contentKind = mergeKind(shape.contentKind, inline ? 'inline' : 'block')
      for (const child of value.content) visit(child)
    }
  }
  visit(doc)
  const valid = isRecord(doc) && doc.type === 'doc' && (doc.content === undefined || Array.isArray(doc.content))
  return { nodes, valid }
}

/**
 * Collect every mark type a document uses.
 * @param doc - parsed `content_json` value.
 * @returns the mark names, in document order.
 */
export function scanMarks(doc: unknown): Set<string> {
  const marks = new Set<string>()
  const visit = (value: unknown): void => {
    if (!isRecord(value)) return
    if (Array.isArray(value.marks)) {
      for (const mark of value.marks) {
        if (isRecord(mark) && typeof mark.type === 'string') marks.add(mark.type)
      }
    }
    if (Array.isArray(value.content)) for (const child of value.content) visit(child)
  }
  visit(doc)
  return marks
}

/**
 * Parse `content_json` and scan it.
 * @param raw - stored JSON text.
 * @returns the parsed document and its scan; an unreadable document scans as invalid.
 */
export function readDoc(raw: unknown): { doc: unknown; scan: DocScan; marks: Set<string> } {
  let parsed: unknown
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
  } else {
    parsed = raw
  }
  return { doc: parsed, scan: scanDoc(parsed), marks: scanMarks(parsed) }
}
