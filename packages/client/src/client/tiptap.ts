/**
 * Tiptap extension set of the smart-edit panel.
 *
 * The text schema follows FutureEditor's rich-text baseline (StarterKit with
 * headings 1-3, links, images, tables, alignment). Any block type the document
 * uses but this schema does not declare gets a generic node: an atom card when
 * the block has no children, otherwise a plain container that keeps its
 * children. Attribute keys are taken from the document itself, so a stored
 * block round-trips through `getJSON()` without losing anything.
 *
 * @module harness-client-smart-edit/client/tiptap
 */

import { Node, getSchema, mergeAttributes, type Extensions } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'
import { ModuleBlockCard } from './ModuleBlockCard.js'
import type { NodeShape } from './doc-model.js'
import { latexExtensions } from './latexNodes.js'

/** The editor's baseline, independent of the loaded document. */
export function baseExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Image.configure({ inline: false, allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    ...latexExtensions(),
  ]
}

/** Node names the baseline already declares. */
export function knownNodeNames(): Set<string> {
  return new Set(Object.keys(getSchema(baseExtensions()).nodes))
}

/** Mark names the baseline already declares. */
export function knownMarkNames(): Set<string> {
  return new Set(Object.keys(getSchema(baseExtensions()).marks))
}

/**
 * Build the generic extension for one unknown block type.
 * @param type - node type name from the document.
 * @param shape - observed attributes and children kind.
 * @returns the node extension.
 */
export function genericBlockType(type: string, shape: NodeShape): Node {
  const atom = shape.contentKind === 'none'
  const attributes = [...shape.attrs]
  return Node.create({
    name: type,
    group: 'block',
    atom,
    selectable: true,
    draggable: false,
    content: atom ? undefined : shape.contentKind === 'inline' ? 'inline*' : 'block+',
    defining: false,
    addAttributes() {
      return Object.fromEntries(attributes.map((name) => [name, { default: null }]))
    },
    parseHTML() {
      return [{ tag: `div[data-se-block="${type}"]` }]
    },
    renderHTML({ HTMLAttributes }) {
      // Object-valued attributes cannot be serialized into DOM attributes;
      // JSON round-tripping is what matters, so only scalars reach the HTML.
      const safe = Object.fromEntries(
        Object.entries(HTMLAttributes).filter(([, value]) => typeof value === 'string' || typeof value === 'number'),
      )
      return ['div', mergeAttributes(safe, { 'data-se-block': type, class: 'se-block' }), 0]
    },
    ...atom ? { addNodeView() { return ReactNodeViewRenderer(ModuleBlockCard) } } : {},
  })
}

/**
 * Assemble the extensions for one loaded document.
 * @param doc - parsed Tiptap document.
 * @param scan - node shapes collected from that document.
 * @returns the full extension list.
 */
export function extensionsFor(
  scan: { readonly nodes: ReadonlyMap<string, NodeShape> },
  insertable: readonly string[] = [],
): Extensions {
  const known = knownNodeNames()
  const generic = new Map<string, NodeShape>()
  for (const [type, shape] of scan.nodes.entries()) {
    if (known.has(type) || type === 'doc' || type === 'text') continue
    generic.set(type, shape)
  }
  // Modules the slash menu can insert must be declared before they appear in
  // the document, or ProseMirror refuses the node and the insert is lost.
  for (const type of insertable) {
    if (known.has(type) || generic.has(type)) continue
    generic.set(type, { attrs: new Set(['config', 'v', 'blockId']), contentKind: 'none' })
  }
  return [...baseExtensions(), ...[...generic.entries()].map(([type, shape]) => genericBlockType(type, shape))]
}
