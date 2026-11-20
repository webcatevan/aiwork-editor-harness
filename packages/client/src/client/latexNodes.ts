/**
 * Minimal LaTeX embed nodes aligned with FutureEditor (`inlineLatex` / `latexBlock`).
 *
 * @module harness-client-smart-edit/client/latexNodes
 */

import { Node, mergeAttributes } from '@tiptap/core'

function latexOf(attrs: Record<string, unknown>): string {
  const latex = attrs.latex
  return typeof latex === 'string' ? latex : ''
}

export const InlineLatex = Node.create({
  name: 'inlineLatex',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-latex-inline]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-latex-inline': '', class: 'se-latex-inline', title: latexOf(HTMLAttributes) }), latexOf(HTMLAttributes)]
  },
})

export const LatexBlock = Node.create({
  name: 'latexBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: '' },
      align: { default: 'center' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-latex-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-latex-block': '1', class: 'se-latex-block' }),
      latexOf(HTMLAttributes),
    ]
  },
})

export function latexExtensions() {
  return [InlineLatex, LatexBlock]
}