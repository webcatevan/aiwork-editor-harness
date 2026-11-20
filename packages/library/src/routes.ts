import type { Context } from '@deepseek-ai/cordis'
import type { TextbookLibrary } from './textbook-library.js'

/** One quick-edit mode the panel offers on a selection. */
export type QuickEditMode = 'polish' | 'expand' | 'shorten'

/** What each mode asks the model to do with the selected text. */
const QUICK_EDIT_INSTRUCTIONS: Record<QuickEditMode, string> = {
  polish: '润色这段文字：保持原意、语气和知识点不变，改掉病句、重复和口语化表达，让行文更顺。',
  expand: '扩写这段文字：补充必要的解释、例子或过渡，使内容更完整；不要改变原有观点，不要编造事实。',
  shorten: '精简这段文字：保留关键信息和结论，删掉冗余修饰，长度压到原文的 60% 左右。',
}

/** The writing-assistant system prompt of a quick edit. */
const QUICK_EDIT_SYSTEM = [
  '你是 DeepSeek Harness 里的教材写作助手，正在协助作者修改互动教材的一段正文。',
  '规则：',
  '1. 只输出修改后的正文本身，不要解释、不要加引号、不要输出 Markdown 标题或列表。',
  '2. 保持与原文相同的语言（中文原文就输出中文）。',
  '3. 数学公式沿用 $...$ 行内写法。',
  '4. 不要编造原文没有的事实、数据或引文。',
].join('\n')

/** One JSON response; authentication and Host/Origin checks are the transport's job. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** One structured failure response shared by every route. */
function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Map a library failure onto the route contract:
 * unknown ids are 404, rev mismatches 409, non-editable nodes 400.
 */
function errorResponse(error: unknown): Response {
  const message = messageOf(error)
  switch (codeOf(error)) {
    case 'NOT_FOUND':
      return failure(404, 'NOT_FOUND', message)
    case 'REV_CONFLICT':
      return failure(409, 'REV_CONFLICT', message)
    case 'NOT_EDITABLE':
      return failure(400, 'NOT_EDITABLE', message)
    default:
      return failure(500, 'INTERNAL_ERROR', message)
  }
}

/** Read one required query parameter, or `undefined` for a missing/blank value. */
function queryId(request: Request): string | undefined {
  const value = new URL(request.url).searchParams.get('id')?.trim()
  return value ? value : undefined
}

/**
 * Exact Fetch routes for the browser half:
 *
 * - `GET  /api/textbook/books?q=`     → `{ books }`
 * - `GET  /api/textbook/book?id=`     → `{ book }` (book + chapters)
 * - `GET  /api/textbook/chapter?id=`  → `{ chapter }` (metadata + content_json)
 * - `POST /api/textbook/save`         → `{ chapter }`, `REV_CONFLICT` = 409
 * - `POST /api/textbook/chapter/add`    → `{ chapter, book }`
 * - `POST /api/textbook/chapter/rename` → `{ chapter }`
 * - `POST /api/textbook/chapter/delete` → `{ ok, book }`
 * - `POST /api/textbook/chapter/move`   → `{ chapter, book }`
 * - `POST /api/textbook/chapter/duplicate` → `{ chapter, book }`
 * - `POST /api/textbook/book/create|update|delete` → book rows
 * - `POST /api/textbook/feb/import`     → `{ book }` (raw .feb body)
 * - `GET  /api/textbook/feb/export?id=` → `.feb` zip download
 * - `GET  /api/textbook/media?bookId=&name=` → media bytes
 * - `POST /api/textbook/media`          → `{ media }` (multipart)
 * - `POST /api/textbook/module-block/update` → `{ chapter }`
 * - `GET  /api/textbook/chapter/previews?bookId=` → `{ previews }`
 * - `GET  /api/textbook/workshop-state` → `{ focus }`（Agent `focus_chapter` 与面板同步）
 */
/** Read the model the Agent would use, or the failure the panel shows. */
function resolveModelRoute(ctx: Context): { provider: string; model: string } {
  const model = ctx.get?.('agentDefaultModel') as
    | { currentSelection?: () => { provider?: string; model?: string } | undefined }
    | undefined
  const selection = model?.currentSelection?.()
  if (selection === undefined || selection === null) {
    throw Object.assign(new Error('没有可用的默认模型，请先在设置里选择模型'), { code: 'MODEL_UNCONFIGURED' })
  }
  if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    throw Object.assign(new Error('没有可用的默认模型，请先在设置里选择模型'), { code: 'MODEL_UNCONFIGURED' })
  }
  return { provider: selection.provider, model: selection.model }
}

/** Ask the model for one edited passage and return its text. */
async function generateQuickEdit(
  ctx: Context,
  input: { mode: QuickEditMode; text: string; before?: string; after?: string; title?: string },
  signal: AbortSignal,
): Promise<string> {
  const route = resolveModelRoute(ctx)
  const instruction = QUICK_EDIT_INSTRUCTIONS[input.mode]
  const user = [
    input.title === undefined ? undefined : `章节：${input.title}`,
    input.before === undefined ? undefined : `前文：${input.before}`,
    `原文：${input.text}`,
    input.after === undefined ? undefined : `后文：${input.after}`,
  ].filter((line): line is string => line !== undefined).join('\n\n')
  const call = await ctx.llm.prepareCall({
    provider: route.provider,
    model: route.model,
    maxTokens: 1200,
  }, signal)
  let text = ''
  for await (const chunk of call.stream({
    ...(call.config as Record<string, unknown>),
    system: `${QUICK_EDIT_SYSTEM}\n\n本次任务：${instruction}`,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    signal,
    purpose: 'smart-edit',
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  const trimmed = text.trim()
  if (trimmed === '') throw Object.assign(new Error('模型没有返回内容'), { code: 'MODEL_FAILED' })
  return trimmed
}

/** The system prompt of a whole-section writing request. */
const WRITE_SYSTEM = [
  '你是 DeepSeek Harness 里的互动教材写作助手，正在替作者写一节正文。',
  '输出要求：',
  '1. 只输出一个 Tiptap 文档 JSON 对象：{"type":"doc","content":[...]}。不要输出 Markdown 代码块、不要解释。',
  '2. 正文用 paragraph / heading / bulletList 等节点；数学公式写成 $...$。',
  '3. 互动模块块（例如 examQuestion）没有正文，保留它们原样的 attrs（config/v/blockId），不要改写、不要删除。',
  '4. 不要编造原文没有的事实；需要引用时保持与大纲一致。',
].join('\n')

/** Remove the code fences a model may wrap a JSON document in. */
function unfence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

/** Read balanced JSON starting at the first `{`, ignoring braces inside strings. */
function balancedObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      stack.pop()
      if (stack.length === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

/**
 * Repair a truncated document: keep the last completed element and close the
 * containers that are still open. A model that runs out of output mid-array
 * otherwise fails the whole request.
 */
function repairTruncated(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start === -1) return undefined
  const stack: string[] = []
  let inString = false
  let escaped = false
  let lastEnd = -1
  let lastClosers = ''
  const closers = (): string => stack.slice().reverse().join('')
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === '}' || char === ']') {
      if (stack.pop() === undefined) return undefined
      if (stack.length === 0) return text.slice(start, index + 1)
      lastEnd = index + 1
      lastClosers = closers()
    }
  }
  if (lastEnd <= start) return undefined
  return text.slice(start, lastEnd) + lastClosers
}

/** Parse the model's reply into a Tiptap document, repairing a truncated tail. */
function parseDocReply(text: string): { doc: unknown; repaired: boolean } {
  const body = unfence(text)
  const candidates: { json: string; repaired: boolean }[] = []
  const balanced = balancedObject(body)
  if (balanced !== undefined) candidates.push({ json: balanced, repaired: false })
  const repaired = repairTruncated(body)
  if (repaired !== undefined && repaired !== balanced) candidates.push({ json: repaired, repaired: true })
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.json)
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'doc'
        && Array.isArray((parsed as { content?: unknown }).content)
        && ((parsed as { content: unknown[] }).content.length > 0 || !candidate.repaired)) {
        return { doc: parsed, repaired: candidate.repaired }
      }
      lastError = new Error('模型返回的不是 Tiptap 文档')
    } catch (error) {
      lastError = error
    }
  }
  throw Object.assign(
    new Error(`模型返回的 JSON 无法解析（${lastError instanceof Error ? lastError.message : String(lastError)}）：${body.slice(0, 120)}…`),
    { code: 'MODEL_FAILED' },
  )
}

/** Ask the model for one complete chapter document. */
async function generateChapterDoc(
  ctx: Context,
  lib: TextbookLibrary,
  input: { chapterId: string; mode: 'section' | 'continue'; instruction?: string },
  signal: AbortSignal,
): Promise<{ doc: unknown; repaired: boolean }> {
  const context = lib.writingContext({ chapterId: input.chapterId })
  const chapters = context.outline
    .map((node: { title: string; role: string }) => `[${node.role}] ${node.title}`)
    .join('\n')
  const current = context.chapter === undefined ? '（本节还没有正文）' : JSON.stringify(context.chapter.doc)
  const task = input.mode === 'continue'
    ? '在现有正文后面续写，保持语气和结构；返回包含原有内容的完整文档。正文控制在 1200 字以内。'
    : '把这一节写完整（补写/重写正文）；返回完整文档。正文控制在 1200 字以内。'
  const user = [
    `书：《${context.book.title}》`,
    `当前章：${context.chapter?.title ?? ''}`,
    '大纲：',
    chapters,
    '',
    '现有文档（JSON）：',
    current.slice(0, 12000),
    '',
    `任务：${task}`,
    input.instruction === undefined || input.instruction.trim() === '' ? '' : `额外要求：${input.instruction.trim()}`,
  ].filter((line) => line !== '').join('\n')
  const route = resolveModelRoute(ctx)
  const call = await ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: 8000 }, signal)
  let text = ''
  for await (const chunk of call.stream({
    ...(call.config as Record<string, unknown>),
    system: WRITE_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    signal,
    purpose: 'smart-edit',
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return parseDocReply(text)
}

export function registerTextbookRoutes(ctx: Context, lib: TextbookLibrary) {
  const bookDetail = (bookId: string) => ({
    ...lib.getBook(bookId),
    chapters: lib.listChaptersFlat(bookId),
  })

  const books = async (request: Request): Promise<Response> => {
    try {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      return json({ books: lib.listBooks(q) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const book = async (request: Request): Promise<Response> => {
    const id = queryId(request)
    if (id === undefined) return failure(400, 'INVALID_INPUT', 'missing "id" query parameter')
    try {
      // `getBook` keeps the historical root-level chapter list for the
      // textbook__get_book tool; the browser panel needs every row so it can
      // render parts, chapters and nested pages. Add the flat list here.
      return json({ book: bookDetail(id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const chapter = async (request: Request): Promise<Response> => {
    const id = queryId(request)
    if (id === undefined) return failure(400, 'INVALID_INPUT', 'missing "id" query parameter')
    try {
      return json({ chapter: lib.getChapter(id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const save = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { id?: unknown; content?: unknown; rev?: unknown } | null

    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a chapter "id" is required')

    const content = input?.content
    if (content === null || typeof content !== 'object' || Array.isArray(content)) {
      return failure(400, 'INVALID_INPUT', '"content" must be a Tiptap document object')
    }

    let rev: number | undefined
    if (input?.rev !== undefined && input.rev !== null) {
      if (typeof input.rev !== 'number' || !Number.isFinite(input.rev)) {
        return failure(400, 'INVALID_INPUT', '"rev" must be a finite number')
      }
      rev = input.rev
    }

    try {
      return json({ chapter: lib.saveChapterJson(id, content, { rev }) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/books',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: books,
      }),
    'smart-edit: books route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/book',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: book,
      }),
    'smart-edit: book route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: chapter,
      }),
    'smart-edit: chapter route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/save',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: save,
      }),
    'smart-edit: save route',
  )

  const chapterAdd = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as {
      bookId?: unknown
      title?: unknown
      parentId?: unknown
      afterId?: unknown
      role?: unknown
    } | null
    const bookId = typeof input?.bookId === 'string' ? input.bookId.trim() : ''
    if (bookId === '') return failure(400, 'INVALID_INPUT', 'a "bookId" is required')
    const roleRaw = typeof input?.role === 'string' ? input.role.trim() : 'page'
    const role = roleRaw === 'part' || roleRaw === 'chapter' ? roleRaw : 'page'
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    const parentId =
      input?.parentId === null || input?.parentId === undefined
        ? null
        : typeof input?.parentId === 'string' && input.parentId.trim()
          ? input.parentId.trim()
          : null
    const afterId =
      typeof input?.afterId === 'string' && input.afterId.trim() ? input.afterId.trim() : undefined
    try {
      const chapter = lib.addChapter(bookId, title || '未命名', afterId, { parentId, role })
      return json({ chapter, book: bookDetail(bookId) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const chapterRename = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { id?: unknown; title?: unknown } | null
    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a chapter "id" is required')
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    if (title === '') return failure(400, 'INVALID_INPUT', 'a non-empty "title" is required')
    try {
      return json({ chapter: lib.renameChapter(id, title) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const chapterDelete = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { id?: unknown } | null
    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a chapter "id" is required')
    try {
      const ch = lib.getChapter(id)
      lib.deleteChapter(id)
      return json({ ok: true, book: bookDetail(ch.book_id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/add',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: chapterAdd,
      }),
    'smart-edit: chapter add route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/rename',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: chapterRename,
      }),
    'smart-edit: chapter rename route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/delete',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: chapterDelete,
      }),
    'smart-edit: chapter delete route',
  )

  const chapterMove = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { id?: unknown; parentId?: unknown; afterId?: unknown } | null
    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a chapter "id" is required')
    const parentId =
      input?.parentId === null || input?.parentId === undefined
        ? null
        : typeof input?.parentId === 'string' && input.parentId.trim()
          ? input.parentId.trim()
          : null
    const afterId =
      typeof input?.afterId === 'string' && input.afterId.trim() ? input.afterId.trim() : null
    try {
      const chapter = lib.moveChapter(id, { parentId, afterId })
      return json({ chapter, book: bookDetail(chapter.book_id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/move',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: chapterMove,
      }),
    'smart-edit: chapter move route',
  )

  const chapterDuplicate = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const id = typeof (body as { id?: unknown })?.id === 'string' ? (body as { id: string }).id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a chapter "id" is required')
    try {
      const chapter = lib.duplicateChapter(id)
      return json({ chapter, book: bookDetail(chapter.book_id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/duplicate',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: chapterDuplicate,
      }),
    'smart-edit: chapter duplicate route',
  )

  const bookCreate = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { title?: unknown; kind?: unknown } | null
    const title = typeof input?.title === 'string' ? input.title.trim() : ''
    const kind = typeof input?.kind === 'string' ? input.kind.trim() : undefined
    try {
      return json({ book: lib.createBook(title || '未命名', { kind }) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const bookUpdate = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { id?: unknown; title?: unknown; category?: unknown } | null
    const id = typeof input?.id === 'string' ? input.id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a book "id" is required')
    try {
      return json({
        book: lib.updateBook(id, {
          title: typeof input?.title === 'string' ? input.title.trim() : undefined,
          category: typeof input?.category === 'string' ? input.category : undefined,
        }),
      })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const bookDelete = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const id = typeof (body as { id?: unknown })?.id === 'string' ? (body as { id: string }).id.trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a book "id" is required')
    try {
      lib.deleteBook(id)
      return json({ ok: true })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/book/create',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: bookCreate,
      }),
    'smart-edit: book create route',
  )
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/book/update',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: bookUpdate,
      }),
    'smart-edit: book update route',
  )
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/book/delete',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: bookDelete,
      }),
    'smart-edit: book delete route',
  )

  const febImport = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const modeRaw = url.searchParams.get('mode')?.trim()
    const mode = modeRaw === 'update' ? 'update' : 'new'
    const targetBookId = url.searchParams.get('bookId')?.trim() || undefined
    try {
      const buf = Buffer.from(await request.arrayBuffer())
      if (buf.length === 0) return failure(400, 'INVALID_INPUT', 'empty .feb body')
      const book = await lib.importFebBuffer(buf, mode, targetBookId)
      return json({ book: bookDetail(book.id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const febExport = async (request: Request): Promise<Response> => {
    const id = queryId(request)
    if (id === undefined) return failure(400, 'INVALID_INPUT', 'missing "id" query parameter')
    try {
      const buf = await lib.exportFebToBuffer(id, true)
      const book = lib.getBook(id)
      const safeTitle = (book.title || 'book').replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 60)
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${encodeURIComponent(safeTitle)}.feb"`,
          'cache-control': 'no-store',
        },
      })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/feb/import',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: febImport,
      }),
    'smart-edit: feb import route',
  )
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/feb/export',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: febExport,
      }),
    'smart-edit: feb export route',
  )

  const mediaGet = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const bookId = url.searchParams.get('bookId')?.trim() ?? ''
    const name = url.searchParams.get('name')?.trim() ?? ''
    if (bookId === '' || name === '') return failure(400, 'INVALID_INPUT', 'bookId and name are required')
    try {
      const file = lib.readMediaFile(bookId, name)
      if (!file) return failure(404, 'NOT_FOUND', '媒体文件不存在')
      return new Response(new Uint8Array(file.bytes), {
        status: 200,
        headers: {
          'content-type': file.mime || 'application/octet-stream',
          'cache-control': 'public, max-age=3600',
        },
      })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const mediaPost = async (request: Request): Promise<Response> => {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return failure(400, 'INVALID_INPUT', 'multipart form required')
    }
    const bookId = String(form.get('bookId') ?? '').trim()
    const file = form.get('file')
    if (bookId === '' || !(file instanceof File)) {
      return failure(400, 'INVALID_INPUT', 'bookId and file are required')
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer())
      const mime = file.type || 'application/octet-stream'
      const saved = lib.putMediaFromBuffer(bookId, file.name || 'upload.bin', buf, mime)
      return json({ media: saved })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/media',
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request: Request) => (request.method === 'GET' ? mediaGet(request) : mediaPost(request)),
      }),
    'smart-edit: media route',
  )

  const moduleBlockUpdate = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as {
      chapterId?: unknown
      blockId?: unknown
      config?: unknown
      rev?: unknown
    } | null
    const chapterId = typeof input?.chapterId === 'string' ? input.chapterId.trim() : ''
    const blockId = typeof input?.blockId === 'string' ? input.blockId.trim() : ''
    if (chapterId === '' || blockId === '') {
      return failure(400, 'INVALID_INPUT', 'chapterId and blockId are required')
    }
    if (input?.config === null || typeof input?.config !== 'object' || Array.isArray(input.config)) {
      return failure(400, 'INVALID_INPUT', '"config" must be an object')
    }
    let rev: number | undefined
    if (input?.rev !== undefined && input.rev !== null) {
      if (typeof input.rev !== 'number' || !Number.isFinite(input.rev)) {
        return failure(400, 'INVALID_INPUT', '"rev" must be a finite number')
      }
      rev = input.rev
    }
    try {
      const chapter = lib.updateModuleBlock({
        chapterId,
        blockId,
        config: input.config as Record<string, unknown>,
        rev,
      })
      return json({ chapter })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/module-block/update',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: moduleBlockUpdate,
      }),
    'smart-edit: module block update route',
  )

  const chapterPreviews = async (request: Request): Promise<Response> => {
    const bookId = new URL(request.url).searchParams.get('bookId')?.trim() ?? ''
    if (bookId === '') return failure(400, 'INVALID_INPUT', 'bookId is required')
    try {
      return json({ previews: lib.listChapterPreviews(bookId) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/chapter/previews',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: chapterPreviews,
      }),
    'smart-edit: chapter previews route',
  )

  const workshopState = async (): Promise<Response> => {
    try {
      return json(lib.getWorkshopState())
    } catch (error) {
      return errorResponse(error)
    }
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/textbook/workshop-state',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: workshopState,
      }),
    'smart-edit: workshop state route',
  )

  const proposals = async (request: Request): Promise<Response> => {
    try {
      const chapterId = new URL(request.url).searchParams.get('chapterId')?.trim() || undefined
      return json({ proposals: lib.listProposals(chapterId) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const acceptProposal = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const id = typeof (body as { id?: unknown })?.id === 'string' ? ((body as { id: string }).id).trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a proposal "id" is required')
    try {
      return json(lib.acceptProposal(id))
    } catch (error) {
      return errorResponse(error)
    }
  }

  const rejectProposal = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const id = typeof (body as { id?: unknown })?.id === 'string' ? ((body as { id: string }).id).trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a proposal "id" is required')
    try {
      return json({ proposal: lib.rejectProposal(id) })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const quickEdit = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { mode?: unknown; text?: unknown; before?: unknown; after?: unknown; title?: unknown } | null
    const mode = input?.mode
    if (mode !== 'polish' && mode !== 'expand' && mode !== 'shorten') {
      return failure(400, 'INVALID_INPUT', '"mode" must be polish, expand or shorten')
    }
    const text = typeof input?.text === 'string' ? input.text.trim() : ''
    if (text === '') return failure(400, 'INVALID_INPUT', 'a non-empty "text" selection is required')
    if (text.length > 8000) return failure(413, 'INVALID_INPUT', 'the selection exceeds 8000 characters')
    try {
      const edited = await generateQuickEdit(ctx, {
        mode,
        text,
        before: typeof input?.before === 'string' ? input.before : undefined,
        after: typeof input?.after === 'string' ? input.after : undefined,
        title: typeof input?.title === 'string' ? input.title : undefined,
      }, request.signal)
      return json({ text: edited })
    } catch (error) {
      const code = codeOf(error)
      if (code === 'MODEL_UNCONFIGURED') return failure(503, 'MODEL_UNCONFIGURED', messageOf(error))
      if (request.signal.aborted) return failure(499, 'CANCELLED', 'the request was cancelled')
      return failure(502, 'MODEL_FAILED', messageOf(error))
    }
  }

  const modules = async (): Promise<Response> => {
    try {
      return json({ modules: lib.listModules() })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const writingContext = async (request: Request): Promise<Response> => {
    try {
      const params = new URL(request.url).searchParams
      return json({
        context: lib.writingContext({
          bookId: params.get('bookId')?.trim() || undefined,
          chapterId: params.get('chapterId')?.trim() || undefined,
        }),
      })
    } catch (error) {
      return errorResponse(error)
    }
  }

  const restoreProposal = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const id = typeof (body as { id?: unknown })?.id === 'string' ? ((body as { id: string }).id).trim() : ''
    if (id === '') return failure(400, 'INVALID_INPUT', 'a proposal "id" is required')
    try {
      return json(lib.restoreProposal(id))
    } catch (error) {
      return errorResponse(error)
    }
  }

  const writeSection = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return failure(400, 'INVALID_INPUT', 'the request body must be JSON')
    }
    const input = body as { chapterId?: unknown; mode?: unknown; instruction?: unknown } | null
    const chapterId = typeof input?.chapterId === 'string' ? input.chapterId.trim() : ''
    if (chapterId === '') return failure(400, 'INVALID_INPUT', 'a "chapterId" is required')
    const mode = input?.mode === 'continue' ? 'continue' : 'section'
    try {
      const generated = await generateChapterDoc(ctx, lib, {
        chapterId,
        mode,
        instruction: typeof input?.instruction === 'string' ? input.instruction : undefined,
      }, request.signal)
      const baseNote = mode === 'continue' ? 'AI 续写建议' : 'AI 写作建议'
      const proposal = lib.createProposal({
        chapterId,
        doc: generated.doc,
        note: generated.repaired ? `${baseNote}（模型输出被截断，已保留完整部分）` : baseNote,
        source: 'model',
      })
      return json({ proposal })
    } catch (error) {
      const code = codeOf(error)
      if (code === 'MODEL_UNCONFIGURED') return failure(503, 'MODEL_UNCONFIGURED', messageOf(error))
      if (code === 'REV_CONFLICT') return failure(409, 'REV_CONFLICT', messageOf(error))
      if (request.signal.aborted) return failure(499, 'CANCELLED', 'the request was cancelled')
      if (code === 'MODEL_FAILED') return failure(502, 'MODEL_FAILED', messageOf(error))
      return errorResponse(error)
    }
  }

  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/write', methods: ['POST'], requestBody: 'buffered', fetch: writeSection }),
    'smart-edit: write route',
  )

  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/proposals', methods: ['GET'], requestBody: 'buffered', fetch: proposals }),
    'smart-edit: proposals route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/proposals/restore', methods: ['POST'], requestBody: 'buffered', fetch: restoreProposal }),
    'smart-edit: restore proposal route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/modules', methods: ['GET'], requestBody: 'buffered', fetch: modules }),
    'smart-edit: modules route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/writing-context', methods: ['GET'], requestBody: 'buffered', fetch: writingContext }),
    'smart-edit: writing context route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/proposals/accept', methods: ['POST'], requestBody: 'buffered', fetch: acceptProposal }),
    'smart-edit: accept proposal route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/proposals/reject', methods: ['POST'], requestBody: 'buffered', fetch: rejectProposal }),
    'smart-edit: reject proposal route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({ path: '/api/textbook/quick-edit', methods: ['POST'], requestBody: 'buffered', fetch: quickEdit }),
    'smart-edit: quick edit route',
  )
}
