#!/usr/bin/env node
/**
 * DOM test for the smart-edit panel's rich-text surface.
 *
 * Loads the real browser bundle inside jsdom, mounts the panel with a stubbed
 * `/api/textbook/*` host, and proves the Tiptap editor actually renders a
 * chapter: the text is editable, an unknown module block appears as its card,
 * and saving posts the block back unchanged.
 *
 * Run with `node tests/editor.dom.mjs`. jsdom is taken from the workspace's
 * existing install (set DSH_EDITOR_DEPS to another package directory).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundleRoot = join(here, '..')
const clientRoot = join(bundleRoot, '..', 'client')
const editorDeps = process.env.DSH_EDITOR_DEPS ?? '/Users/wenpu/projects/zhiyuan/new/aiwork/aiwork-editor'

const requireClient = createRequire(join(clientRoot, 'package.json'))
const requireEditorDeps = createRequire(join(editorDeps, 'package.json'))
const { JSDOM } = requireEditorDeps('jsdom')
const React = requireClient('react')
const ReactDom = requireClient('react-dom')
const ReactDomClient = requireClient('react-dom/client')
const jsxRuntime = requireClient('react/jsx-runtime')

const failures = []
let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${error instanceof Error ? error.stack : String(error)}`)
  }
}

const document = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '第一章' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '正文第一段。' }] },
    { type: 'examQuestion', attrs: { blockId: 'b_1', v: 1, config: { stem: '1+1=?' } } },
  ],
}

const chapter = {
  id: 'c1',
  book_id: 'b1',
  title: '第一章',
  role: 'page',
  rev: 3,
  content_json: JSON.stringify(document),
}

const saved = []
const fetchCalls = []
let proposalList = [{
  id: 'p1', chapter_id: 'c1', base_rev: 3, note: '把开头写得更具体', source: 'agent', status: 'pending',
  created_at: 1, updated_at: 1,
}]

// ---------------------------------------------------------------------------
// jsdom globals: ProseMirror needs a document, a window and a selection
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:54840/',
  pretendToBeVisual: true,
})
const { window } = dom
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'Event', 'KeyboardEvent',
  'MouseEvent', 'InputEvent', 'DocumentFragment', 'NodeFilter', 'CustomEvent', 'FocusEvent',
]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
}
window.fetch = async (input, init) => {
  const url = String(input)
  fetchCalls.push(url)
  const path = url.split('?')[0]
  if (path.endsWith('/api/textbook/books')) {
    return new Response(JSON.stringify({ books: [{ id: 'b1', title: '测试书' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/book')) {
    return new Response(JSON.stringify({ book: { id: 'b1', title: '测试书', chapters: [chapter] } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/chapter')) {
    return new Response(JSON.stringify({ chapter }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/modules')) {
    return new Response(JSON.stringify({
      modules: [{ type: 'quiz', name: '练习测验', group: 'assessment', defaultConfig: {} }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/proposals')) {
    return new Response(JSON.stringify({ proposals: proposalList }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/writing-context')) {
    return new Response(JSON.stringify({
      context: { book: { id: 'b1', title: '测试书' }, outline: [{ id: 'c1', title: '第一章', role: 'page', rev: 3, parent_id: null }], modules: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/write')) {
    const created = {
      id: 'p2', chapter_id: 'c1', base_rev: 3, note: 'AI 写作建议', source: 'model', status: 'pending', created_at: 2, updated_at: 2,
    }
    proposalList = [...proposalList, created]
    return new Response(JSON.stringify({ proposal: created }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/proposals/accept')) {
    const accepted = {
      ...chapter,
      rev: 4,
      content_json: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '接受建议后的正文。' }] }],
      }),
    }
    return new Response(JSON.stringify({ chapter: accepted, proposal: { id: 'p1', status: 'accepted' } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (path.endsWith('/api/textbook/save')) {
    const body = JSON.parse(init.body)
    saved.push(body)
    return new Response(JSON.stringify({ chapter: { ...chapter, rev: 4, content_json: JSON.stringify(body.content) } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`unexpected fetch ${url}`)
}
globalThis.fetch = window.fetch

// ---------------------------------------------------------------------------
// Load the bundle exactly as the module table does
// ---------------------------------------------------------------------------
let handoff
window.__ModuleLoader__ = { load(entry) { handoff = entry } }
new Function(readFileSync(join(bundleRoot, 'dist/client.js'), 'utf8'))()

const requireShim = (specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  if (specifier === 'react-dom') return ReactDom
  if (specifier === 'react-dom/client') return ReactDomClient
  throw new Error(`unexpected require: ${specifier}`)
}

const exports = handoff.factory(requireShim)
const root = ReactDomClient.createRoot(window.document.getElementById('root'))

/** Wait until a selector appears (or the timeout expires). */
async function waitFor(selector, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = window.document.querySelector(selector)
    if (found !== null) return found
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return null
}

try {
  root.render(React.createElement(exports.SmartEditPanel, {}))
} catch (error) {
  console.error(`FAIL mounting the panel threw: ${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
}

/** Wait until a predicate over the document becomes true. */
async function waitUntil(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return false
}

await check('the panel mounts and lists the stubbed library', async () => {
  const page = await waitFor('[data-testid="fe-library-page"]')
  assert.ok(page !== null, 'the library page never appeared')
  const listed = await waitUntil(() => [...window.document.querySelectorAll('.fe-library-card-title')].some(el => el.textContent === '测试书'))
  assert.ok(listed, 'the stub book title is missing from the library grid')
})

await check('opening a book from the library enters the workshop', async () => {
  const open = [...window.document.querySelectorAll('button')].find(button => /打开编辑|Open/.test(button.textContent ?? ''))
  assert.ok(open !== undefined, 'no open-book button')
  open.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const workshop = await waitUntil(() => window.document.querySelector('.fe-workshop-body') !== null)
  assert.ok(workshop, 'workshop body did not appear')
})

// Opening a chapter is a click in the chapter list.
await check('clicking a chapter loads its document', async () => {
  const listed = await waitUntil(() => [...window.document.querySelectorAll('button')].some(button => /第一章/.test(button.textContent ?? '')))
  assert.ok(listed, 'the chapter entry never appeared')
  const entry = [...window.document.querySelectorAll('button')].find(button => /第一章/.test(button.textContent ?? ''))
  entry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const loaded = await waitUntil(() => fetchCalls.some(url => url.includes('/api/textbook/chapter')))
  assert.ok(loaded, 'the chapter was never fetched')
})

await check('the Tiptap editor renders the chapter document', async () => {
  const prose = await waitFor('.tiptap')
  assert.ok(prose !== null, 'the .tiptap surface never appeared')
  assert.match(prose.textContent, /第一章/, 'the heading text is missing')
  assert.match(prose.textContent, /正文第一段/, 'the paragraph text is missing')
})

await check('an unknown module block renders as a preserved card', async () => {
  const card = await waitFor('.se-module')
  assert.ok(card !== null, 'the module card never appeared')
  assert.match(card.textContent, /examQuestion/, 'the card does not name the block type')
  assert.match(card.textContent, /b_1/, 'the card does not show the block id')
})

await check('a panel re-render keeps the same editor instead of rebuilding it', async () => {
  const before = window.document.querySelector('.tiptap')
  assert.ok(before !== null, 'the editor is missing before the re-render')
  // The parent re-renders on every panel state change; re-creating the editor
  // there tears down an in-flight IME composition, which is why typing broke.
  root.render(React.createElement(exports.SmartEditPanel, {}))
  await new Promise(resolve => setTimeout(resolve, 50))
  const after = window.document.querySelector('.tiptap')
  assert.ok(after !== null, 'the editor is missing after the re-render')
  assert.equal(after, before, 'the editor was re-created on a panel re-render')
})

await check('saving posts the document with the module block intact', async () => {
  const buttons = [...window.document.querySelectorAll('button')]
  const save = buttons.find(button => /保存/.test(button.textContent ?? ''))
  assert.ok(save !== undefined, 'no save button')
  save.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const deadline = Date.now() + 4000
  while (saved.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(saved.length, 1, 'the panel never posted a save')
  assert.equal(saved[0].id, 'c1')
  assert.equal(saved[0].rev, 3)
  const block = saved[0].content.content.find(node => node.type === 'examQuestion')
  assert.ok(block !== undefined, 'the saved document lost the module block')
  assert.deepEqual(block.attrs.config, { stem: '1+1=?' })
  assert.equal(block.attrs.blockId, 'b_1')
})

await check('a pending agent proposal is listed and can be accepted', async () => {
  await new Promise(resolve => setTimeout(resolve, 200))
  const banner = await waitUntil(() => {
    const el = window.document.querySelector('.se-proposals')
    return el !== null && el.textContent.includes('把开头写得更具体')
  })
  assert.ok(banner, 'the proposals banner never appeared')
  const accept = [...window.document.querySelectorAll('.se-proposals button')]
    .find(button => (button.textContent ?? '').trim() === '接受')
  assert.ok(accept !== undefined, 'no accept button in the proposals banner')
  accept.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const applied = await waitUntil(() => (window.document.body.textContent ?? '').includes('接受建议后的正文'))
  assert.ok(applied, 'the accepted text never reached the editor')
})

await check('the AI writing card runs the task and leaves a proposal', async () => {
  const button = [...window.document.querySelectorAll('button')]
    .find(el => (el.textContent ?? '').trim() === 'AI 写作')
  assert.ok(button !== undefined, 'the AI writing button is missing')
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const overlay = await waitFor('.se-task-overlay')
  assert.ok(overlay !== null, 'the task card never opened')
  const run = [...overlay.querySelectorAll('button')].find(el => (el.textContent ?? '').trim() === '执行')
  assert.ok(run !== undefined, 'the task card has no run button')
  run.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const listed = await waitUntil(() => (window.document.body.textContent ?? '').includes('AI 写作建议'))
  assert.ok(listed, 'the proposal from the run never reached the banner')
})

root.unmount()
dom.window.close()

if (failures.length > 0) {
  console.log(`\nFAIL editor.dom: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nPASS ${passed} checks — the rich-text panel mounts, renders blocks and saves them`)
