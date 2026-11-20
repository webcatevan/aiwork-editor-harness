import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import {
  applyMediaRenamesToChapters,
  buildFebBuffer,
  EMPTY_DOC,
  parseJson,
  readFebBuffer,
  readFebFile,
  textbookMediaUrl,
  writeFebFile,
  type FebExportInput,
  type FebImportResult,
} from '@aiwork/interactive-book-format'
import {
  buildById,
  normalizeParentId,
  normalizeRole,
  validateMove,
  validateRoleAtDepth,
  chapterDepth,
  collectSubtreeIds,
  countPages,
  type ChapterNode,
  type ChapterRole,
} from './chapter-tree.js'

function now() {
  return Date.now()
}

function nid() {
  return randomUUID()
}

/**
 * The handful of synchronous SQLite calls this library uses. It is
 * satisfied by the `node:sqlite` adapter below; keeping the shape explicit
 * avoids leaking driver-specific row/statement types into the domain code.
 */
type SqlValue = string | number | bigint | null | Uint8Array
type SqlRow = Record<string, unknown>

interface SqlPreparedStatement {
  get(...params: SqlValue[]): SqlRow | undefined
  all(...params: SqlValue[]): SqlRow[]
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
}

interface SqlDatabase {
  prepare(sql: string): SqlPreparedStatement
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
}

/**
 * Small synchronous adapter over `node:sqlite`'s `DatabaseSync`.
 *
 * `better-sqlite3` is not shipped by the Electron host, while `node:sqlite`
 * is. The adapter preserves this file's existing call sites
 * (`db.prepare(sql).get/all/run` and `db.exec(sql)`) and adds the one
 * `transaction()` helper the FEB importer relies on.
 */
class NodeSqliteDatabase implements SqlDatabase {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
  }

  prepare(sql: string): SqlPreparedStatement {
    const statement = this.db.prepare(sql)
    return {
      get: (...params) => statement.get(...params) as SqlRow | undefined,
      all: (...params) => statement.all(...params) as SqlRow[],
      run: (...params) => statement.run(...params),
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          // Preserve the original failure if the transaction already ended.
        }
        throw error
      }
    }
  }
}

type BookRow = {
  id: string
  title: string
  created_at: number
  updated_at: number
  kind: string
  category: string
}

type ModuleCatalogItem = {
  type: string
  name: string
  group_key: string
  enabled: number
  sort_order: number
  default_config?: Record<string, unknown>
}

export type WorkshopFocus = { bookId?: string; chapterId?: string }

/** One pending or settled edit an agent proposed for a chapter. */
export interface ProposalRow {
  id: string
  book_id: string
  chapter_id: string
  base_rev: number
  doc_json: string
  note: string
  source: string
  status: 'pending' | 'accepted' | 'rejected' | 'reverted' | (string & {})
  /** The chapter document as it was when the proposal was made, for undo. */
  before_json: string | null
  /** Chapter rev after this proposal was accepted; used by {@link restoreProposal}. */
  applied_rev: number | null
  created_at: number
  updated_at: number
}

export class TextbookLibrary {
  private db: SqlDatabase
  private catalog: ModuleCatalogItem[] = []
  workshopFocus: WorkshopFocus = {}

  constructor(
    readonly rootDir: string,
    catalogPath?: string,
  ) {
    fs.mkdirSync(rootDir, { recursive: true })
    const dbPath = path.join(rootDir, 'library.sqlite')
    this.db = new NodeSqliteDatabase(dbPath)
    this.migrate()
    if (catalogPath && fs.existsSync(catalogPath)) {
      this.loadCatalog(catalogPath)
    }
  }

  get mediaRoot() {
    return path.join(this.rootDir, 'media')
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS book (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'interactive',
        category TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS chapter (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        title TEXT NOT NULL,
        sort INTEGER NOT NULL,
        parent_id TEXT,
        role TEXT NOT NULL DEFAULT 'page',
        content_json TEXT NOT NULL,
        rev INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(book_id) REFERENCES book(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(book_id, filename),
        FOREIGN KEY(book_id) REFERENCES book(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chapter_book_parent ON chapter(book_id, parent_id, sort);
      CREATE TABLE IF NOT EXISTS proposal (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        base_rev INTEGER NOT NULL,
        doc_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_proposal_chapter ON proposal(chapter_id, status);
    `)
    // Older libraries predate proposal snapshots; adding the column is idempotent.
    const columns = this.db.prepare('PRAGMA table_info(proposal)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'before_json')) {
      this.db.exec('ALTER TABLE proposal ADD COLUMN before_json TEXT')
    }
    const columnsAfter = this.db.prepare('PRAGMA table_info(proposal)').all() as { name: string }[]
    if (!columnsAfter.some((column) => column.name === 'applied_rev')) {
      this.db.exec('ALTER TABLE proposal ADD COLUMN applied_rev INTEGER')
    }
  }

  loadCatalog(catalogPath: string) {
    const raw = parseJson<{ groups?: Array<{ modules?: Array<{ type: string; name: string }> }> }>(
      fs.readFileSync(catalogPath, 'utf8'),
      {},
    )
    const items: ModuleCatalogItem[] = []
    let sort = 0
    for (const g of raw.groups || []) {
      const groupKey = (g as { key?: string }).key || 'sim'
      for (const m of g.modules || []) {
        items.push({
          type: m.type,
          name: m.name || m.type,
          group_key: groupKey,
          enabled: 1,
          sort_order: sort++,
          default_config: {},
        })
      }
    }
    this.catalog = items
  }

  listBooks(query = '') {
    const q = `%${query}%`
    const rows = query
      ? (this.db
          .prepare(`SELECT * FROM book WHERE title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC`)
          .all(q) as BookRow[])
      : (this.db.prepare('SELECT * FROM book ORDER BY updated_at DESC').all() as BookRow[])
    return rows
  }

  getBook(id: string) {
    const book = this.db.prepare('SELECT * FROM book WHERE id = ?').get(id) as BookRow | undefined
    if (!book) throw Object.assign(new Error('书不存在'), { code: 'NOT_FOUND' })
    const chapters = this.listChapters(id)
    return { ...book, chapters }
  }

  createBook(title: string, opts: { kind?: string } = {}) {
    const t = now()
    const id = nid()
    this.db
      .prepare(
        'INSERT INTO book(id, title, created_at, updated_at, kind, category) VALUES(?,?,?,?,?,?)',
      )
      .run(id, title || '未命名', t, t, opts.kind || 'interactive', '')
    this.addChapter(id, '未命名', undefined, { role: 'page' })
    return this.getBook(id)
  }

  updateBook(id: string, patch: { title?: string; category?: string }) {
    const book = this.db.prepare('SELECT * FROM book WHERE id = ?').get(id) as BookRow | undefined
    if (!book) throw new Error('书不存在')
    const title = patch.title ?? book.title
    const category = patch.category ?? book.category
    this.db
      .prepare('UPDATE book SET title = ?, category = ?, updated_at = ? WHERE id = ?')
      .run(title, category, now(), id)
    return this.getBook(id)
  }

  deleteBook(id: string) {
    this.db.prepare('DELETE FROM media WHERE book_id = ?').run(id)
    this.db.prepare('DELETE FROM chapter WHERE book_id = ?').run(id)
    this.db.prepare('DELETE FROM book WHERE id = ?').run(id)
    fs.rmSync(path.join(this.mediaRoot, id), { recursive: true, force: true })
    return { ok: true }
  }

  listChapters(bookId: string, parentId: string | null = null) {
    const rows = (parentId
      ? this.db
          .prepare('SELECT * FROM chapter WHERE book_id = ? AND parent_id = ? ORDER BY sort ASC')
          .all(bookId, parentId)
      : this.db
          .prepare('SELECT * FROM chapter WHERE book_id = ? AND parent_id IS NULL ORDER BY sort ASC')
          .all(bookId)) as ChapterNode[]
    return rows.map((c) => ({
      ...c,
      parent_id: normalizeParentId(c.parent_id),
      role: normalizeRole(c.role),
    }))
  }

  listChaptersFlat(bookId: string) {
    const rows = this.db
      .prepare('SELECT * FROM chapter WHERE book_id = ? ORDER BY sort ASC')
      .all(bookId) as ChapterNode[]
    return rows.map((c) => ({
      ...c,
      parent_id: normalizeParentId(c.parent_id),
      role: normalizeRole(c.role),
    }))
  }

  getChapter(id: string) {
    const row = this.db.prepare('SELECT * FROM chapter WHERE id = ?').get(id) as ChapterNode | undefined
    if (!row) throw Object.assign(new Error('章节不存在'), { code: 'NOT_FOUND' })
    return {
      ...row,
      parent_id: normalizeParentId(row.parent_id),
      role: normalizeRole(row.role),
    }
  }

  saveChapterJson(id: string, content: unknown, opts: { rev?: number } = {}) {
    const ch = this.getChapter(id)
    if (ch.role !== 'page') {
      throw Object.assign(new Error('仅页面节点可编辑正文'), { code: 'NOT_EDITABLE' })
    }
    if (opts.rev != null && Number(opts.rev) !== Number(ch.rev)) {
      throw Object.assign(new Error(`章节版本冲突：当前 rev=${ch.rev}`), { code: 'REV_CONFLICT' })
    }
    const t = now()
    const json = JSON.stringify(content)
    this.db
      .prepare('UPDATE chapter SET content_json = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
      .run(json, t, id)
    this.db.prepare('UPDATE book SET updated_at = ? WHERE id = ?').run(t, ch.book_id)
    return this.getChapter(id)
  }

  addChapter(
    bookId: string,
    title: string,
    afterId?: string,
    opts: { parentId?: string | null; role?: ChapterRole } = {},
  ) {
    const role = normalizeRole(opts.role)
    const parentId = normalizeParentId(opts.parentId)
    const all = this.listChaptersFlat(bookId)
    const byId = buildById(all)
    const parentNode = parentId ? byId.get(parentId) : undefined
    const depth = parentNode ? chapterDepth(parentNode, byId) + 1 : 1
    const roleErr = validateRoleAtDepth(role, depth)
    if (roleErr) throw new Error(roleErr)
    if (parentId && byId.get(parentId)?.role === 'page') throw new Error('页面下不能再放子节点')
    const siblings = this.listChapters(bookId, parentId)
    let sort = siblings.length
    if (afterId) {
      const idx = siblings.findIndex((s) => s.id === afterId)
      if (idx >= 0) sort = idx + 1
    }
    const t = now()
    const id = nid()
    const contentJson = role === 'page' ? JSON.stringify(EMPTY_DOC) : JSON.stringify(EMPTY_DOC)
    this.db
      .prepare(
        `INSERT INTO chapter(id, book_id, title, sort, parent_id, role, content_json, rev, updated_at, created_at)
         VALUES(?,?,?,?,?,?,?,1,?,?)`,
      )
      .run(id, bookId, title || '未命名', sort, parentId, role, contentJson, t, t)
    return this.getChapter(id)
  }

  deleteChapter(id: string) {
    const ch = this.getChapter(id)
    const all = this.listChaptersFlat(ch.book_id)
    const subtreeIds = collectSubtreeIds(id, all)
    const pagesAfter = countPages(all.filter((row) => !subtreeIds.includes(row.id)))
    if (pagesAfter < 1) throw new Error('至少保留一页')
    const t = now()
    const placeholders = subtreeIds.map(() => '?').join(',')
    const tx = this.db.transaction(() => {
      if (placeholders.length > 0) {
        this.db.prepare(`DELETE FROM proposal WHERE chapter_id IN (${placeholders})`).run(...subtreeIds)
        this.db.prepare(`DELETE FROM chapter WHERE id IN (${placeholders})`).run(...subtreeIds)
      }
      this.db.prepare('UPDATE book SET updated_at = ? WHERE id = ?').run(t, ch.book_id)
    })
    tx()
    return { ok: true, deletedIds: subtreeIds }
  }

  renameChapter(id: string, title: string) {
    this.db.prepare('UPDATE chapter SET title = ?, updated_at = ? WHERE id = ?').run(title, now(), id)
    return this.getChapter(id)
  }

  private renumberChapterSiblings(bookId: string, parentId: string | null) {
    const siblings = this.listChapters(bookId, parentId)
    const tx = this.db.transaction(() => {
      siblings.forEach((row, index) => {
        this.db.prepare('UPDATE chapter SET sort = ? WHERE id = ?').run(index, row.id)
      })
    })
    tx()
  }

  moveChapter(id: string, opts: { parentId?: string | null; afterId?: string | null } = {}) {
    const node = this.getChapter(id)
    const newParent =
      opts.parentId !== undefined ? normalizeParentId(opts.parentId) : normalizeParentId(node.parent_id)
    const all = this.listChaptersFlat(node.book_id)
    const byId = buildById(all)
    const err = validateMove(node, newParent, byId)
    if (err) throw new Error(err)
    const oldParent = normalizeParentId(node.parent_id)
    const siblings = this.listChapters(node.book_id, newParent).filter((row) => row.id !== id)
    let sort = siblings.length
    if (opts.afterId) {
      const index = siblings.findIndex((row) => row.id === opts.afterId)
      if (index >= 0) sort = index + 1
    }
    const t = now()
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE chapter SET parent_id = ?, sort = ?, updated_at = ? WHERE id = ?')
        .run(newParent, sort, t, id)
      this.db.prepare('UPDATE book SET updated_at = ? WHERE id = ?').run(t, node.book_id)
    })
    tx()
    this.renumberChapterSiblings(node.book_id, oldParent)
    this.renumberChapterSiblings(node.book_id, newParent)
    return this.getChapter(id)
  }

  duplicateChapter(chapterId: string) {
    const ch = this.getChapter(chapterId)
    const all = this.listChaptersFlat(ch.book_id)
    const byId = buildById(all)
    const t = now()

    const duplicateNode = (srcId: string, newParentId: string | null, afterId?: string): string => {
      const src = byId.get(srcId)!
      const created = this.addChapter(ch.book_id, `${src.title} 副本`, afterId, {
        parentId: newParentId,
        role: src.role,
      })
      if (src.role === 'page') {
        this.db
          .prepare('UPDATE chapter SET content_json = ?, updated_at = ? WHERE id = ?')
          .run(src.content_json, t, created.id)
      }
      const children = all.filter((row) => row.parent_id === srcId).sort((a, b) => a.sort - b.sort)
      let prevId: string | undefined
      for (const child of children) {
        prevId = duplicateNode(child.id, created.id, prevId)
      }
      return created.id
    }

    return this.getChapter(duplicateNode(chapterId, ch.parent_id, ch.id))
  }

  /** Every enabled module with the config an inserted block starts from. */
  listModules() {
    return this.catalog
      .filter((item) => item.enabled)
      .map((item) => ({
        type: item.type,
        name: item.name,
        group: item.group_key,
        defaultConfig: item.default_config ?? {},
      }))
  }

  listModuleCatalog() {
    return this.catalog.filter((c) => c.enabled).map((c) => ({
      type: c.type,
      name: c.name,
      group: c.group_key,
    }))
  }

  describeModule(type: string) {
    const item = this.catalog.find((c) => c.type === type)
    if (!item) throw new Error(`未知模块 type：${type}`)
    return {
      type: item.type,
      name: item.name,
      defaultConfig: item.default_config || {},
    }
  }

  moduleEnabled(type: string) {
    return this.catalog.some((c) => c.type === type && c.enabled)
  }

  walkBlocks(doc: { content?: unknown[] }, visit: (node: Record<string, unknown>, parent: unknown[], index: number) => void) {
    const walk = (nodes: unknown[]) => {
      nodes.forEach((n, i) => {
        if (!n || typeof n !== 'object') return
        const node = n as Record<string, unknown>
        visit(node, nodes, i)
        if (Array.isArray(node.content)) walk(node.content as unknown[])
      })
    }
    walk(doc.content || [])
  }

  insertModuleBlock(args: {
    bookId: string
    chapterId: string
    type: string
    config?: Record<string, unknown>
    afterBlockId?: string
    rev?: number
  }) {
    if (!this.moduleEnabled(args.type)) throw new Error(`模块未启用或不存在：${args.type}`)
    const contract = this.describeModule(args.type)
    const ch = this.getChapter(args.chapterId)
    if (args.rev != null && Number(args.rev) !== Number(ch.rev)) {
      throw Object.assign(new Error(`章节版本冲突：当前 rev=${ch.rev}`), { code: 'REV_CONFLICT' })
    }
    const doc = parseJson<{ type: string; content: unknown[] }>(ch.content_json, EMPTY_DOC)
    const mergedConfig = { ...(contract.defaultConfig || {}), ...(args.config || {}) }
    const block = {
      type: args.type,
      attrs: {
        config: mergedConfig,
        v: 1,
        blockId: `b_${randomUUID().slice(0, 8)}`,
      },
    }
    if (args.afterBlockId) {
      let inserted = false
      this.walkBlocks(doc, (node, parent, index) => {
        if (inserted) return
        const bid = (node.attrs as { blockId?: string } | undefined)?.blockId
        if (bid === args.afterBlockId) {
          parent.splice(index + 1, 0, block)
          inserted = true
        }
      })
      if (!inserted) doc.content.push(block)
    } else {
      doc.content.push(block)
    }
    return this.saveChapterJson(ch.id, doc, { rev: args.rev })
  }

  updateModuleBlock(args: {
    chapterId: string
    blockId: string
    config: Record<string, unknown>
    rev?: number
  }) {
    const ch = this.getChapter(args.chapterId)
    if (args.rev != null && Number(args.rev) !== Number(ch.rev)) {
      throw Object.assign(new Error(`章节版本冲突：当前 rev=${ch.rev}`), { code: 'REV_CONFLICT' })
    }
    const doc = parseJson<{ type: string; content: unknown[] }>(ch.content_json, EMPTY_DOC)
    let found = false
    this.walkBlocks(doc, (node) => {
      const attrs = node.attrs as { blockId?: string; config?: Record<string, unknown> } | undefined
      if (attrs?.blockId === args.blockId) {
        attrs.config = { ...(attrs.config || {}), ...args.config }
        found = true
      }
    })
    if (!found) throw new Error('未找到该互动块')
    return this.saveChapterJson(ch.id, doc, { rev: args.rev })
  }

  removeBlock(args: { chapterId: string; blockId: string; rev?: number }) {
    const ch = this.getChapter(args.chapterId)
    if (args.rev != null && Number(args.rev) !== Number(ch.rev)) {
      throw Object.assign(new Error(`章节版本冲突：当前 rev=${ch.rev}`), { code: 'REV_CONFLICT' })
    }
    const doc = parseJson<{ type: string; content: unknown[] }>(ch.content_json, EMPTY_DOC)
    let removed = false
    const strip = (nodes: unknown[]): unknown[] =>
      nodes.filter((n) => {
        if (!n || typeof n !== 'object') return true
        const node = n as Record<string, unknown>
        const bid = (node.attrs as { blockId?: string } | undefined)?.blockId
        if (bid === args.blockId) {
          removed = true
          return false
        }
        if (Array.isArray(node.content)) node.content = strip(node.content)
        return true
      })
    doc.content = strip(doc.content) as unknown[]
    if (!removed) throw new Error('未找到该互动块')
    return this.saveChapterJson(ch.id, doc, { rev: args.rev })
  }

  putMediaFromBuffer(bookId: string, filename: string, buf: Buffer, mime = '') {
    const dir = path.join(this.mediaRoot, bookId)
    fs.mkdirSync(dir, { recursive: true })
    const safe = path.basename(filename)
    const fp = path.join(dir, safe)
    fs.writeFileSync(fp, buf)
    const sha256 = createHash('sha256').update(buf).digest('hex')
    const t = now()
    const id = nid()
    this.db
      .prepare(
        `INSERT INTO media(id, book_id, filename, mime, size, sha256, created_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(book_id, filename) DO UPDATE SET mime=excluded.mime, size=excluded.size, sha256=excluded.sha256`,
      )
      .run(id, bookId, safe, mime, buf.length, sha256, t)
    return { filename: safe, url: textbookMediaUrl(bookId, safe), size: buf.length, sha256 }
  }

  listMedia(bookId: string) {
    return this.db
      .prepare('SELECT filename, mime, size, sha256 FROM media WHERE book_id = ? ORDER BY filename')
      .all(bookId)
  }

  deleteMedia(bookId: string, filename: string) {
    this.db.prepare('DELETE FROM media WHERE book_id = ? AND filename = ?').run(bookId, filename)
    const fp = path.join(this.mediaRoot, bookId, path.basename(filename))
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    return { ok: true }
  }

  searchLibrary(query: string) {
    const q = `%${query}%`
    const books = this.db
      .prepare("SELECT id, title FROM book WHERE title LIKE ? ESCAPE '\\' LIMIT 20")
      .all(q)
    const chapters = this.db
      .prepare(
        `SELECT c.id, c.book_id, c.title FROM chapter c
         JOIN book b ON b.id = c.book_id
         WHERE c.title LIKE ? ESCAPE '\\' OR c.content_json LIKE ? ESCAPE '\\' LIMIT 40`,
      )
      .all(q, q)
    return { books, chapters }
  }

  private insertFebPayloads(
    bookId: string,
    payloads: FebImportResult['chapterPayloads'],
    idMap: Map<string, string>,
  ) {
    const t = now()
    const ins = this.db.prepare(`
      INSERT INTO chapter(id, book_id, title, sort, parent_id, role, content_json, rev, updated_at, created_at)
      VALUES(?,?,?,?,?,?,?,1,?,?)
    `)
    const tx = this.db.transaction(() => {
      for (const c of payloads) {
        const newId = idMap.get(c.oldId) || nid()
        idMap.set(c.oldId, newId)
      }
      for (const c of payloads) {
        const newId = idMap.get(c.oldId)!
        const parentNew = c.parent_id ? idMap.get(c.parent_id) || null : null
        ins.run(
          newId,
          bookId,
          c.title,
          c.sort,
          parentNew,
          c.role,
          JSON.stringify(c.doc),
          t,
          t,
        )
      }
    })
    tx()
  }

  async importFeb(filePath: string, mode: 'new' | 'update' = 'new') {
    const buf = fs.readFileSync(filePath)
    return this.importFebBuffer(buf, mode)
  }

  async importFebBuffer(buf: Buffer, mode: 'new' | 'update' = 'new', targetBookId?: string) {
    const imp = await readFebBuffer(buf)
    return this.applyFebImport(imp, mode, targetBookId)
  }

  private applyFebImport(imp: FebImportResult, mode: 'new' | 'update', targetBookId?: string) {
    const existing = mode === 'update' && targetBookId
      ? (this.db.prepare('SELECT id FROM book WHERE id = ?').get(targetBookId) as { id: string } | undefined)
      : imp.bookMeta.id
        ? (this.db.prepare('SELECT id FROM book WHERE id = ?').get(imp.bookMeta.id) as { id: string } | undefined)
        : undefined
    if (mode === 'update' && targetBookId && !existing) {
      throw Object.assign(new Error('目标教材不存在'), { code: 'NOT_FOUND' })
    }
    let bookId: string
    const t = now()
    if (existing && mode === 'update') {
      bookId = existing.id
      this.db.prepare('DELETE FROM chapter WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM media WHERE book_id = ?').run(bookId)
      fs.rmSync(path.join(this.mediaRoot, bookId), { recursive: true, force: true })
      this.db
        .prepare('UPDATE book SET title = ?, updated_at = ? WHERE id = ?')
        .run(imp.bookMeta.title || '未命名', t, bookId)
    } else {
      bookId = nid()
      this.db
        .prepare('INSERT INTO book(id, title, created_at, updated_at, kind, category) VALUES(?,?,?,?,?,?)')
        .run(bookId, imp.bookMeta.title || '未命名', t, t, imp.bookMeta.kind || 'interactive', '')
    }
    const idMap = new Map<string, string>()
    const renames = new Map<string, string>()
    for (const m of imp.mediaFiles) {
      const saved = this.putMediaFromBuffer(bookId, m.filename, m.bytes)
      if (saved.filename !== m.filename) renames.set(m.filename, saved.filename)
    }
    applyMediaRenamesToChapters(imp.chapterPayloads, renames)
    this.insertFebPayloads(bookId, imp.chapterPayloads, idMap)
    return this.getBook(bookId)
  }

  private febExportInput(bookId: string, forFutureEditor = true): FebExportInput {
    const book = this.getBook(bookId)
    const chapters = this.listChaptersFlat(bookId)
    const mediaRows = this.listMedia(bookId) as Array<{ filename: string; sha256: string; size: number }>
    const media: FebExportInput['media'] = []
    for (const m of mediaRows) {
      const fp = path.join(this.mediaRoot, bookId, m.filename)
      if (!fs.existsSync(fp)) continue
      media.push({ filename: m.filename, bytes: fs.readFileSync(fp), sha256: m.sha256, size: m.size })
    }
    return {
      bookId,
      title: book.title,
      kind: book.kind,
      chapters,
      media,
      exportForFutureEditor: forFutureEditor,
    }
  }

  async exportFebToBuffer(bookId: string, forFutureEditor = true) {
    return buildFebBuffer(this.febExportInput(bookId, forFutureEditor))
  }

  async exportFeb(bookId: string, destPath: string, forFutureEditor = true) {
    await writeFebFile(this.febExportInput(bookId, forFutureEditor), destPath)
    return { path: destPath }
  }

  readMediaFile(bookId: string, filename: string) {
    const safe = path.basename(filename)
    const row = this.db
      .prepare('SELECT mime FROM media WHERE book_id = ? AND filename = ?')
      .get(bookId, safe) as { mime?: string } | undefined
    const fp = path.join(this.mediaRoot, bookId, safe)
    if (!fs.existsSync(fp)) return undefined
    return { bytes: fs.readFileSync(fp), mime: row?.mime || 'application/octet-stream', filename: safe }
  }

  listChapterPreviews(bookId: string) {
    const pages = this.listChaptersFlat(bookId).filter((row) => row.role === 'page')
    const out: Record<string, { snippet: string; thumbName?: string }> = {}
    const mediaRe = /^(?:textbook|editor-local):\/\/[^/]+\/media\/(.+)$/
    for (const page of pages) {
      let snippet = ''
      let thumbName: string | undefined
      try {
        const doc = parseJson<{ content?: unknown[] }>(page.content_json, EMPTY_DOC)
        const walk = (nodes: unknown[]): void => {
          for (const n of nodes) {
            if (!n || typeof n !== 'object') continue
            const node = n as Record<string, unknown>
            if (thumbName === undefined && node.type === 'image') {
              const src = (node.attrs as { src?: string } | undefined)?.src
              if (typeof src === 'string') {
                const match = mediaRe.exec(src)
                if (match) thumbName = decodeURIComponent(match[1]!)
                else if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/api/')) {
                  thumbName = src
                }
              }
            }
            if (snippet === '' && node.type === 'text' && typeof node.text === 'string' && node.text.trim()) {
              snippet = node.text.trim().slice(0, 120)
            }
            if (Array.isArray(node.content)) walk(node.content)
            if (snippet && thumbName) return
          }
        }
        walk(doc.content || [])
      } catch {
        snippet = ''
      }
      out[page.id] = { snippet, ...(thumbName === undefined ? {} : { thumbName }) }
    }
    return out
  }

  /**
   * Everything a writing request needs, in one call: the book, its outline,
   * the open chapter, the user's selection, and the enabled module catalog.
   * @param opts - book or chapter identity plus the selected text and range.
   * @returns the writing context.
   */
  writingContext(
    opts: { bookId?: string; chapterId?: string; selection?: { text?: string; from?: number; to?: number } } = {},
  ) {
    const chapter = opts.chapterId ? this.getChapter(opts.chapterId) : undefined
    const bookId = opts.bookId ?? chapter?.book_id
    if (!bookId) throw Object.assign(new Error('需要 bookId 或 chapterId'), { code: 'NOT_FOUND' })
    const book = this.getBook(bookId)
    return {
      book: { id: book.id, title: book.title, category: book.category, kind: book.kind },
      outline: this.listChaptersFlat(bookId).map((node) => ({
        id: node.id,
        title: node.title,
        role: node.role,
        parent_id: node.parent_id,
        sort: node.sort,
        rev: node.rev,
      })),
      chapter: chapter === undefined ? undefined : {
        id: chapter.id,
        title: chapter.title,
        role: chapter.role,
        rev: chapter.rev,
        doc: parseJson(chapter.content_json, EMPTY_DOC),
      },
      selection: opts.selection,
      modules: this.listModuleCatalog(),
    }
  }

  /**
   * List proposed edits, newest first.
   * @param chapterId - only this chapter's proposals; omitted lists the latest across the library.
   * @returns the proposal rows with their document parsed.
   */
  listProposals(chapterId?: string) {
    const rows = (chapterId
      ? this.db.prepare('SELECT * FROM proposal WHERE chapter_id = ? ORDER BY created_at DESC').all(chapterId)
      : this.db.prepare('SELECT * FROM proposal ORDER BY created_at DESC LIMIT 50').all()) as unknown as ProposalRow[]
    return rows.map((row) => ({ ...row, doc: parseJson<unknown>(row.doc_json, EMPTY_DOC) }))
  }

  /**
   * Read one proposal.
   * @param id - proposal id.
   * @returns the row with its document parsed.
   */
  getProposal(id: string) {
    const row = this.db.prepare('SELECT * FROM proposal WHERE id = ?').get(id) as ProposalRow | undefined
    if (!row) throw Object.assign(new Error('建议不存在'), { code: 'NOT_FOUND' })
    return { ...row, doc: parseJson<unknown>(row.doc_json, EMPTY_DOC) }
  }

  /**
   * Record an edit an agent proposes for a page chapter. Nothing is written to
   * the chapter until {@link acceptProposal}, so a person can review it first.
   * @param input - chapter, proposed document, the revision it was written against, a note, and the author.
   * @returns the stored proposal.
   */
  createProposal(input: { chapterId: string; doc: unknown; baseRev?: number; note?: string; source?: string }) {
    const chapter = this.getChapter(input.chapterId)
    if (chapter.role !== 'page') {
      throw Object.assign(new Error('仅页面节点可编辑正文'), { code: 'NOT_EDITABLE' })
    }
    const baseRev = input.baseRev ?? Number(chapter.rev)
    const id = nid()
    const t = now()
    this.db
      .prepare(
        `INSERT INTO proposal(id, book_id, chapter_id, base_rev, doc_json, note, source, status, before_json, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, chapter.book_id, chapter.id, baseRev, JSON.stringify(input.doc), input.note ?? '', input.source ?? 'agent', 'pending', chapter.content_json, t, t)
    return this.getProposal(id)
  }

  /**
   * Apply a proposal. The chapter must still be at the revision the proposal
   * was written against; otherwise nothing is written.
   * @param id - proposal id.
   * @returns the settled proposal and the saved chapter.
   */
  acceptProposal(id: string) {
    const proposal = this.getProposal(id)
    if (proposal.status !== 'pending') {
      throw Object.assign(new Error('建议已处理'), { code: 'PROPOSAL_CLOSED' })
    }
    const chapter = this.getChapter(proposal.chapter_id)
    const snapshot = proposal.before_json ?? ''
    const currentBody = chapter.content_json ?? ''
    if (snapshot !== currentBody) {
      throw Object.assign(
        new Error(
          `章节内容已变更（当前 rev=${chapter.rev}，建议基于 rev=${proposal.base_rev}），请拒绝过期建议或重新生成`,
        ),
        { code: 'REV_CONFLICT' },
      )
    }
    const saved = this.saveChapterJson(
      chapter.id,
      parseJson<unknown>(proposal.doc_json, EMPTY_DOC),
      { rev: chapter.rev },
    )
    this.db
      .prepare('UPDATE proposal SET status = ?, applied_rev = ?, updated_at = ? WHERE id = ?')
      .run('accepted', saved.rev, now(), id)
    return { proposal: this.getProposal(id), chapter: saved }
  }

  /**
   * Undo an accepted proposal: write its snapshot back. The chapter must still
   * be at the revision the accept produced, so a later edit is never lost.
   * @param id - proposal id.
   * @returns the settled proposal and the restored chapter.
   */
  restoreProposal(id: string) {
    const proposal = this.getProposal(id)
    if (proposal.status !== 'accepted' || proposal.before_json === null) {
      throw Object.assign(new Error('只有已接受且带快照的建议可以撤销'), { code: 'PROPOSAL_CLOSED' })
    }
    const chapter = this.getChapter(proposal.chapter_id)
    const appliedRev =
      proposal.applied_rev != null
        ? Number(proposal.applied_rev)
        : Number(proposal.base_rev) + 1
    if (Number(chapter.rev) !== appliedRev) {
      throw Object.assign(
        new Error(`章节版本冲突：当前 rev=${chapter.rev}，撤销要求 rev=${appliedRev}`),
        { code: 'REV_CONFLICT' },
      )
    }
    const saved = this.saveChapterJson(chapter.id, parseJson<unknown>(proposal.before_json, EMPTY_DOC), { rev: appliedRev })
    this.db.prepare('UPDATE proposal SET status = ?, updated_at = ? WHERE id = ?').run('reverted', now(), id)
    return { proposal: this.getProposal(id), chapter: saved }
  }

  /**
   * Drop a proposal without touching the chapter.
   * @param id - proposal id.
   * @returns the settled proposal.
   */
  rejectProposal(id: string) {
    const proposal = this.getProposal(id)
    if (proposal.status !== 'pending') {
      throw Object.assign(new Error('建议已处理'), { code: 'PROPOSAL_CLOSED' })
    }
    this.db.prepare('UPDATE proposal SET status = ?, updated_at = ? WHERE id = ?').run('rejected', now(), id)
    return this.getProposal(id)
  }

  importJson(json: unknown, title = '未命名') {
    const book = this.createBook(title)
    const obj = json as { chapters?: Array<{ title?: string; content?: unknown; doc?: unknown }> }
    if (Array.isArray(obj.chapters)) {
      for (const [i, ch] of obj.chapters.entries()) {
        let node = this.listChaptersFlat(book.id)[i]
        if (!node) {
          node = this.addChapter(book.id, ch.title || '未命名', undefined, { role: 'page' })
        } else if (ch.title) {
          this.renameChapter(node.id, ch.title)
        }
        const content = ch.content ?? ch.doc ?? EMPTY_DOC
        this.saveChapterJson(node.id, content)
      }
    }
    return this.getBook(book.id)
  }

  setFocus(bookId?: string, chapterId?: string) {
    this.workshopFocus = { bookId, chapterId }
    return { ...this.workshopFocus }
  }

  getWorkshopState() {
    return {
      focus: { ...this.workshopFocus },
    }
  }
}
