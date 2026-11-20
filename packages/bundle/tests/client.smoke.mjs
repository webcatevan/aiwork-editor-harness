#!/usr/bin/env node
/**
 * Smoke test for the built smart-edit browser bundle.
 *
 * It loads `../dist/client.js` the way the DSH module table does, evaluates
 * the `window.__ModuleLoader__.load({ id, factory })` handoff, resolves the
 * bundle's externals through a tiny React shim, applies the plugin to a
 * recording fake Context, and finally renders the panel once to prove its
 * first request goes to `/api/textbook/books`.
 *
 * Run with `node tests/client.smoke.mjs` (Node 24).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'dist', 'client.js')
const expectedId = '@aiwork/dsh-smart-edit'

let passed = 0
const failures = []

/** Run one named check, recording PASS/FAIL instead of aborting the suite. */
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Await one named async check. */
async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// Bundle shape
// ---------------------------------------------------------------------------

let source
try {
  source = readFileSync(bundlePath, 'utf8')
} catch (error) {
  console.error(`FAIL cannot read ${bundlePath}: ${error.message}`)
  process.exit(1)
}

// build.mjs prepends a `//!` banner before the wrapper, so compare the first
// non-comment line while still requiring the handoff to be the first statement.
const firstStatement = source.replace(/^(?:\s*\/\/[^\n]*\n)+/, '').trimStart()

check('bundle starts with the window.__ModuleLoader__.load wrapper', () => {
  assert.ok(
    firstStatement.startsWith('window.__ModuleLoader__.load({'),
    `bundle begins with: ${JSON.stringify(firstStatement.slice(0, 80))}`,
  )
})

check('bundle declares the @aiwork/dsh-smart-edit id', () => {
  assert.match(source, /id:\s*"@aiwork\/dsh-smart-edit"/)
})

check('bundle has no externals beyond React', () => {
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  assert.deepEqual([...new Set(required)].sort(), ['react', 'react-dom', 'react/jsx-runtime'])
})

check('bundle inlines Tiptap instead of requiring it', () => {
  assert.ok(!/require\("@tiptap\//.test(source), 'the bundle requires @tiptap/* from the module table')
  assert.ok(source.includes('se-editor'), 'the rich-text styles are missing')
})

// ---------------------------------------------------------------------------
// Module loader + React shim
// ---------------------------------------------------------------------------

let handoff
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      handoff = entry
    },
  },
}

try {
  // Deliberate bundle fixture: evaluate it in the window-compatible scope.
  new Function(source)()
} catch (error) {
  console.error(`FAIL bundle evaluation threw: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
}

check('loader captured one handoff', () => {
  assert.ok(handoff && typeof handoff === 'object', 'window.__ModuleLoader__.load was not called')
  assert.equal(handoff.id, expectedId)
  assert.equal(typeof handoff.factory, 'function')
})

// Real React (the same major the module table hands the browser), so Tiptap's
// module-level initialisation behaves exactly as it does in the app.
const requireFromClient = createRequire(join(here, '..', '..', 'client', 'package.json'))
const React = requireFromClient('react')
const ReactDom = requireFromClient('react-dom')
const ReactDomServer = requireFromClient('react-dom/server')
const jsxRuntime = requireFromClient('react/jsx-runtime')

const requireShim = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === 'react-dom') return ReactDom
  if (specifier === 'react-dom/client') return ReactDom
  throw new Error(`unexpected require: ${specifier}`)
}

let exports
try {
  exports = handoff.factory(requireShim)
} catch (error) {
  console.error(`FAIL factory threw: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
}

check('factory exports inject, apply, and the panel component', () => {
  assert.deepEqual(exports.inject, ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(typeof exports.SmartEditPanel, 'function')
  for (const name of ['fetchBooks', 'fetchBook', 'fetchChapter', 'saveChapter']) {
    assert.equal(typeof exports[name], 'function', `${name} is not exported`)
  }
})

// ---------------------------------------------------------------------------
// apply() against a recording context
// ---------------------------------------------------------------------------

const injections = []
const registrations = []
const localeRegistrations = []
const effects = []

const fakeCtx = {
  effect(callback, label) {
    effects.push(label)
    const dispose = callback()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  locale: {
    register(namespace, dictionaries) {
      localeRegistrations.push({ namespace, dictionaries })
      return () => {}
    },
    bind(namespace) {
      return (key) => `${namespace}.${key}`
    },
  },
  slots: {
    inject(slot, callback) {
      injections.push(slot)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

try {
  exports.apply(fakeCtx)
} catch (error) {
  console.error(`FAIL apply threw: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
}

check('apply injects main and sidebar.panellist in that order', () => {
  assert.deepEqual(injections, ['main', 'sidebar.panellist'])
})

check('apply registers the main panel with key smart-edit', () => {
  const main = registrations.find(entry => entry.options.name === 'main')
  assert.ok(main, 'no main registration')
  assert.equal(main.options.key, 'smart-edit')
  assert.equal(main.options.locale, 'smart-edit')
  assert.equal(typeof main.component, 'function')
})

check('apply registers the sidebar entry with id smart-edit and order 3', () => {
  const sidebar = registrations.find(entry => entry.options.name === 'sidebar.panellist')
  assert.ok(sidebar, 'no sidebar.panellist registration')
  assert.equal(sidebar.options.id, 'smart-edit')
  assert.equal(sidebar.options.order, 3)
  assert.equal(sidebar.options.locale, 'smart-edit')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof sidebar.options.label, 'function')
  assert.equal(sidebar.options.label(), 'smart-edit.panel')
})

check('apply registers zh and en dictionaries under the smart-edit namespace', () => {
  assert.equal(effects.length, 1)
  assert.equal(localeRegistrations.length, 1)
  const registration = localeRegistrations[0]
  assert.equal(registration.namespace, 'smart-edit')
  const dictionaries = registration.dictionaries
  assert.ok(dictionaries.zh && dictionaries.en, 'zh/en dictionaries missing')
  assert.equal(dictionaries.zh.panel, '智能编辑')
  assert.equal(dictionaries.en.panel, 'Smart edit')
  for (const key of ['panel', 'refresh', 'save', 'saved', 'conflict', 'noBooks', 'loading']) {
    assert.ok(typeof dictionaries.zh[key] === 'string', `zh is missing ${key}`)
    assert.ok(typeof dictionaries.en[key] === 'string', `en is missing ${key}`)
  }
})

// ---------------------------------------------------------------------------
// One server render: the panel mounts with its shell and empty states
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch
let markup = ''
try {
  const main = registrations.find(entry => entry.options.name === 'main')
  markup = ReactDomServer.renderToStaticMarkup(React.createElement(main.component, {}))
} catch (error) {
  failures.push({ name: 'panel renders', error })
  console.log(`FAIL panel renders: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  globalThis.fetch = originalFetch
}

await checkAsync('the panel renders its shell with an empty library', async () => {
  assert.ok(markup.includes('书库') || markup.includes('Library'), 'the library title is missing')
  assert.ok(markup.includes('fe-library-page'), 'the library page shell is missing')
  assert.ok(markup.includes('正在读取书库') || markup.includes('书库为空'), 'the loading/empty state is missing')
})

// ---------------------------------------------------------------------------
// Schema round-trip: a stored chapter keeps every node, attribute and mark
// ---------------------------------------------------------------------------

await checkAsync('a chapter with module blocks round-trips through the editor schema', async () => {
  const { getSchema } = requireFromClient('@tiptap/core')
  const { Node } = requireFromClient('@tiptap/pm/model')
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第三章' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '正文 ' },
          { type: 'text', marks: [{ type: 'bold' }], text: '加粗' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: '链接' },
        ],
      },
      {
        type: 'examQuestion',
        attrs: { blockId: 'b_1', v: 1, config: { stem: '1+1=?', answer: '2', nested: { a: [1, 2] } } },
      },
      {
        type: 'columnLayout',
        attrs: { blockId: 'b_2' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '左栏' }] }],
      },
    ],
  }
  const { scan } = exports.readDoc(JSON.stringify(doc))
  const schema = getSchema(exports.extensionsFor(scan))
  const parsed = Node.fromJSON(schema, doc).toJSON()
  assert.equal(parsed.content[2].type, 'examQuestion', 'the module block was dropped')
  assert.deepEqual(parsed.content[2].attrs.config, doc.content[2].attrs.config, 'module config changed')
  assert.equal(parsed.content[2].attrs.blockId, 'b_1')
  assert.equal(parsed.content[3].type, 'columnLayout', 'the unknown container was dropped')
  assert.equal(parsed.content[3].content[0].content[0].text, '左栏', 'nested content was dropped')
  assert.deepEqual(parsed.content[1].content[1].marks, [{ type: 'bold' }], 'mark lost')
  assert.equal(parsed.content[1].content[2].marks[0].attrs.href, 'https://example.com')
})

await checkAsync('the slash menu can insert a module the document does not use yet', async () => {
  const { getSchema } = requireFromClient('@tiptap/core')
  const { scan } = exports.readDoc(JSON.stringify({ type: 'doc', content: [] }))
  const schema = getSchema(exports.extensionsFor(scan, ['examQuestion']))
  assert.ok(schema.nodes.examQuestion, 'the insertable module is missing from the schema')
  const node = schema.nodes.examQuestion.create({ config: { stem: '1+1=?' }, v: 1, blockId: 'b_1' })
  const json = node.toJSON()
  assert.equal(json.type, 'examQuestion')
  assert.deepEqual(json.attrs.config, { stem: '1+1=?' })
  assert.equal(json.attrs.blockId, 'b_1')
})

await checkAsync('modules, writing-context and restore use their own URLs', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body })
    const url = String(input)
    if (url.startsWith('/api/textbook/modules')) return jsonResponse({ modules: [{ type: 'quiz', name: '测验', group: 'assessment', defaultConfig: {} }] })
    if (url.startsWith('/api/textbook/writing-context')) return jsonResponse({ context: { book: { id: 'b1', title: 'B' }, outline: [], modules: [] } })
    return jsonResponse({ chapter: { id: 'c1', rev: 9, content_json: '{}' }, proposal: { id: 'p1', status: 'reverted' } })
  }
  try {
    const modules = await exports.fetchModules()
    assert.equal(modules[0].type, 'quiz')
    const context = await exports.fetchWritingContext({ chapterId: 'c1' })
    assert.equal(context.book.id, 'b1')
    const restored = await exports.restoreProposal('p1')
    assert.equal(restored.chapter.rev, 9)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0].url, '/api/textbook/modules')
  assert.equal(calls[1].url, '/api/textbook/writing-context?chapterId=c1')
  assert.equal(calls[2].url, '/api/textbook/proposals/restore')
})

await checkAsync('writeSection POSTs the chapter and mode', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return jsonResponse({ proposal: { id: 'p1', status: 'pending', note: 'AI 写作建议' } })
  }
  try {
    const proposal = await exports.writeSection('c1', 'continue', '写短一点')
    assert.equal(proposal.id, 'p1')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0].url, '/api/textbook/write')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { chapterId: 'c1', mode: 'continue', instruction: '写短一点' })
})

await checkAsync('an unknown mark is reported so the panel can stay in JSON', async () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'pinyinRuby' }], text: '汉' }] }],
  }
  const { marks } = exports.readDoc(JSON.stringify(doc))
  const known = exports.knownMarkNames()
  assert.ok(known.has('bold') && known.has('link'), 'baseline marks are missing')
  assert.deepEqual([...marks].filter(mark => !known.has(mark)), ['pinyinRuby'])
})

await checkAsync('an unreadable document is reported as invalid', async () => {
  const { scan } = exports.readDoc('{ not json')
  assert.equal(scan.valid, false)
})

// ---------------------------------------------------------------------------
// HTTP contract: exact paths, JSON bodies, and the 409 mapping
// ---------------------------------------------------------------------------

/** Build one JSON Response for the stubs below. */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

await checkAsync('books URL keeps q optional and encodes a non-empty query', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return jsonResponse({ books: [] })
  }
  try {
    await exports.fetchBooks('')
    await exports.fetchBooks('hello world')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0], '/api/textbook/books')
  assert.equal(calls[1], '/api/textbook/books?q=hello+world')
})

await checkAsync('book URL is /api/textbook/book?id=...', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return jsonResponse({ book: { id: 'book-1', title: 'B', chapters: [] } })
  }
  try {
    const book = await exports.fetchBook('book-1')
    assert.equal(book.id, 'book-1')
    assert.deepEqual(book.chapters, [])
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0], '/api/textbook/book?id=book-1')
})

await checkAsync('chapter URL is /api/textbook/chapter?id=...', async () => {
  const calls = []
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return jsonResponse({ chapter: { id: 'chapter-1', title: 'C', role: 'page', rev: 3, content_json: '{}' } })
  }
  try {
    const chapter = await exports.fetchChapter('chapter-1')
    assert.equal(chapter.rev, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0], '/api/textbook/chapter?id=chapter-1')
})

await checkAsync('save POSTs { id, content, rev } to /api/textbook/save', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return jsonResponse({ chapter: { id: 'chapter-1', title: 'C', role: 'page', rev: 8, content_json: '{}' } })
  }
  try {
    const saved = await exports.saveChapter('chapter-1', { type: 'doc', content: [] }, 7)
    assert.equal(saved.rev, 8)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0].url, '/api/textbook/save')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    id: 'chapter-1',
    content: { type: 'doc', content: [] },
    rev: 7,
  })
})

await checkAsync('quick-edit POSTs the mode and the selection text', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return jsonResponse({ text: '改写后的文字' })
  }
  try {
    const text = await exports.quickEdit('polish', '原文', { chapterId: 'c1', title: '第一章' })
    assert.equal(text, '改写后的文字')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0].url, '/api/textbook/quick-edit')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { mode: 'polish', text: '原文', chapterId: 'c1', title: '第一章' })
})

await checkAsync('proposals are listed, accepted and rejected by id', async () => {
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body })
    const url = String(input)
    if (url.startsWith('/api/textbook/proposals/accept')) {
      return jsonResponse({ chapter: { id: 'c1', rev: 5, content_json: '{}' }, proposal: { id: 'p1', status: 'accepted' } })
    }
    if (url.startsWith('/api/textbook/proposals/reject')) {
      return jsonResponse({ proposal: { id: 'p1', status: 'rejected' } })
    }
    return jsonResponse({ proposals: [{ id: 'p1', status: 'pending', note: 'n' }] })
  }
  try {
    const listed = await exports.fetchProposals('c1')
    assert.equal(listed.length, 1)
    const accepted = await exports.acceptProposal('p1')
    assert.equal(accepted.chapter.rev, 5)
    const rejected = await exports.rejectProposal('p1')
    assert.equal(rejected.status, 'rejected')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls[0].url, '/api/textbook/proposals?chapterId=c1')
  assert.equal(calls[1].url, '/api/textbook/proposals/accept')
  assert.deepEqual(JSON.parse(calls[1].body), { id: 'p1' })
  assert.equal(calls[2].url, '/api/textbook/proposals/reject')
})

await checkAsync('HTTP 409 becomes a TextbookError with the host message', async () => {
  globalThis.fetch = async () => jsonResponse({
    error: { code: 'REV_CONFLICT', message: '章节版本冲突：当前 rev=2' },
  }, 409)
  try {
    await assert.rejects(
      () => exports.saveChapter('chapter-1', { type: 'doc', content: [] }, 1),
      (error) => {
        assert.ok(error instanceof exports.TextbookError, 'not a TextbookError')
        assert.equal(error.status, 409)
        assert.equal(error.message, '章节版本冲突：当前 rev=2')
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const total = passed + failures.length
if (failures.length === 0) {
  console.log(`\nPASS ${passed}/${total} checks — ${expectedId} browser bundle is loadable`)
  process.exit(0)
}

console.log(`\nFAIL ${failures.length}/${total} checks failed`)
for (const { name, error } of failures) {
  console.log(`  - ${name}: ${error instanceof Error ? error.stack : String(error)}`)
}
process.exit(1)
