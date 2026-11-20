#!/usr/bin/env node
/**
 * Host-half smoke test for `packages/bundle/dist/index.js`.
 *
 * It loads the built single-file ESM bundle, applies it to a fake Cordis
 * context, checks the exported metadata, every `textbook__*` tool and every
 * `/api/textbook/*` Fetch route, then drives the real request/response
 * contract against a temporary SQLite library.
 *
 * Run from anywhere:
 *   node packages/bundle/tests/host.smoke.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundleRoot = path.resolve(here, '..')

/**
 * The bundle intentionally keeps `@deepseek-ai/*` external, exactly like the
 * installed plugin. For this standalone smoke run, resolve `dsh-tools` to the
 * reference checkout's built package. Set DSH_CHECKOUT to override it.
 */
const harnessRepo = path.resolve(bundleRoot, '../..')
const checkoutCandidates = [
  process.env.DSH_CHECKOUT,
  path.join(harnessRepo, '../aiwork-harness/deepseek-harness'),
  '/Users/wenpu/projects/zhiyuan/new/aiwork/aiwork-harness/deepseek-harness',
].filter(Boolean)
let checkout = ''
let toolsEntry = ''
for (const dir of checkoutCandidates) {
  const entry = path.join(dir, 'packages/core/tools/lib/index.js')
  if (fs.existsSync(entry)) {
    checkout = dir
    toolsEntry = entry
    break
  }
}
if (!toolsEntry) {
  console.error('FAIL  cannot find @deepseek-ai/dsh-tools (packages/core/tools/lib/index.js)')
  console.error('      build deepseek-harness or set DSH_CHECKOUT to that checkout')
  for (const dir of checkoutCandidates) {
    console.error(`      tried ${path.join(dir, 'packages/core/tools/lib/index.js')}`)
  }
  process.exit(1)
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: pathToFileURL(toolsEntry).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

/** Real host schema assertion, so a definition the Tools service would reject fails here. */
const { assertSupportedJsonSchema } = await import(pathToFileURL(toolsEntry).href)

const results = []
function record(ok, label, detail) {
  results.push({ ok, label, detail })
  const suffix = detail === undefined ? '' : ` — ${detail}`
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${suffix}`)
}

async function check(label, fn) {
  try {
    await fn()
    record(true, label)
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error))
  }
}

function expect(condition, message) {
  assert.ok(condition, message)
}

const EXPECTED_TOOLS = [
  'textbook__list_books',
  'textbook__get_book',
  'textbook__create_book',
  'textbook__update_book',
  'textbook__delete_book',
  'textbook__list_chapters',
  'textbook__get_chapter',
  'textbook__get_chapter_json',
  'textbook__save_chapter_json',
  'textbook__add_chapter',
  'textbook__delete_chapter',
  'textbook__rename_chapter',
  'textbook__move_chapter',
  'textbook__duplicate_chapter',
  'textbook__list_module_catalog',
  'textbook__describe_module',
  'textbook__insert_module_block',
  'textbook__update_module_block',
  'textbook__remove_block',
  'textbook__search_library',
  'textbook__import_feb',
  'textbook__export_feb',
  'textbook__import_json',
  'textbook__focus_chapter',
  'textbook__get_workshop_state',
  'textbook__writing_context',
  'textbook__propose_edit',
  'textbook__list_proposals',
  'textbook__accept_proposal',
  'textbook__reject_proposal',
  'textbook__restore_proposal',
]

const EXPECTED_ROUTES = {
  '/api/textbook/books': 'GET',
  '/api/textbook/book': 'GET',
  '/api/textbook/chapter': 'GET',
  '/api/textbook/save': 'POST',
  '/api/textbook/chapter/add': 'POST',
  '/api/textbook/chapter/rename': 'POST',
  '/api/textbook/chapter/delete': 'POST',
  '/api/textbook/chapter/move': 'POST',
  '/api/textbook/chapter/duplicate': 'POST',
  '/api/textbook/book/create': 'POST',
  '/api/textbook/book/update': 'POST',
  '/api/textbook/book/delete': 'POST',
  '/api/textbook/feb/import': 'POST',
  '/api/textbook/feb/export': 'GET',
  '/api/textbook/media': ['GET', 'POST'],
  '/api/textbook/module-block/update': 'POST',
  '/api/textbook/chapter/previews': 'GET',
  '/api/textbook/workshop-state': 'GET',
  '/api/textbook/proposals': 'GET',
  '/api/textbook/proposals/accept': 'POST',
  '/api/textbook/proposals/reject': 'POST',
  '/api/textbook/quick-edit': 'POST',
  '/api/textbook/modules': 'GET',
  '/api/textbook/write': 'POST',
  '/api/textbook/writing-context': 'GET',
  '/api/textbook/proposals/restore': 'POST',
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-host-'))
let mod
let ctx
const tools = new Map()
/** What the fake model streams for a document-writing request. */
let docReplyKind = 'doc'
const routes = new Map()
const skills = new Map()
const effects = []
const provided = new Map()

try {
  // -------------------------------------------------------------------------
  // Fake Cordis context: collect tool definitions, Fetch routes, and effects.
  // Cordis 0.2.x declares context properties through `provide`; mirror that so
  // `ctx.textbookLibrary = lib` follows the same path as the real host.
  // -------------------------------------------------------------------------
  ctx = {
    tools: {
      register(tool) {
        expect(tool !== null && typeof tool === 'object', 'tools.register expects a definition')
        expect(typeof tool.name === 'string' && tool.name !== '', 'tool definition has a name')
        tools.set(tool.name, tool)
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => {
            routes.delete(route.path)
          }
        },
      },
    },
    skills: {
      register(skill) {
        expect(typeof skill.name === 'string' && skill.name !== '', 'skill has a name')
        expect(typeof skill.description === 'string' && skill.description !== '', 'skill has a description')
        expect(typeof skill.content === 'string' && skill.content !== '', 'skill has content')
        skills.set(skill.name, skill)
        return () => skills.delete(skill.name)
      },
    },
    logger: { warn() {} },
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-flash' }) }
      }
      return undefined
    },
    llm: {
      async prepareCall() {
        return {
          config: {},
          async *stream(options) {
            const system = String(options?.system ?? '')
            if (!system.includes('只输出一个 Tiptap 文档')) {
              yield { type: 'text-delta', text: '改写后的文字' }
              return
            }
            const doc = JSON.stringify({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AI 写的正文' }] }],
            })
            if (docReplyKind === 'prose') {
              // A model that keeps talking after the JSON: the parser must stop at the balanced object.
              yield { type: 'text-delta', text: `${doc}\n\n补充说明：{ 这个花括号不是 JSON` }
              return
            }
            if (docReplyKind === 'truncated') {
              yield {
                type: 'text-delta',
                text: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"一"},{"type":"text","text":"二"}]},{"type":"paragraph","content":[{"type":"text","text":"三',
              }
              return
            }
            yield { type: 'text-delta', text: doc }
          },
        }
      },
    },
    effect(execute, label) {
      const dispose = execute()
      effects.push({ label, dispose })
      return () => {}
    },
    provide(name, value) {
      provided.set(name, value)
      ctx[name] = value
      return () => {
        provided.delete(name)
      }
    },
    set(name, value) {
      ctx[name] = value
    },
  }

  mod = await import(pathToFileURL(path.join(bundleRoot, 'dist/index.js')).href)

  await check('bundle exports name === "smart-edit"', () => {
    expect(mod.name === 'smart-edit', `name was ${JSON.stringify(mod.name)}`)
  })

  await check('bundle exports inject with tools + connection + skills', () => {
    expect(Array.isArray(mod.inject), 'inject must be an array')
    for (const name of ['tools', 'connection', 'skills']) {
      expect(mod.inject.includes(name), `inject is missing "${name}"`)
    }
  })

  await check('bundle exports apply()', () => {
    expect(typeof mod.apply === 'function', `apply was ${typeof mod.apply}`)
  })

  await check('apply() activates the plugin on a fake context', async () => {
    await mod.apply(ctx, {
      dataDir,
      moduleCatalogPath: path.join(bundleRoot, 'catalog/editor-module.json'),
    })
    expect(ctx.textbookLibrary !== undefined, 'ctx.textbookLibrary was not assigned')
    expect(provided.get('textbookLibrary') === ctx.textbookLibrary, 'ctx.provide did not expose the library')
  })

  await check(`all ${EXPECTED_TOOLS.length} textbook__* tools are registered`, () => {
    const missing = EXPECTED_TOOLS.filter((name) => !tools.has(name))
    expect(missing.length === 0, `missing tools: ${missing.join(', ')}`)
    const unexpected = [...tools.keys()].filter((name) => !EXPECTED_TOOLS.includes(name))
    expect(unexpected.length === 0, `unexpected tools: ${unexpected.join(', ')}`)
  })

  await check('every tool has description, parameters, output.render and execute', () => {
    for (const tool of tools.values()) {
      expect(typeof tool.description === 'string' && tool.description !== '', `${tool.name}: description`)
      expect(tool.parameters !== null && typeof tool.parameters === 'object', `${tool.name}: parameters`)
      expect(tool.output !== null && typeof tool.output === 'object', `${tool.name}: output`)
      expect(typeof tool.output.render === 'function', `${tool.name}: output.render`)
      expect(typeof tool.execute === 'function', `${tool.name}: execute`)
    }
  })

  await check('every tool definition passes the host schema assertion', () => {
    for (const tool of tools.values()) {
      expect(tool.parameters.type === 'object', `${tool.name}: parameters.type must be "object"`)
      assertSupportedJsonSchema(tool.parameters)
      expect(JSON.stringify(tool.output.schema) === '{}', `${tool.name}: output.schema must be the open JSON schema`)
      const rendered = tool.output.render({}, { ok: true })
      expect(Array.isArray(rendered) && rendered[0]?.type === 'text', `${tool.name}: output.render must project a text block`)
    }
  })

  await check('the bundled runtime skill is registered from skill/SKILL.md', () => {
    const skill = skills.get('smart-edit')
    expect(skill !== undefined, 'skill "smart-edit" was not registered')
    expect(skill.description.length > 0, 'skill description is empty')
    expect(skill.content.includes('textbook__'), 'skill body does not mention the textbook__ tools')
    expect(skill.path.endsWith('skill/SKILL.md'), `skill path was ${skill.path}`)
    expect(skill.resourceBase?.kind === 'directory', 'skill resourceBase is not a directory')
  })

  await check('every /api/textbook/* route is registered with the right methods', () => {
    const registered = [...routes.keys()].sort()
    expect(
      JSON.stringify(registered) === JSON.stringify(Object.keys(EXPECTED_ROUTES).sort()),
      `registered routes: ${registered.join(', ')}`,
    )
    for (const [routePath, methodOrMethods] of Object.entries(EXPECTED_ROUTES)) {
      const route = routes.get(routePath)
      const methods = Array.isArray(methodOrMethods) ? methodOrMethods : [methodOrMethods]
      expect(route.requestBody === 'buffered', `${routePath}: requestBody`)
      for (const method of methods) {
        expect(Array.isArray(route.methods) && route.methods.includes(method), `${routePath}: ${method}`)
      }
      expect(typeof route.fetch === 'function', `${routePath}: fetch`)
    }
  })

  await check('routes and library handle are owned by labelled effects', () => {
    const labels = effects.map((entry) => entry.label)
    for (const routePath of Object.keys(EXPECTED_ROUTES)) {
      expect(
        labels.some((label) => typeof label === 'string' && /^smart-edit: .+ route$/.test(label)),
        `no smart-edit route effect label (got ${labels.join(', ')})`,
      )
    }
    expect(labels.includes('smart-edit: library handle'), 'missing library handle effect')
  })

  const state = {}

  await check('module catalog loaded from the explicit path', async () => {
    const catalog = await tools.get('textbook__list_module_catalog').execute({}, {})
    expect(Array.isArray(catalog) && catalog.length > 0, 'module catalog is empty')
    const described = await tools.get('textbook__describe_module').execute(
      { type: catalog[0].type },
      {},
    )
    expect(described.type === catalog[0].type, 'describe_module returned another type')
    state.catalog = catalog
  })

  /** Route driver: real Request in, real Response out. */
  const drive = (pathname, init) => {
    const pathOnly = pathname.split('?')[0]
    const route = routes.get(pathOnly)
    expect(route !== undefined, `route ${pathOnly} is not registered`)
    return route.fetch(new Request(`http://localhost${pathname}`, init))
  }

  await check('textbook__create_book creates a book and a first page', async () => {
    const book = await tools.get('textbook__create_book').execute({ title: 'Smoke Book' }, {})
    expect(typeof book.id === 'string' && book.id !== '', 'book id')
    expect(book.title === 'Smoke Book', 'book title')
    expect(Array.isArray(book.chapters) && book.chapters.length === 1, 'one starter chapter')
    expect(book.chapters[0].role === 'page', 'starter chapter is a page')
    state.bookId = book.id
    state.chapterId = book.chapters[0].id
  })

  await check('textbook__add_chapter creates a nested page under a part', async () => {
    const part = await tools.get('textbook__add_chapter').execute(
      { bookId: state.bookId, title: 'Part One', role: 'part' },
      {},
    )
    expect(part.role === 'part', 'part role')
    const child = await tools.get('textbook__add_chapter').execute(
      { bookId: state.bookId, parentId: part.id, title: 'Nested Page', role: 'page' },
      {},
    )
    expect(typeof child.id === 'string' && child.id !== state.chapterId, 'child chapter id')
    expect(child.parent_id === part.id, 'child parent_id')
    state.partChapterId = part.id
    state.childChapterId = child.id
  })

  await check('GET /api/textbook/books?q= lists the created book', async () => {
    const response = await drive('/api/textbook/books?q=Smoke', { method: 'GET' })
    expect(response.status === 200, `status ${response.status}`)
    expect(response.headers.get('content-type')?.startsWith('application/json'), 'content-type')
    const body = await response.json()
    expect(Array.isArray(body.books), 'body.books')
    expect(body.books.some((book) => book.id === state.bookId), 'created book not listed')
  })

  await check('GET /api/textbook/book?id= returns every chapter, including nested pages', async () => {
    const response = await drive(
      `/api/textbook/book?id=${encodeURIComponent(state.bookId)}`,
      { method: 'GET' },
    )
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(body.book.id === state.bookId, 'book.id')
    expect(Array.isArray(body.book.chapters), 'book.chapters')
    const ids = body.book.chapters.map((chapter) => chapter.id)
    expect(ids.includes(state.chapterId), 'root chapter missing')
    expect(ids.includes(state.childChapterId), 'nested page missing from the route payload')

    // The agent tool keeps its historical root-only view; only the route is flat.
    const viaTool = await tools.get('textbook__get_book').execute({ id: state.bookId }, {})
    expect(viaTool.chapters.length === 2, `get_book returned ${viaTool.chapters.length} root chapters`)
    expect(
      !viaTool.chapters.some((chapter) => chapter.id === state.childChapterId),
      'get_book must stay root-only',
    )
  })

  await check('GET /api/textbook/chapter?id= returns metadata + content_json', async () => {
    const response = await drive(
      `/api/textbook/chapter?id=${encodeURIComponent(state.chapterId)}`,
      { method: 'GET' },
    )
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(body.chapter.id === state.chapterId, 'chapter.id')
    expect(typeof body.chapter.rev === 'number', 'chapter.rev')
    expect(typeof body.chapter.content_json === 'string', 'chapter.content_json')
    const doc = JSON.parse(body.chapter.content_json)
    expect(doc.type === 'doc', 'content_json is a Tiptap doc')
    state.initialRev = body.chapter.rev
  })

  await check('POST /api/textbook/save persists a Tiptap doc and bumps rev', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Smoke heading' }],
        },
      ],
    }
    const response = await drive('/api/textbook/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: state.chapterId, content: doc, rev: state.initialRev }),
    })
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(body.chapter.id === state.chapterId, 'chapter.id')
    expect(body.chapter.rev === state.initialRev + 1, 'rev was not incremented')
    assert.deepEqual(JSON.parse(body.chapter.content_json), doc)
    state.savedRev = body.chapter.rev
  })

  await check('POST /api/textbook/save with a stale rev returns 409 REV_CONFLICT', async () => {
    const response = await drive('/api/textbook/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: state.chapterId,
        content: { type: 'doc', content: [] },
        rev: state.initialRev,
      }),
    })
    expect(response.status === 409, `status ${response.status}`)
    const body = await response.json()
    expect(body.error?.code === 'REV_CONFLICT', `error.code was ${body.error?.code}`)
    expect(typeof body.error?.message === 'string' && body.error.message !== '', 'error.message')
  })

  await check('unknown ids return 404 on chapter, book and save', async () => {
    const chapter = await drive('/api/textbook/chapter?id=does-not-exist', { method: 'GET' })
    expect(chapter.status === 404, `chapter status ${chapter.status}`)
    const chapterBody = await chapter.json()
    expect(chapterBody.error?.code === 'NOT_FOUND', `chapter error.code ${chapterBody.error?.code}`)

    const book = await drive('/api/textbook/book?id=does-not-exist', { method: 'GET' })
    expect(book.status === 404, `book status ${book.status}`)
    const bookBody = await book.json()
    expect(bookBody.error?.code === 'NOT_FOUND', `book error.code ${bookBody.error?.code}`)

    const saved = await drive('/api/textbook/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'does-not-exist', content: { type: 'doc', content: [] } }),
    })
    expect(saved.status === 404, `save status ${saved.status}`)
    const savedBody = await saved.json()
    expect(savedBody.error?.code === 'NOT_FOUND', `save error.code ${savedBody.error?.code}`)
  })

  await check('missing ids on GET routes return 400 INVALID_INPUT', async () => {
    for (const routePath of ['/api/textbook/chapter', '/api/textbook/book']) {
      const response = await drive(routePath, { method: 'GET' })
      expect(response.status === 400, `${routePath} status ${response.status}`)
      const payload = await response.json()
      expect(payload.error?.code === 'INVALID_INPUT', `${routePath} error.code ${payload.error?.code}`)
    }
  })

  await check('POST /api/textbook/save with a bad body returns 400 INVALID_INPUT', async () => {
    const cases = [
      ['{not json', 'invalid json'],
      [JSON.stringify({ content: { type: 'doc', content: [] } }), 'missing id'],
      [JSON.stringify({ id: state.chapterId, content: 'nope' }), 'bad content'],
      [JSON.stringify({ id: state.chapterId, content: {}, rev: 'one' }), 'bad rev'],
    ]
    for (const [body, label] of cases) {
      const response = await drive('/api/textbook/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(response.status === 400, `${label} status ${response.status}`)
      const payload = await response.json()
      expect(payload.error?.code === 'INVALID_INPUT', `${label} error.code ${payload.error?.code}`)
    }
  })

  await check('saving a non-page chapter returns 400 NOT_EDITABLE', async () => {
    const response = await drive('/api/textbook/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: state.partChapterId,
        content: { type: 'doc', content: [] },
        rev: 1,
      }),
    })
    expect(response.status === 400, `status ${response.status}`)
    const payload = await response.json()
    expect(payload.error?.code === 'NOT_EDITABLE', `error.code ${payload.error?.code}`)
  })

  // -------------------------------------------------------------------------
  // Beyond the route contract: the SQLite adapter also backs media,
  // module blocks, chapter tree writes and FEB import/export.
  // -------------------------------------------------------------------------

  await check('media upsert exercises ON CONFLICT and media delete', () => {
    const lib = ctx.textbookLibrary
    const first = lib.putMediaFromBuffer(
      state.bookId,
      'cover.txt',
      Buffer.from('hello'),
      'text/plain',
    )
    expect(first.filename === 'cover.txt', 'media filename')
    expect(typeof first.sha256 === 'string' && first.sha256.length === 64, 'media sha256')
    lib.putMediaFromBuffer(state.bookId, 'cover.txt', Buffer.from('hello world'), 'text/plain')
    const rows = lib.listMedia(state.bookId)
    expect(rows.length === 1, `upsert left ${rows.length} rows`)
    expect(Number(rows[0].size) === Buffer.byteLength('hello world'), 'media size was not updated')
    lib.putMediaFromBuffer(state.bookId, 'tmp.txt', Buffer.from('x'), 'text/plain')
    lib.deleteMedia(state.bookId, 'tmp.txt')
    expect(lib.listMedia(state.bookId).length === 1, 'media delete failed')
  })

  await check('chapter add/delete still honours the COUNT(*) guard', async () => {
    const added = await tools
      .get('textbook__add_chapter')
      .execute({ bookId: state.bookId, title: 'Extra Page' }, {})
    expect(typeof added.id === 'string' && added.id !== state.chapterId, 'added chapter id')
    const removed = await tools.get('textbook__delete_chapter').execute({ id: added.id }, {})
    expect(removed.ok === true, 'delete_chapter result')
  })

  await check('module block insert/update/remove round-trips', async () => {
    const type = state.catalog[0].type
    const inserted = await tools.get('textbook__insert_module_block').execute(
      {
        bookId: state.bookId,
        chapterId: state.chapterId,
        type,
        config: { prompt: 'hello' },
        rev: state.savedRev,
      },
      {},
    )
    expect(inserted.rev === state.savedRev + 1, 'insert did not bump rev')
    const doc = JSON.parse(inserted.content_json)
    const block = doc.content.find((node) => node.type === type)
    expect(block !== undefined, 'inserted block missing from doc')
    expect(typeof block.attrs?.blockId === 'string', 'blockId missing')
    state.blockId = block.attrs.blockId
    state.savedRev = inserted.rev

    const updated = await tools.get('textbook__update_module_block').execute(
      {
        chapterId: state.chapterId,
        blockId: state.blockId,
        config: { prompt: 'updated' },
        rev: state.savedRev,
      },
      {},
    )
    expect(updated.rev === state.savedRev + 1, 'update did not bump rev')
    const updatedBlock = JSON.parse(updated.content_json).content.find(
      (node) => node.attrs?.blockId === state.blockId,
    )
    expect(updatedBlock?.attrs?.config?.prompt === 'updated', 'block config was not updated')
    state.savedRev = updated.rev
  })

  await check('textbook__duplicate_chapter clones a page subtree', async () => {
    const dup = await tools.get('textbook__duplicate_chapter').execute({ id: state.childChapterId }, {})
    expect(dup.id !== state.childChapterId, 'duplicate id')
    expect(dup.title.includes('副本'), 'duplicate title suffix')
    const flat = ctx.textbookLibrary.listChaptersFlat(state.bookId)
    expect(flat.some((row) => row.id === dup.id), 'duplicate missing from book')
    state.duplicateChapterId = dup.id
  })

  await check('POST /api/textbook/chapter/duplicate matches the library tool', async () => {
    const response = await drive('/api/textbook/chapter/duplicate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: state.chapterId }),
    })
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(body.chapter.id !== state.chapterId, 'route duplicate id')
    expect(Array.isArray(body.book.chapters), 'book.chapters')
  })

  await check('GET /api/textbook/workshop-state reflects focus_chapter', async () => {
    await tools.get('textbook__focus_chapter').execute(
      { bookId: state.bookId, chapterId: state.childChapterId },
      {},
    )
    const response = await drive('/api/textbook/workshop-state', { method: 'GET' })
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(body.focus?.chapterId === state.childChapterId, 'focus chapterId')
    expect(body.focus?.bookId === state.bookId, 'focus bookId')
  })

  await check('GET /api/textbook/chapter/previews returns page snippets', async () => {
    const response = await drive(
      `/api/textbook/chapter/previews?bookId=${encodeURIComponent(state.bookId)}`,
      { method: 'GET' },
    )
    expect(response.status === 200, `status ${response.status}`)
    const body = await response.json()
    expect(typeof body.previews === 'object', 'previews object')
    expect(
      Object.keys(body.previews).some((id) => body.previews[id].snippet || body.previews[id].thumbName),
      'at least one page preview',
    )
  })

  await check('POST /api/textbook/book/create and update change the catalog', async () => {
    const created = await drive('/api/textbook/book/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'HTTP Created Book' }),
    })
    expect(created.status === 200, `create status ${created.status}`)
    const createdBody = await created.json()
    const httpBookId = createdBody.book.id
    expect(createdBody.book.title === 'HTTP Created Book', 'create title')

    const updated = await drive('/api/textbook/book/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: httpBookId, title: 'HTTP Renamed' }),
    })
    expect(updated.status === 200, `update status ${updated.status}`)
    const updatedBody = await updated.json()
    expect(updatedBody.book.title === 'HTTP Renamed', 'update title')
    state.httpBookId = httpBookId
  })

  await check('FEB export writes a file and FEB import (new) round-trips', async () => {
    const febPath = path.join(dataDir, 'smoke-export.feb')
    const exported = await tools
      .get('textbook__export_feb')
      .execute({ bookId: state.bookId, destPath: febPath }, {})
    expect(exported.path === febPath, 'export path')
    expect(fs.existsSync(febPath), 'FEB file missing')
    expect(fs.statSync(febPath).size > 0, 'FEB file empty')

    const imported = await tools
      .get('textbook__import_feb')
      .execute({ path: febPath, mode: 'new' }, {})
    expect(imported.id !== state.bookId, 'import should create a new book')
    expect(Array.isArray(imported.chapters) && imported.chapters.length >= 1, 'imported chapters')
    expect(ctx.textbookLibrary.listMedia(imported.id).length === 1, 'media was not imported')
    state.importedBookId = imported.id
  })

  await check('GET/POST /api/textbook/feb/export and import round-trip over HTTP', async () => {
    const exported = await drive(
      `/api/textbook/feb/export?id=${encodeURIComponent(state.bookId)}`,
      { method: 'GET' },
    )
    expect(exported.status === 200, `export status ${exported.status}`)
    const zip = Buffer.from(await exported.arrayBuffer())
    expect(zip.length > 0, 'export zip empty')

    const imported = await drive('/api/textbook/feb/import?mode=new', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip,
    })
    expect(imported.status === 200, `import status ${imported.status}`)
    const body = await imported.json()
    expect(body.book.id !== state.bookId, 'http import new book')
    state.httpFebBookId = body.book.id
  })

  await check('POST /api/textbook/media uploads and GET serves the bytes', async () => {
    const form = new FormData()
    form.set('bookId', state.bookId)
    form.set('file', new Blob(['smoke-image'], { type: 'text/plain' }), 'smoke-upload.txt')
    const uploaded = await drive('/api/textbook/media', { method: 'POST', body: form })
    expect(uploaded.status === 200, `upload status ${uploaded.status}`)
    const uploadBody = await uploaded.json()
    expect(typeof uploadBody.media?.filename === 'string', 'media filename')
    const filename = uploadBody.media.filename

    const served = await drive(
      `/api/textbook/media?bookId=${encodeURIComponent(state.bookId)}&name=${encodeURIComponent(filename)}`,
      { method: 'GET' },
    )
    expect(served.status === 200, `get media status ${served.status}`)
    const text = await served.text()
    expect(text === 'smoke-image', 'media bytes')
  })

  await check('POST /api/textbook/book/delete removes a book', async () => {
    const response = await drive('/api/textbook/book/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: state.httpBookId }),
    })
    expect(response.status === 200, `delete status ${response.status}`)
    const listed = await drive('/api/textbook/books', { method: 'GET' })
    const body = await listed.json()
    expect(!body.books.some((book) => book.id === state.httpBookId), 'deleted book still listed')
  })

  await check('search_library works through LIKE ... ESCAPE', () => {
    const found = ctx.textbookLibrary.searchLibrary('Smoke')
    expect(Array.isArray(found.books), 'search books')
    expect(found.books.some((book) => book.id === state.bookId), 'book not found by title')
  })

  await check('module block remove strips the node', async () => {
    const removed = await tools.get('textbook__remove_block').execute(
      { chapterId: state.chapterId, blockId: state.blockId, rev: state.savedRev },
      {},
    )
    expect(removed.rev === state.savedRev + 1, 'remove did not bump rev')
    const doc = JSON.parse(removed.content_json)
    expect(doc.content.every((node) => node.attrs?.blockId !== state.blockId), 'block still present')
  })
  await check('writing_context returns the book, outline and open chapter', async () => {
    const context = await tools.get('textbook__writing_context').execute(
      { bookId: state.bookId, chapterId: state.chapterId },
      {},
    )
    expect(context.book.id === state.bookId, 'book missing')
    expect(Array.isArray(context.outline) && context.outline.length >= 1, 'outline missing')
    expect(context.chapter.id === state.chapterId, 'chapter missing')
    expect(Array.isArray(context.modules) && context.modules.length > 0, 'module catalog missing')
  })

  await check('propose_edit stores a suggestion; accept applies it and reject drops one', async () => {
    const chapter = ctx.textbookLibrary.getChapter(state.chapterId)
    const proposed = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'AI 建议写入的正文。' }] }],
    }
    const proposal = await tools.get('textbook__propose_edit').execute(
      { chapterId: state.chapterId, doc: proposed, baseRev: chapter.rev, note: '改写第一段' },
      {},
    )
    expect(proposal.status === 'pending', 'proposal is not pending')
    expect(proposal.chapter_id === state.chapterId, 'proposal chapter mismatch')
    // Nothing was written yet.
    expect(ctx.textbookLibrary.getChapter(state.chapterId).rev === chapter.rev, 'propose wrote the chapter')

    const listed = await tools.get('textbook__list_proposals').execute({ chapterId: state.chapterId }, {})
    expect(listed.some((row) => row.id === proposal.id), 'proposal not listed')

    const accepted = await tools.get('textbook__accept_proposal').execute({ id: proposal.id }, {})
    expect(accepted.chapter.rev === chapter.rev + 1, 'accept did not bump rev')
    expect(accepted.proposal.status === 'accepted', 'proposal not marked accepted')
    expect(accepted.chapter.content_json.includes('AI 建议写入的正文'), 'proposed text not written')

    const second = await tools.get('textbook__propose_edit').execute(
      { chapterId: state.chapterId, doc: proposed, baseRev: accepted.chapter.rev },
      {},
    )
    const rejected = await tools.get('textbook__reject_proposal').execute({ id: second.id }, {})
    expect(rejected.status === 'rejected', 'proposal not rejected')
  })

  await check('accepting a stale proposal refuses when chapter body changed', async () => {
    const chapter = ctx.textbookLibrary.getChapter(state.chapterId)
    const stale = await tools.get('textbook__propose_edit').execute(
      {
        chapterId: state.chapterId,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧建议' }] }] },
        baseRev: chapter.rev,
      },
      {},
    )
    ctx.textbookLibrary.saveChapterJson(
      state.chapterId,
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '人工改写' }] }] },
      { rev: chapter.rev },
    )
    let code
    try {
      await tools.get('textbook__accept_proposal').execute({ id: stale.id }, {})
    } catch (error) {
      code = error.code
      ctx.textbookLibrary.rejectProposal(stale.id)
    }
    expect(code === 'REV_CONFLICT', `expected REV_CONFLICT, got ${code}`)
  })

  await check('accept proposal when only rev moved but body unchanged', async () => {
    const chapter = ctx.textbookLibrary.getChapter(state.chapterId)
    const body = JSON.parse(chapter.content_json)
    const proposal = await tools.get('textbook__propose_edit').execute(
      {
        chapterId: state.chapterId,
        doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '仅 rev 漂移' }] }] },
        baseRev: chapter.rev,
      },
      {},
    )
    ctx.textbookLibrary.saveChapterJson(state.chapterId, body, { rev: chapter.rev })
    expect(ctx.textbookLibrary.getChapter(state.chapterId).rev === chapter.rev + 1, 'save did not bump rev')
    const accepted = await tools.get('textbook__accept_proposal').execute({ id: proposal.id }, {})
    expect(accepted.chapter.content_json.includes('仅 rev 漂移'), 'proposal not applied after rev-only drift')
  })

  await check('restore_proposal undoes an accepted proposal', async () => {
    const chapter = ctx.textbookLibrary.getChapter(state.chapterId)
    const before = ctx.textbookLibrary.getChapterJson?.(chapter.id)
    const proposal = await tools.get('textbook__propose_edit').execute(
      { chapterId: chapter.id, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '撤销前' }] }] } },
      {},
    )
    const accepted = await tools.get('textbook__accept_proposal').execute({ id: proposal.id }, {})
    expect(accepted.chapter.rev === chapter.rev + 1, 'accept did not bump rev')
    const restored = await tools.get('textbook__restore_proposal').execute({ id: proposal.id }, {})
    expect(restored.chapter.rev === chapter.rev + 2, 'restore did not bump rev')
    expect(!restored.chapter.content_json.includes('撤销前'), 'restore kept the accepted text')
    expect(restored.proposal.status === 'reverted', 'proposal not marked reverted')
    expect(before === undefined || restored.chapter.content_json === before, 'restore did not bring the old document back')
  })

  await check('modules and writing-context routes answer the panel', async () => {
    const modules = await routes.get('/api/textbook/modules').fetch(new Request('http://local/api/textbook/modules'))
    expect(modules.status === 200, 'modules route refused')
    const modulePayload = await modules.json()
    expect(Array.isArray(modulePayload.modules) && modulePayload.modules.length > 0, 'modules missing')
    expect(typeof modulePayload.modules[0].type === 'string', 'module type missing')

    const context = await routes.get('/api/textbook/writing-context').fetch(
      new Request(`http://local/api/textbook/writing-context?chapterId=${state.chapterId}`),
    )
    expect(context.status === 200, 'writing-context refused')
    const contextPayload = await context.json()
    expect(contextPayload.context.chapter.id === state.chapterId, 'context chapter mismatch')
  })

  await check('write route leaves a reviewable proposal instead of writing the chapter', async () => {
    const before = ctx.textbookLibrary.getChapter(state.chapterId)
    const response = await routes.get('/api/textbook/write').fetch(new Request('http://local/api/textbook/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterId: state.chapterId, mode: 'section' }),
    }))
    expect(response.status === 200, `write route refused with ${response.status}`)
    const payload = await response.json()
    expect(payload.proposal.status === 'pending', 'proposal is not pending')
    expect(payload.proposal.note === 'AI 写作建议', `unexpected note: ${payload.proposal.note}`)
    expect(payload.proposal.doc.type === 'doc', 'proposal doc is not a document')
    // The chapter still holds what it held before; only acceptance writes.
    expect(ctx.textbookLibrary.getChapter(state.chapterId).rev === before.rev, 'write route modified the chapter')
  })

  await check('write route ignores prose after the JSON document', async () => {
    docReplyKind = 'prose'
    try {
      const response = await routes.get('/api/textbook/write').fetch(new Request('http://local/api/textbook/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapterId: state.chapterId, mode: 'section' }),
      }))
      expect(response.status === 200, `write route refused with ${response.status}`)
      const payload = await response.json()
      expect(payload.proposal.doc.content[0].content[0].text === 'AI 写的正文', 'document not parsed')
      expect(!String(payload.proposal.note).includes('截断'), 'a complete document was reported as truncated')
    } finally {
      docReplyKind = 'doc'
    }
  })

  await check('write route repairs a truncated document instead of failing', async () => {
    docReplyKind = 'truncated'
    try {
      const response = await routes.get('/api/textbook/write').fetch(new Request('http://local/api/textbook/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chapterId: state.chapterId, mode: 'section' }),
      }))
      expect(response.status === 200, `write route refused with ${response.status}`)
      const payload = await response.json()
      expect(Array.isArray(payload.proposal.doc.content) && payload.proposal.doc.content.length >= 1, 'repaired doc is empty')
      expect(String(payload.proposal.note).includes('截断'), 'the repair was not reported')
    } finally {
      docReplyKind = 'doc'
    }
  })

  await check('quick-edit route rewrites a selection through the host model', async () => {
    const route = routes.get('/api/textbook/quick-edit')
    expect(route !== undefined, 'quick-edit route missing')
    const response = await route.fetch(new Request('http://local/api/textbook/quick-edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'polish', text: '这句话要润色。' }),
    }))
    expect(response.status === 200, `quick-edit refused with ${response.status}`)
    const payload = await response.json()
    expect(payload.text === '改写后的文字', `unexpected text: ${String(payload.text)}`)
  })
} catch (error) {
  record(false, 'smoke run crashed', error instanceof Error ? error.stack : String(error))
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok).length
console.log('')
console.log(
  failed === 0
    ? `PASS host.smoke: ${results.length} checks passed (tmp data dir removed)`
    : `FAIL host.smoke: ${failed}/${results.length} checks failed`,
)
if (failed !== 0) process.exitCode = 1
