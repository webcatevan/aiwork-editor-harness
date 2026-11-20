/**
 * Browser calls into the host half of smart-edit.
 *
 * Every path is relative to the document, so the same code works under the
 * Web origin and the Desktop forwarding bridge. Requests and responses are
 * JSON only; a non-2xx response becomes a {@link TextbookError} carrying a
 * readable message instead of leaking into the panel as a blank screen.
 *
 * @module harness-client-smart-edit/client/api
 */

/** One book row of `GET /api/textbook/books?q=`. */
export interface Book {
  readonly id: string
  readonly title: string
  readonly created_at?: number
  readonly updated_at?: number
  readonly kind?: string
  readonly category?: string
}

/** One chapter row embedded in a book. */
export interface ChapterSummary {
  readonly id: string
  readonly book_id: string
  readonly title: string
  readonly sort: number
  readonly parent_id: string | null
  readonly role: 'part' | 'chapter' | 'page' | string
  readonly rev: number
  readonly updated_at?: number
  readonly created_at?: number
}

/** One chapter with its Tiptap document. */
export interface ChapterDetail extends ChapterSummary {
  /** Serialized Tiptap document, as stored by the host. */
  readonly content_json: string
}

/** A book with its chapter rows. */
export interface BookDetail extends Book {
  readonly chapters: ChapterSummary[]
}

/** Required fetch endpoints, kept in one place for the host half's contract. */
export const ENDPOINTS = {
  books: '/api/textbook/books',
  book: '/api/textbook/book',
  chapter: '/api/textbook/chapter',
  save: '/api/textbook/save',
  chapterAdd: '/api/textbook/chapter/add',
  chapterRename: '/api/textbook/chapter/rename',
  chapterDelete: '/api/textbook/chapter/delete',
  chapterMove: '/api/textbook/chapter/move',
  quickEdit: '/api/textbook/quick-edit',
  write: '/api/textbook/write',
  modules: '/api/textbook/modules',
  writingContext: '/api/textbook/writing-context',
  proposals: '/api/textbook/proposals',
  acceptProposal: '/api/textbook/proposals/accept',
  restoreProposal: '/api/textbook/proposals/restore',
  rejectProposal: '/api/textbook/proposals/reject',
  bookCreate: '/api/textbook/book/create',
  bookUpdate: '/api/textbook/book/update',
  bookDelete: '/api/textbook/book/delete',
  chapterDuplicate: '/api/textbook/chapter/duplicate',
  febImport: '/api/textbook/feb/import',
  febExport: '/api/textbook/feb/export',
  media: '/api/textbook/media',
  moduleBlockUpdate: '/api/textbook/module-block/update',
  chapterPreviews: '/api/textbook/chapter/previews',
  workshopState: '/api/textbook/workshop-state',
} as const

/** One page-row preview for the chapter tree. */
export interface ChapterPreview {
  readonly snippet: string
  readonly thumbName?: string
}

/** The write actions offered on a selection. */
export type QuickEditMode = 'polish' | 'expand' | 'shorten'

/** One proposed edit an agent left for review. */
export interface Proposal {
  readonly id: string
  readonly chapter_id: string
  readonly base_rev: number
  readonly note: string
  readonly source: string
  readonly status: string
  readonly created_at: number
  readonly updated_at: number
  readonly doc?: unknown
}

/** A host refusal with its HTTP status. */
export class TextbookError extends Error {
  /**
   * @param status - HTTP status.
   * @param message - actionable description.
   * @param code - optional host failure code.
   */
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'TextbookError'
  }
}

/** Describe one caught failure without assuming it is an `Error`. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof error === 'string' && error.trim()) return error
  return '请求失败'
}

/** Pull a readable message out of a JSON error body. */
function messageOfBody(body: unknown): string | undefined {
  if (typeof body === 'string' && body.trim()) return body.trim()
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  const nested = record.error
  if (typeof nested === 'object' && nested !== null) {
    const detail = nested as Record<string, unknown>
    if (typeof detail.message === 'string' && detail.message.trim()) return detail.message
    if (typeof detail.code === 'string' && detail.code.trim()) return detail.code
  }
  if (typeof record.code === 'string' && record.code.trim()) return record.code
  return undefined
}

/** Build one relative URL with an encoded query parameter. */
function withQuery(path: string, name: string, value: string): string {
  return value ? `${path}?${new URLSearchParams({ [name]: value }).toString()}` : path
}

/** Turn a non-2xx response into a readable error. */
async function failureOf(response: Response): Promise<TextbookError> {
  const fallback = `请求失败（HTTP ${response.status}）`
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    body = undefined
  }
  if (body === undefined) {
    try {
      const text = await response.text()
      if (text.trim()) body = text
    } catch {
      // The body is unavailable; the status-only message is still readable.
    }
  }
  return new TextbookError(response.status, messageOfBody(body) ?? fallback)
}

/** Read one JSON response or throw its readable failure. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await failureOf(response)
  try {
    return await response.json() as T
  } catch {
    throw new TextbookError(response.status, '响应不是合法 JSON')
  }
}

/**
 * List books, optionally filtered by a title query.
 * @param query - title search text; empty lists every book.
 * @returns the book rows.
 */
export async function fetchBooks(query = ''): Promise<Book[]> {
  const response = await fetch(withQuery(ENDPOINTS.books, 'q', query), {
    headers: { Accept: 'application/json' },
  })
  const payload = await readJson<{ books?: Book[] }>(response)
  return Array.isArray(payload.books) ? payload.books : []
}

/**
 * Load one book with its chapter rows.
 * @param id - book id.
 * @returns the book.
 */
export async function fetchBook(id: string): Promise<BookDetail> {
  const response = await fetch(withQuery(ENDPOINTS.book, 'id', id), {
    headers: { Accept: 'application/json' },
  })
  const payload = await readJson<{ book?: BookDetail }>(response)
  if (!payload.book) throw new TextbookError(response.status, '响应缺少 book')
  return {
    ...payload.book,
    chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
  }
}

/**
 * Load one chapter with its Tiptap document.
 * @param id - chapter id.
 * @returns the chapter.
 */
export async function fetchChapter(id: string): Promise<ChapterDetail> {
  const response = await fetch(withQuery(ENDPOINTS.chapter, 'id', id), {
    headers: { Accept: 'application/json' },
  })
  const payload = await readJson<{ chapter?: ChapterDetail }>(response)
  if (!payload.chapter) throw new TextbookError(response.status, '响应缺少 chapter')
  return payload.chapter
}

/**
 * Save a chapter's Tiptap document.
 * @param id - chapter id.
 * @param content - parsed Tiptap document.
 * @param rev - revision the editor loaded; a mismatch is a 409 conflict.
 * @returns the saved chapter with its new revision.
 */
/**
 * Create one chapter node under a book.
 * @returns the new chapter and the refreshed book rows.
 */
export async function createChapter(
  bookId: string,
  opts: {
    title?: string
    parentId?: string | null
    afterId?: string
    role?: 'part' | 'chapter' | 'page'
  } = {},
): Promise<{ chapter: ChapterDetail; book: BookDetail }> {
  const response = await fetch(ENDPOINTS.chapterAdd, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookId,
      title: opts.title ?? '',
      parentId: opts.parentId ?? null,
      afterId: opts.afterId,
      role: opts.role ?? 'page',
    }),
  })
  const payload = await readJson<{ chapter?: ChapterDetail; book?: BookDetail }>(response)
  if (!payload.chapter || !payload.book) throw new TextbookError(response.status, '响应缺少 chapter 或 book')
  return {
    chapter: payload.chapter,
    book: {
      ...payload.book,
      chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
    },
  }
}

/** Rename a chapter node (any role). */
export async function renameChapter(id: string, title: string): Promise<ChapterDetail> {
  const response = await fetch(ENDPOINTS.chapterRename, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title }),
  })
  const payload = await readJson<{ chapter?: ChapterDetail }>(response)
  if (!payload.chapter) throw new TextbookError(response.status, '响应缺少 chapter')
  return payload.chapter
}

/** Reorder or reparent a chapter node. */
export async function moveChapter(
  id: string,
  opts: { parentId?: string | null; afterId?: string | null },
): Promise<{ chapter: ChapterDetail; book: BookDetail }> {
  const response = await fetch(ENDPOINTS.chapterMove, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      parentId: opts.parentId ?? null,
      afterId: opts.afterId ?? null,
    }),
  })
  const payload = await readJson<{ chapter?: ChapterDetail; book?: BookDetail }>(response)
  if (!payload.chapter || !payload.book) throw new TextbookError(response.status, '响应缺少 chapter 或 book')
  return {
    chapter: payload.chapter,
    book: {
      ...payload.book,
      chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
    },
  }
}

/** Delete a chapter subtree; returns the refreshed book. */
export async function createBook(title = ''): Promise<BookDetail> {
  const response = await fetch(ENDPOINTS.bookCreate, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  const payload = await readJson<{ book?: BookDetail }>(response)
  if (!payload.book) throw new TextbookError(response.status, '响应缺少 book')
  return {
    ...payload.book,
    chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
  }
}

export async function updateBook(id: string, patch: { title?: string; category?: string }): Promise<BookDetail> {
  const response = await fetch(ENDPOINTS.bookUpdate, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  })
  const payload = await readJson<{ book?: BookDetail }>(response)
  if (!payload.book) throw new TextbookError(response.status, '响应缺少 book')
  return {
    ...payload.book,
    chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
  }
}

export async function deleteBook(id: string): Promise<void> {
  const response = await fetch(ENDPOINTS.bookDelete, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  await readJson<{ ok?: boolean }>(response)
}

export async function duplicateChapter(id: string): Promise<{ chapter: ChapterDetail; book: BookDetail }> {
  const response = await fetch(ENDPOINTS.chapterDuplicate, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = await readJson<{ chapter?: ChapterDetail; book?: BookDetail }>(response)
  if (!payload.chapter || !payload.book) throw new TextbookError(response.status, '响应缺少 chapter 或 book')
  return {
    chapter: payload.chapter,
    book: {
      ...payload.book,
      chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
    },
  }
}

export async function importFebFile(
  file: File,
  mode: 'new' | 'update' = 'new',
  bookId?: string,
): Promise<BookDetail> {
  const params = new URLSearchParams({ mode })
  if (mode === 'update' && bookId) params.set('bookId', bookId)
  const response = await fetch(`${ENDPOINTS.febImport}?${params.toString()}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/zip' },
    body: file,
  })
  const payload = await readJson<{ book?: BookDetail }>(response)
  if (!payload.book) throw new TextbookError(response.status, '响应缺少 book')
  return {
    ...payload.book,
    chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
  }
}

export async function exportFebBook(bookId: string): Promise<Blob> {
  const response = await fetch(withQuery(ENDPOINTS.febExport, 'id', bookId), {
    headers: { Accept: 'application/zip' },
  })
  if (!response.ok) throw await failureOf(response)
  return await response.blob()
}

export async function uploadMedia(bookId: string, file: File): Promise<{ url: string; filename: string }> {
  const form = new FormData()
  form.set('bookId', bookId)
  form.set('file', file)
  const response = await fetch(ENDPOINTS.media, { method: 'POST', body: form })
  const payload = await readJson<{ media?: { url: string; filename: string } }>(response)
  if (!payload.media) throw new TextbookError(response.status, '响应缺少 media')
  return payload.media
}

export async function updateModuleBlock(
  chapterId: string,
  blockId: string,
  config: Record<string, unknown>,
  rev?: number,
): Promise<ChapterDetail> {
  const body: { chapterId: string; blockId: string; config: Record<string, unknown>; rev?: number } = {
    chapterId,
    blockId,
    config,
  }
  if (typeof rev === 'number' && Number.isFinite(rev)) body.rev = rev
  const response = await fetch(ENDPOINTS.moduleBlockUpdate, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readJson<{ chapter?: ChapterDetail }>(response)
  if (!payload.chapter) throw new TextbookError(response.status, '响应缺少 chapter')
  return payload.chapter
}

/** Agent `focus_chapter` 写入的工坊焦点，供面板轮询同步。 */
export async function fetchWorkshopState(): Promise<{ focus: { bookId?: string; chapterId?: string } }> {
  const response = await fetch(ENDPOINTS.workshopState, { headers: { Accept: 'application/json' } })
  const payload = await readJson<{ focus?: { bookId?: string; chapterId?: string } }>(response)
  return { focus: payload.focus ?? {} }
}

export async function fetchChapterPreviews(bookId: string): Promise<Record<string, ChapterPreview>> {
  const response = await fetch(withQuery(ENDPOINTS.chapterPreviews, 'bookId', bookId), {
    headers: { Accept: 'application/json' },
  })
  const payload = await readJson<{ previews?: Record<string, ChapterPreview> }>(response)
  return payload.previews && typeof payload.previews === 'object' ? payload.previews : {}
}

export async function deleteChapter(id: string): Promise<BookDetail> {
  const response = await fetch(ENDPOINTS.chapterDelete, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = await readJson<{ book?: BookDetail }>(response)
  if (!payload.book) throw new TextbookError(response.status, '响应缺少 book')
  return {
    ...payload.book,
    chapters: Array.isArray(payload.book.chapters) ? payload.book.chapters : [],
  }
}

export async function saveChapter(id: string, content: unknown, rev?: number): Promise<ChapterDetail> {
  const body: { id: string; content: unknown; rev?: number } = { id, content }
  if (typeof rev === 'number' && Number.isFinite(rev)) body.rev = rev
  const response = await fetch(ENDPOINTS.save, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readJson<{ chapter?: ChapterDetail }>(response)
  if (!payload.chapter) throw new TextbookError(response.status, '响应缺少 chapter')
  return payload.chapter
}

/**
 * Ask the host to rewrite one selection. The host calls the Agent's model; the
 * panel only shows the result and decides whether to apply it.
 * @param mode - polish, expand or shorten.
 * @param text - the selected text.
 * @param context - chapter identity used to keep the wording in context.
 * @returns the proposed replacement text.
 */
export async function quickEdit(
  mode: QuickEditMode,
  text: string,
  context: { chapterId?: string; title?: string; before?: string; after?: string } = {},
): Promise<string> {
  const response = await fetch(ENDPOINTS.quickEdit, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, text, ...context }),
  })
  const payload = await readJson<{ text?: string }>(response)
  if (typeof payload.text !== 'string' || payload.text === '') {
    throw new TextbookError(response.status, '响应缺少建议文本')
  }
  return payload.text
}

/**
 * List the proposed edits of one chapter, or the latest across the library.
 * @param chapterId - the chapter to filter by.
 * @returns the proposals, newest first.
 */
export async function fetchProposals(chapterId?: string): Promise<Proposal[]> {
  const response = await fetch(withQuery(ENDPOINTS.proposals, 'chapterId', chapterId ?? ''), {
    headers: { Accept: 'application/json' },
  })
  const payload = await readJson<{ proposals?: Proposal[] }>(response)
  return Array.isArray(payload.proposals) ? payload.proposals : []
}

/**
 * Accept one proposal; the host writes it only when the chapter is still at the
 * proposal's base revision.
 * @param id - proposal id.
 * @returns the saved chapter and the settled proposal.
 */
export async function acceptProposal(id: string): Promise<{ chapter: ChapterDetail; proposal: Proposal }> {
  const response = await fetch(ENDPOINTS.acceptProposal, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return await readJson<{ chapter: ChapterDetail; proposal: Proposal }>(response)
}

/**
 * Reject one proposal without touching the chapter.
 * @param id - proposal id.
 * @returns the settled proposal.
 */
export async function rejectProposal(id: string): Promise<Proposal> {
  const response = await fetch(ENDPOINTS.rejectProposal, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = await readJson<{ proposal?: Proposal }>(response)
  if (!payload.proposal) throw new TextbookError(response.status, '响应缺少 proposal')
  return payload.proposal
}

/** One interactive module the slash menu can insert. */
export interface ModuleInfo {
  readonly type: string
  readonly name: string
  readonly group: string
  readonly defaultConfig: Record<string, unknown>
}

/** The writing context the task cards embed. */
export interface WritingContext {
  readonly book: { id: string; title: string; category?: string; kind?: string }
  readonly outline: readonly { id: string; title: string; role: string; rev: number; parent_id: string | null }[]
  readonly chapter?: { id: string; title: string; role: string; rev: number; doc: unknown }
  readonly modules: readonly ModuleInfo[]
}

/**
 * Read the interactive module catalog.
 * @returns the enabled modules with their starting config.
 */
export async function fetchModules(): Promise<ModuleInfo[]> {
  const response = await fetch(ENDPOINTS.modules, { headers: { Accept: 'application/json' } })
  const payload = await readJson<{ modules?: ModuleInfo[] }>(response)
  return Array.isArray(payload.modules) ? payload.modules : []
}

/**
 * Read the context a writing task embeds.
 * @param query - book or chapter identity.
 * @returns the writing context.
 */
export async function fetchWritingContext(query: { bookId?: string; chapterId?: string }): Promise<WritingContext> {
  const params = new URLSearchParams()
  if (query.bookId) params.set('bookId', query.bookId)
  if (query.chapterId) params.set('chapterId', query.chapterId)
  const url = params.toString() === '' ? ENDPOINTS.writingContext : `${ENDPOINTS.writingContext}?${params.toString()}`
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const payload = await readJson<{ context?: WritingContext }>(response)
  if (payload.context === undefined) throw new TextbookError(response.status, '响应缺少 context')
  return payload.context
}

/**
 * Undo one accepted proposal.
 * @param id - proposal id.
 * @returns the restored chapter and settled proposal.
 */
export async function restoreProposal(id: string): Promise<{ chapter: ChapterDetail; proposal: Proposal }> {
  const response = await fetch(ENDPOINTS.restoreProposal, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  return await readJson<{ chapter: ChapterDetail; proposal: Proposal }>(response)
}

/**
 * Ask the host to write one chapter and leave the result as a proposal.
 * @param chapterId - the page chapter to write.
 * @param mode - write the section from scratch or continue the existing text.
 * @param instruction - optional extra guidance.
 * @returns the created proposal.
 */
export async function writeSection(
  chapterId: string,
  mode: 'section' | 'continue' = 'section',
  instruction?: string,
): Promise<Proposal> {
  const response = await fetch(ENDPOINTS.write, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterId, mode, ...instruction === undefined ? {} : { instruction } }),
  })
  const payload = await readJson<{ proposal?: Proposal }>(response)
  if (payload.proposal === undefined) throw new TextbookError(response.status, '响应缺少 proposal')
  return payload.proposal
}
