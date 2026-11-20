/**
 * Browser half of the smart-edit bundle.
 *
 * Contributes the sidebar entry that selects the smart-edit main panel and the
 * panel itself. Everything the panel needs comes from the host half over
 * `/api/textbook/*`; this module injects only browser services (`slots`,
 * `locale`) and never looks up a host-side object.
 *
 * @module harness-client-smart-edit/client
 */

import type { ReactNode } from 'react'
import { SmartEditPanel } from './SmartEditPanel.js'
import { NS, dictionaries } from './locales.js'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'smart-edit'

/** Services this browser plugin needs. */
export const inject = ['slots', 'locale']

type Translate = (key: string, params?: Record<string, string>) => string

/** The slice of the browser Context this plugin uses. */
interface ClientContext {
  effect(callback: () => (() => void) | void, label?: string): void
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): Translate
  }
  slots: {
    inject(slot: string, callback: () => () => void): () => void
    register(options: {
      name: string
      key?: string
      id?: string
      order?: number
      locale?: string
      label?: () => string
    }, component: unknown): () => void
  }
}

/**
 * Sidebar glyph of the smart-edit panel. Inline SVG keeps the bundle free of
 * additional package dependencies.
 * @param props - the sidebar's icon share.
 * @returns the glyph.
 */
function SmartEditIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M12 4h6.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H12" />
      <path d="m14.5 9 1.5 1.5L18.5 8" />
    </svg>
  )
}

/**
 * Register the panel, its sidebar entry, and the locale dictionaries.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'smart-edit: dictionaries')

  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
  }, SmartEditPanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 3,
    label: () => t('panel'),
    locale: NS,
  }, SmartEditIcon))
}

export { SmartEditPanel } from './SmartEditPanel.js'
export { NS } from './locales.js'
// The document/schema surface is exported so the bundle smoke test can prove a
// stored chapter round-trips through the editor schema without a DOM.
export { readDoc, scanDoc, scanMarks } from './doc-model.js'
export { extensionsFor, knownMarkNames, knownNodeNames } from './tiptap.js'
// The HTTP contract is exported so the bundle smoke test can exercise the
// exact URLs and the 409 path against the host half.
export {
  ENDPOINTS,
  TextbookError,
  acceptProposal,
  fetchBook,
  fetchBooks,
  fetchChapter,
  fetchModules,
  fetchProposals,
  fetchWritingContext,
  quickEdit,
  rejectProposal,
  restoreProposal,
  saveChapter,
  writeSection,
} from './api.js'
