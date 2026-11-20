import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import {
  FEB_APP_HARNESS,
  FEB_FORMAT,
  FEB_SCHEMA_VERSION,
  URL_EDITOR_LOCAL,
  URL_TEXTBOOK,
} from './constants.js'
import { EMPTY_DOC, normalizeRole, parseJson, type ChapterRole } from './doc.js'
import { rewriteDocMediaUrls, rewriteMediaBasenames } from './media-rewrite.js'

export type FebChapterMeta = {
  id: string
  title: string
  sort: number
  parent_id?: string | null
  role?: ChapterRole
}

export type FebBookMeta = {
  title?: string
  id?: string
  kind?: string
  chapters?: FebChapterMeta[]
}

export type FebManifest = {
  format: string
  schemaVersion: number
  exportedAt: string
  app: string
}

export type FebExportInput = {
  bookId: string
  title: string
  kind?: string
  chapters: Array<{
    id: string
    title: string
    sort: number
    parent_id: string | null
    role: ChapterRole
    content_json: string
  }>
  media: Array<{ filename: string; bytes: Buffer; sha256?: string; size?: number }>
  /** feb on disk: use editor-local URLs in chapter JSON */
  exportForFutureEditor?: boolean
}

export async function buildFebBuffer(input: FebExportInput): Promise<Buffer> {
  const zip = new JSZip()
  const targetProto = input.exportForFutureEditor ? 'editor-local' : 'textbook'
  const chaptersOut: FebChapterMeta[] = []
  for (const c of input.chapters) {
    const role = normalizeRole(c.role)
    chaptersOut.push({
      id: c.id,
      title: c.title,
      sort: c.sort,
      parent_id: c.parent_id,
      role,
    })
    if (role === 'page') {
      const doc = parseJson(c.content_json, EMPTY_DOC)
      const rewritten = rewriteDocMediaUrls(doc, {
        fromBookId: input.bookId,
        toBookId: input.bookId,
        toProtocol: targetProto,
        fromProtocols: ['textbook', 'editor-local'],
      })
      zip.file(`chapters/${c.id}.json`, JSON.stringify(rewritten, null, 2))
    }
  }
  const manifest: FebManifest = {
    format: FEB_FORMAT,
    schemaVersion: FEB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: input.exportForFutureEditor ? 'FutureEditor' : FEB_APP_HARNESS,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file(
    'book.json',
    JSON.stringify(
      {
        title: input.title,
        id: input.bookId,
        kind: input.kind || 'interactive',
        chapters: chaptersOut,
      },
      null,
      2,
    ),
  )
  const mediaManifest: Array<{ filename: string; sha256: string; size: number }> = []
  for (const m of input.media) {
    zip.file(`media/${m.filename}`, m.bytes)
    mediaManifest.push({
      filename: m.filename,
      sha256: m.sha256 || '',
      size: m.size ?? m.bytes.length,
    })
  }
  zip.file('media/manifest.json', JSON.stringify(mediaManifest, null, 2))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function writeFebFile(input: FebExportInput, destPath: string): Promise<string> {
  const buf = await buildFebBuffer(input)
  fs.mkdirSync(path.dirname(path.resolve(destPath)), { recursive: true })
  fs.writeFileSync(destPath, buf)
  return destPath
}

export type FebImportResult = {
  bookMeta: FebBookMeta
  sourceBookId: string
  chapterPayloads: Array<{
    oldId: string
    title: string
    sort: number
    parent_id: string | null
    role: ChapterRole
    doc: unknown
  }>
  mediaFiles: Array<{ filename: string; bytes: Buffer }>
}

export async function readFebFile(filePath: string): Promise<FebImportResult> {
  const buf = fs.readFileSync(filePath)
  return readFebBuffer(buf)
}

export async function readFebBuffer(buf: Buffer): Promise<FebImportResult> {
  const zip = await JSZip.loadAsync(buf)
  const manifestRaw = await zip.file('manifest.json')?.async('string')
  const bookRaw = await zip.file('book.json')?.async('string')
  if (!bookRaw) throw new Error('无效的 .feb（缺少 book.json）')
  const manifest = parseJson<{ format?: string; schemaVersion?: number }>(manifestRaw || '{}', {})
  if (manifest.format && manifest.format !== FEB_FORMAT) {
    throw new Error('文件格式不是 feb')
  }
  const febVer = Number(manifest.schemaVersion || 1)
  if (febVer > FEB_SCHEMA_VERSION) {
    throw new Error(`此 .feb 版本（${febVer}）高于支持的上限（${FEB_SCHEMA_VERSION}）`)
  }
  const bookMeta = parseJson<FebBookMeta>(bookRaw, {})
  const sourceBookId = String(bookMeta.id || 'feb-import')
  const order = bookMeta.chapters || []
  const chapterPayloads: FebImportResult['chapterPayloads'] = []
  if (order.length) {
    for (const meta of order) {
      const role = normalizeRole(meta.role)
      const raw =
        role === 'page' ? await zip.file(`chapters/${meta.id}.json`)?.async('string') : undefined
      let doc: unknown = role === 'page' ? parseJson(raw || '{}', EMPTY_DOC) : { type: 'doc', content: [] }
      doc = rewriteDocMediaUrls(doc, {
        fromBookId: sourceBookId,
        toBookId: sourceBookId,
        toProtocol: 'textbook',
        fromProtocols: ['textbook', 'editor-local'],
      })
      // normalize editor-local leftovers to textbook for same placeholder id (re-imported below)
      doc = rewriteDocMediaUrls(doc, {
        fromBookId: sourceBookId,
        toBookId: sourceBookId,
        toProtocol: 'textbook',
        fromProtocols: ['editor-local'],
      })
      chapterPayloads.push({
        oldId: meta.id,
        title: meta.title || '未命名',
        sort: Number(meta.sort) || 0,
        parent_id: meta.parent_id ?? null,
        role,
        doc,
      })
    }
  } else {
    const chapterFiles = Object.keys(zip.files).filter((k) => k.startsWith('chapters/') && k.endsWith('.json'))
    let i = 0
    for (const f of chapterFiles) {
      const raw = await zip.file(f)?.async('string')
      let doc: unknown = parseJson(raw || '{}', EMPTY_DOC)
      doc = rewriteDocMediaUrls(doc, {
        fromBookId: sourceBookId,
        toBookId: sourceBookId,
        toProtocol: 'textbook',
        fromProtocols: ['textbook', 'editor-local'],
      })
      chapterPayloads.push({
        oldId: path.basename(f, '.json'),
        title: path.basename(f, '.json'),
        sort: i++,
        parent_id: null,
        role: 'page',
        doc,
      })
    }
  }
  if (!chapterPayloads.length) {
    chapterPayloads.push({
      oldId: 'default',
      title: '未命名',
      sort: 0,
      parent_id: null,
      role: 'page',
      doc: { ...EMPTY_DOC },
    })
  }
  const mediaFiles: FebImportResult['mediaFiles'] = []
  const mediaKeys = Object.keys(zip.files).filter(
    (k) => k.startsWith('media/') && !k.endsWith('/') && !k.endsWith('manifest.json'),
  )
  for (const f of mediaKeys) {
    const data = await zip.file(f)?.async('nodebuffer')
    if (!data) continue
    mediaFiles.push({ filename: path.basename(f), bytes: data })
  }
  return { bookMeta, sourceBookId, chapterPayloads, mediaFiles }
}

/** After media rename map applied */
export function applyMediaRenamesToChapters(
  payloads: FebImportResult['chapterPayloads'],
  renames: Map<string, string>,
) {
  for (const c of payloads) {
    if (c.role === 'page') c.doc = rewriteMediaBasenames(c.doc, renames)
  }
}

export function textbookMediaUrl(bookId: string, filename: string) {
  return `${URL_TEXTBOOK}${bookId}/media/${encodeURIComponent(filename)}`
}

export function editorLocalMediaUrl(bookId: string, filename: string) {
  return `${URL_EDITOR_LOCAL}${bookId}/media/${encodeURIComponent(filename)}`
}