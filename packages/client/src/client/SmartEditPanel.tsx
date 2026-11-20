/**
 * The smart-edit main panel.
 *
 * State is panel-local: the book catalog, the selected book's chapter rows,
 * the selected chapter's document, and a small status line. Every network call
 * targets the host half under `/api/textbook/*`; the panel never touches a
 * host-side service object.
 *
 * A page chapter opens in the rich-text tab (Tiptap). Chapters whose document
 * uses marks the editor cannot represent, or whose JSON is unreadable, open in
 * the JSON tab instead, so saving can never silently drop content.
 *
 * @module harness-client-smart-edit/client/SmartEditPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  acceptProposal,
  createBook,
  createChapter,
  deleteBook,
  deleteChapter,
  duplicateChapter,
  errorMessage,
  exportFebBook,
  fetchChapterPreviews,
  fetchWorkshopState,
  importFebFile,
  moveChapter,
  fetchBook,
  fetchBooks,
  fetchChapter,
  fetchModules,
  fetchProposals,
  fetchWritingContext,
  quickEdit,
  renameChapter,
  rejectProposal,
  updateBook,
  updateModuleBlock,
  writeSection,
  restoreProposal,
  saveChapter,
  TextbookError,
  type Book,
  type ChapterDetail,
  type ChapterSummary,
  type ModuleInfo,
  type Proposal,
  type QuickEditMode,
} from './api.js'
import { MODULE_CONFIG_SAVE_EVENT } from './ModuleBlockCard.js'
import { mediaApiUrl, rewriteDocMedia } from './media-urls.js'
import { readDoc, type DocScan } from './doc-model.js'
import { knownMarkNames } from './tiptap.js'
import { RichTextEditor } from './RichTextEditor.js'
import { fallbackTranslate, type SmartEditKey } from './locales.js'
import { BookLibraryPage } from './BookLibraryPage.js'
import { ChapterTreeSidebar } from './ChapterTreeSidebar.js'
import {
  buildChapterTree,
  findTreeNode,
  getAddChapterOptions,
  type ChapterRole,
  type TreeChapter,
} from './chapterTree.js'
import { ensureWorkshopStyles } from './workshopStyles.js'

/** Translate signature handed to the panel by its slot. */
type Translate = (key: SmartEditKey, params?: Record<string, string>) => string

/** Props supplied by the slot renderer. */
export interface SmartEditPanelProps {
  /** Namespace-bound translator; absent only when rendered standalone. */
  readonly t?: Translate
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

type Tab = 'rich' | 'json'
type Screen = 'library' | 'workshop'

/** Pretty-print a document for the JSON tab. */
function formatDoc(doc: unknown): string {
  try {
    return JSON.stringify(doc, null, 2)
  } catch {
    return '{\n  "type": "doc",\n  "content": []\n}'
  }
}

/** Human label of a chapter role. */
function roleLabel(role: string, tr: Translate): string {
  if (role === 'part') return tr('rolePart')
  if (role === 'chapter') return tr('roleChapter')
  return tr('rolePage')
}

/** Render the inline status line of the editor. */
function statusText(status: Status, tr: Translate): string {
  switch (status.kind) {
    case 'saved':
      return tr('saved')
    case 'invalid':
      return tr('invalidJson')
    case 'conflict':
      return `${tr('conflict')}: ${status.message}`
    case 'error':
      return `${tr('error')}: ${status.message}`
    default:
      return ''
  }
}

/** Status line color class. */
function statusClass(status: Status): string {
  if (status.kind === 'saved') return 'editor-status ok'
  if (status.kind === 'conflict') return 'editor-status warn'
  if (status.kind === 'error' || status.kind === 'invalid') return 'editor-status err'
  return 'editor-status'
}

/**
 * Render the smart-edit panel.
 * @param props - slot props; `t` is the locale seat.
 * @returns the panel.
 */
export function SmartEditPanel({ t }: SmartEditPanelProps): ReactNode {
  const tr: Translate = t ?? fallbackTranslate

  useEffect(() => {
    ensureWorkshopStyles()
  }, [])

  const [books, setBooks] = useState<Book[]>([])
  const [booksLoading, setBooksLoading] = useState(true)
  const [bookId, setBookId] = useState('')
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [chapterId, setChapterId] = useState('')
  const [chapter, setChapter] = useState<ChapterDetail | null>(null)
  const [chapterLoading, setChapterLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('rich')
  const [richScan, setRichScan] = useState<DocScan | undefined>(undefined)
  const [richEpoch, setRichEpoch] = useState(0)
  const [jsonDraft, setJsonDraft] = useState('')
  const richDocRef = useRef<unknown>(undefined)
  const dirtyRef = useRef(false)
  const [rev, setRev] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [unsupportedMarks, setUnsupportedMarks] = useState<string[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [acceptedProposals, setAcceptedProposals] = useState<Proposal[]>([])
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [task, setTask] = useState<{ title: string; prompt: string; kind: 'section' | 'continue' | 'book' } | null>(null)
  const [treePreviews, setTreePreviews] = useState<Record<string, { thumb?: string; snippet?: string }>>({})
  const febInputRef = useRef<HTMLInputElement | null>(null)
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskRunning, setTaskRunning] = useState(false)
  const [taskProgress, setTaskProgress] = useState('')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [screen, setScreen] = useState<Screen>('library')
  const [libraryQuery, setLibraryQuery] = useState('')

  const chapterTree = useMemo(() => buildChapterTree(chapters), [chapters])
  const selectedTreeNode = useMemo(
    () => (selectedId ? findTreeNode(chapterTree, selectedId) : undefined),
    [chapterTree, selectedId],
  )
  const addParentNode = useMemo((): TreeChapter | null => {
    if (!selectedTreeNode) return null
    if (selectedTreeNode.role === 'page') {
      return selectedTreeNode.parentId
        ? findTreeNode(chapterTree, selectedTreeNode.parentId) ?? null
        : null
    }
    return selectedTreeNode
  }, [chapterTree, selectedTreeNode])
  const addOptions = useMemo(
    () => getAddChapterOptions(addParentNode, (key) => tr(key as SmartEditKey)),
    [addParentNode, tr],
  )

  const currentBook = useMemo(() => books.find((book) => book.id === bookId), [books, bookId])
  const selectedRow = useMemo(
    () => chapters.find((item) => item.id === selectedId),
    [chapters, selectedId],
  )
  const pageCount = useMemo(
    () => chapters.filter((item) => item.role === 'page').length,
    [chapters],
  )
  const folderSelected = Boolean(selectedRow && selectedRow.role !== 'page')

  /** Read the library and keep the current book when it still exists. */
  const loadBooks = useCallback(async () => {
    setBooksLoading(true)
    try {
      const next = await fetchBooks('')
      setBooks(next)
      setBookId((previous) => (
        previous && next.some((book) => book.id === previous) ? previous : ''
      ))
    } catch (error) {
      setBooks([])
      setBookId('')
      setStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setBooksLoading(false)
    }
  }, [])

  /** Put one chapter payload on screen and re-derive what the editor supports. */
  const applyChapter = useCallback((detail: ChapterDetail) => {
    const { doc: rawDoc, scan, marks } = readDoc(detail.content_json)
    const doc = rewriteDocMedia(rawDoc, detail.book_id, 'display')
    const known = knownMarkNames()
    const unknown = [...marks].filter((mark) => !known.has(mark))
    setChapter(detail)
    setRev(Number(detail.rev) || 1)
    richDocRef.current = doc
    dirtyRef.current = false
    setRichScan(scan)
    setRichEpoch((epoch) => epoch + 1)
    setJsonDraft(formatDoc(doc))
    setUnsupportedMarks(unknown)
    setDirty(false)
    setTab(scan.valid && unknown.length === 0 ? 'rich' : 'json')
  }, [])

  useEffect(() => {
    void loadBooks()
  }, [loadBooks])

  /** 跟随 Agent `textbook__focus_chapter` 切换当前书/章（未保存修改时不抢焦点）。 */
  useEffect(() => {
    if (typeof globalThis.setInterval !== 'function') return
    const timer = globalThis.setInterval(() => {
      if (globalThis.document?.hidden || dirtyRef.current) return
      void fetchWorkshopState().then((state) => {
        const focusBook = state.focus.bookId?.trim()
        const focusChapter = state.focus.chapterId?.trim()
        if (focusBook && focusBook !== bookId) {
          setScreen('workshop')
          setBookId(focusBook)
          return
        }
        if (focusBook) setScreen('workshop')
        if (focusChapter && focusChapter !== chapterId) {
          setSelectedId(focusChapter)
          setChapterId(focusChapter)
        }
      }).catch(() => {})
    }, 2000)
    return () => { globalThis.clearInterval(timer) }
  }, [bookId, chapterId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await fetchModules()
        if (!cancelled) setModules(next)
      } catch {
        if (!cancelled) setModules([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (screen !== 'workshop' || !bookId) {
      setChapters([])
      setChaptersLoading(false)
      setSelectedId('')
      setChapterId('')
      setChapter(null)
      setChapterLoading(false)
      setDirty(false)
      return
    }
    let cancelled = false
    setChaptersLoading(true)
    setChapters([])
    setSelectedId('')
    setChapterId('')
    setChapter(null)
    setChapterLoading(false)
    setDirty(false)
    setStatus({ kind: 'idle' })
    void (async () => {
      try {
        const detail = await fetchBook(bookId)
        if (!cancelled) setChapters(detail.chapters ?? [])
      } catch (error) {
        if (!cancelled) setStatus({ kind: 'error', message: errorMessage(error) })
      } finally {
        if (!cancelled) setChaptersLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [bookId, screen])

  const reloadTreePreviews = useCallback(async (id: string) => {
    if (!id) {
      setTreePreviews({})
      return
    }
    try {
      const raw = await fetchChapterPreviews(id)
      const next: Record<string, { thumb?: string; snippet?: string }> = {}
      for (const [pageId, preview] of Object.entries(raw)) {
        const snippet = preview.snippet?.trim()
        let thumb: string | undefined
        if (preview.thumbName) {
          const name = preview.thumbName
          thumb = name.startsWith('http://') || name.startsWith('https://') || name.startsWith('/')
            ? name
            : mediaApiUrl(id, name)
        }
        next[pageId] = {
          ...(snippet ? { snippet } : {}),
          ...(thumb ? { thumb } : {}),
        }
      }
      setTreePreviews(next)
    } catch {
      setTreePreviews({})
    }
  }, [])

  useEffect(() => {
    void reloadTreePreviews(bookId)
  }, [bookId, chapters, reloadTreePreviews])

  /** Re-read the pending suggestions of the open chapter. */
  const reloadProposals = useCallback(async (id: string) => {
    try {
      const next = await fetchProposals(id)
      setProposals(next.filter((proposal) => proposal.status === 'pending'))
      setAcceptedProposals(next.filter((proposal) => proposal.status === 'accepted').slice(0, 5))
      if (!dirtyRef.current) {
        const detail = await fetchChapter(id)
        setRev(Number(detail.rev) || 1)
        setChapters((previous) => previous.map((item) => (
          item.id === detail.id
            ? { ...item, rev: detail.rev, updated_at: detail.updated_at }
            : item
        )))
      }
    } catch {
      setProposals([])
    }
  }, [])

  useEffect(() => {
    if (!chapterId) {
      setProposals([])
      setAcceptedProposals([])
      return
    }
    void reloadProposals(chapterId)
    // Agent proposals land asynchronously; poll while the panel is open.
    const timer = globalThis.setInterval(() => {
      if (!globalThis.document.hidden) void reloadProposals(chapterId)
    }, 5000)
    return () => { globalThis.clearInterval(timer) }
  }, [chapterId, reloadProposals])

  useEffect(() => {
    if (!chapterId) return
    let cancelled = false
    setChapterLoading(true)
    setStatus({ kind: 'idle' })
    void (async () => {
      try {
        const detail = await fetchChapter(chapterId)
        if (!cancelled) applyChapter(detail)
      } catch (error) {
        if (!cancelled) {
          setChapter(null)
          richDocRef.current = undefined
          setJsonDraft('')
          dirtyRef.current = false
          setDirty(false)
          setStatus({ kind: 'error', message: errorMessage(error) })
        }
      } finally {
        if (!cancelled) setChapterLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [chapterId, applyChapter])

  useEffect(() => {
    const onModuleSave = (event: Event): void => {
      const detail = (event as CustomEvent<{ blockId?: string; config?: Record<string, unknown> }>).detail
      if (!chapter || !detail?.blockId || !detail.config) return
      void (async () => {
        setStatus({ kind: 'idle' })
        try {
          const saved = await updateModuleBlock(chapter.id, detail.blockId!, detail.config!, rev)
          applyChapter(saved)
          setRev(Number(saved.rev) || 1)
          setStatus({ kind: 'saved' })
        } catch (error) {
          setStatus({ kind: 'error', message: errorMessage(error) })
        }
      })()
    }
    const eventTarget = globalThis.window ?? globalThis
    if (typeof eventTarget.addEventListener !== 'function') return
    eventTarget.addEventListener(MODULE_CONFIG_SAVE_EVENT, onModuleSave)
    return () => eventTarget.removeEventListener(MODULE_CONFIG_SAVE_EVENT, onModuleSave)
  }, [chapter, rev, applyChapter])

  const setDocument = useCallback((next: unknown) => {
    richDocRef.current = next
    if (!dirtyRef.current) {
      dirtyRef.current = true
      setDirty(true)
    }
  }, [])

  /** Send one selected passage to the host's writing model. */
  const handleQuickEdit = useCallback(
    async (mode: QuickEditMode, input: { text: string; from: number; to: number }): Promise<string> =>
      await quickEdit(mode, input.text, chapter === null ? {} : { chapterId: chapter.id, title: chapter.title }),
    [chapter],
  )

  /** Apply one agent proposal and reload the chapter it changed. */
  const onAcceptProposal = async (proposal: Proposal): Promise<void> => {
    if (chapter === null) return
    try {
      const saved = await acceptProposal(proposal.id)
      applyChapter(saved.chapter)
      await reloadProposals(chapter.id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      if (error instanceof TextbookError && error.status === 409) {
        try {
          applyChapter(await fetchChapter(chapter.id))
        } catch {
          // The conflict status below already tells the person what happened.
        }
        setStatus({ kind: 'conflict', message: errorMessage(error) })
      } else {
        setStatus({ kind: 'error', message: errorMessage(error) })
      }
      await reloadProposals(chapter.id)
    }
  }

  /** Drop one agent proposal without touching the chapter. */
  const onRejectProposal = async (proposal: Proposal): Promise<void> => {
    try {
      await rejectProposal(proposal.id)
      if (chapter !== null) await reloadProposals(chapter.id)
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  /** Flatten a Tiptap document to plain text for the task prompt. */
  const docText = (doc: unknown): string => {
    const lines: string[] = []
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return
      const record = node as { type?: unknown; text?: unknown; content?: unknown }
      if (typeof record.text === 'string') lines.push(record.text)
      if (Array.isArray(record.content)) record.content.forEach(walk)
    }
    walk(doc)
    return lines.join('').trim()
  }

  /** Build the writing task prompt from the live writing context. */
  const openTask = async (kind: 'section' | 'continue' | 'book'): Promise<void> => {
    if (chapter === null && kind !== 'book') return
    setTaskBusy(true)
    try {
      const context = await fetchWritingContext(kind === 'book' ? { bookId } : { chapterId: chapter?.id ?? undefined })
      const outline = context.outline
        .map((node) => `${node.parent_id === null ? '' : '  '}[${node.role}] ${node.title}（rev ${node.rev}）`)
        .join('\n')
      const body = kind === 'book' ? '' : docText(context.chapter?.doc)
      const instruction = kind === 'book'
        ? '按大纲顺序逐节写作：每个页面章节提交一条 propose_edit，baseRev 用该节自己的当前 rev；不要一次改整本书的 doc。'
        : kind === 'continue'
          ? '续写本节：读完现有正文后接着写，保持语气、术语和结构一致，只提交新增部分的完整章节 doc。'
          : '补写本节：按标题和大纲把这一节写完整，保留已有的互动模块块。'
      const prompt = [
        '你是这本互动教材的写作助手（Skill: smart-edit）。',
        `书：《${context.book.title}》`,
        kind === 'book' ? '' : `当前章：${chapter?.title ?? ''}（rev ${chapter?.rev ?? 0}）`,
        '',
        '大纲：',
        outline,
        body === '' ? '' : `\n当前正文：\n${body.slice(0, 4000)}`,
        '',
        `任务：${instruction}`,
        '',
        '约束：',
        '1. 先调用 textbook__writing_context 确认上下文（bookId/chapterId）。',
        '2. 用 textbook__propose_edit 提交建议，baseRev 用章节当前 rev；不要调用 textbook__save_chapter_json 直接写入。',
        '3. 保留已有的互动模块块（examQuestion 等）和它们的 config。',
        '4. 正文用 Tiptap doc JSON，公式用 $...$。',
      ].filter((line) => line !== '').join('\n')
      setTask({
        title: kind === 'book' ? '按大纲写整本' : kind === 'continue' ? '续写本节' : 'AI 写这一节',
        prompt,
        kind,
      })
      setTaskProgress('')
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setTaskBusy(false)
    }
  }

  /** Run the task card now: the host writes and leaves proposals. */
  const runTask = async (): Promise<void> => {
    if (task === null || taskRunning) return
    setTaskRunning(true)
    try {
      if (task.kind === 'book') {
        const pages = chapters.filter((item) => item.role === 'page')
        if (pages.length === 0) {
          setTaskProgress('这本书还没有页面章节')
          return
        }
        let done = 0
        for (const page of pages) {
          done += 1
          setTaskProgress(`正在写 ${done}/${pages.length}：${page.title}`)
          await writeSection(page.id, 'section')
        }
        setTaskProgress(`已提交 ${pages.length} 条建议，见顶部待审列表`)
      } else if (chapter !== null) {
        setTaskProgress('模型生成中…')
        await writeSection(chapter.id, task.kind === 'continue' ? 'continue' : 'section')
        setTaskProgress('已提交建议，见顶部待审列表')
      }
      if (chapter !== null) await reloadProposals(chapter.id)
    } catch (error) {
      setTaskProgress(errorMessage(error))
      setStatus({ kind: 'error', message: errorMessage(error) })
    } finally {
      setTaskRunning(false)
    }
  }

  /** Copy the task card to the clipboard; the chat composer is the handoff. */
  const copyTask = async (): Promise<void> => {
    if (task === null) return
    try {
      await navigator.clipboard.writeText(task.prompt)
      setStatus({ kind: 'saved' })
    } catch {
      setStatus({ kind: 'error', message: '复制失败，请手动选择文本' })
    }
  }

  /** Apply every pending proposal in order. */
  const acceptAll = async (): Promise<void> => {
    for (const proposal of proposals) await onAcceptProposal(proposal)
  }

  /** Reject every pending proposal. */
  const rejectAll = async (): Promise<void> => {
    for (const proposal of proposals) await onRejectProposal(proposal)
  }

  /** Undo one accepted proposal. */
  const onRestoreProposal = async (proposal: Proposal): Promise<void> => {
    try {
      const restored = await restoreProposal(proposal.id)
      applyChapter(restored.chapter)
      if (chapter !== null) await reloadProposals(chapter.id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({
        kind: error instanceof TextbookError && error.status === 409 ? 'conflict' : 'error',
        message: errorMessage(error),
      })
      if (chapter !== null) await reloadProposals(chapter.id)
    }
  }

  const onSave = async (): Promise<void> => {
    if (!chapter || saving) return
    let content: unknown
    if (tab === 'rich') {
      content = richDocRef.current
    } else {
      try {
        content = JSON.parse(jsonDraft) as unknown
      } catch {
        setStatus({ kind: 'invalid' })
        return
      }
    }
    setSaving(true)
    setStatus({ kind: 'idle' })
    try {
      const toSave = rewriteDocMedia(content, chapter.book_id, 'save')
      const saved = await saveChapter(chapter.id, toSave, rev)
      applyChapter(saved)
      setChapters((previous) => previous.map((item) => (
        item.id === saved.id ? { ...item, rev: saved.rev, updated_at: saved.updated_at } : item
      )))
      void reloadTreePreviews(chapter.book_id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      if (error instanceof TextbookError && error.status === 409) {
        try {
          const latest = await fetchChapter(chapter.id)
          applyChapter(latest)
          setStatus({ kind: 'conflict', message: errorMessage(error) })
        } catch (reloadError) {
          setStatus({ kind: 'error', message: `${errorMessage(error)}；${errorMessage(reloadError)}` })
        }
      } else {
        setStatus({ kind: 'error', message: errorMessage(error) })
      }
    } finally {
      setSaving(false)
    }
  }

  const canEdit = chapter?.role === 'page'
  const richAllowed = useMemo(
    () => unsupportedMarks.length === 0 && richDocRef.current !== undefined && richScan !== undefined,
    [unsupportedMarks, richScan],
  )
  const activeTab: Tab = richAllowed || tab === 'json' ? tab : 'json'

  const switchTab = (next: Tab): void => {
    if (next === 'rich' && activeTab === 'json') {
      let parsed: unknown
      try {
        parsed = JSON.parse(jsonDraft) as unknown
      } catch {
        setStatus({ kind: 'invalid' })
        return
      }
      richDocRef.current = parsed
      setRichScan(readDoc(parsed).scan)
      setRichEpoch((epoch) => epoch + 1)
    }
    if (next === 'json') setJsonDraft(formatDoc(richDocRef.current))
    setTab(next)
  }

  const confirmDiscard = (): boolean =>
    !dirty || globalThis.confirm?.(tr('discardChanges')) === true

  const clearOpenChapter = (): void => {
    setChapterId('')
    setChapter(null)
    richDocRef.current = undefined
    setJsonDraft('')
    dirtyRef.current = false
    setDirty(false)
    setProposals([])
    setAcceptedProposals([])
  }

  const openWorkshop = useCallback((id: string) => {
    if (screen === 'workshop' && dirty && !confirmDiscard()) return
    setBookId(id)
    setScreen('workshop')
    setSelectedId('')
    setChapterId('')
    clearOpenChapter()
    setStatus({ kind: 'idle' })
  }, [screen, dirty])

  const backToLibrary = useCallback(() => {
    if (!confirmDiscard()) return
    setScreen('library')
    setBookId('')
    setChapters([])
    setSelectedId('')
    clearOpenChapter()
    setStatus({ kind: 'idle' })
  }, [dirty])

  const addChapterWithRole = async (role: ChapterRole): Promise<void> => {
    if (!bookId) return
    if (!confirmDiscard()) return
    const titleKey =
      role === 'part' ? 'untitledPart' : role === 'chapter' ? 'untitledChapterGroup' : 'untitledPage'
    let parentId: string | null = null
    let afterId: string | undefined
    if (role !== 'part' && selectedTreeNode) {
      if (selectedTreeNode.role === 'page') {
        parentId = selectedTreeNode.parentId
        afterId = selectedTreeNode.id
      } else {
        parentId = selectedTreeNode.id
      }
    }
    setAddMenuOpen(false)
    setStatus({ kind: 'idle' })
    try {
      const { chapter: created, book } = await createChapter(bookId, {
        title: tr(titleKey),
        parentId,
        afterId,
        role,
      })
      setChapters(book.chapters)
      setSelectedId(created.id)
      dirtyRef.current = false
      setDirty(false)
      if (created.role === 'page') {
        setChapterId(created.id)
      } else {
        clearOpenChapter()
        setSelectedId(created.id)
      }
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onRenameSelected = async (): Promise<void> => {
    if (!selectedRow) return
    const next = globalThis.prompt?.(tr('chapterRenamePrompt'), selectedRow.title)?.trim()
    if (next === undefined || next === '') return
    setStatus({ kind: 'idle' })
    try {
      const renamed = await renameChapter(selectedRow.id, next)
      setChapters((previous) => previous.map((item) => (
        item.id === renamed.id ? { ...item, title: renamed.title, updated_at: renamed.updated_at } : item
      )))
      if (chapter?.id === renamed.id) setChapter((prev) => (prev ? { ...prev, title: renamed.title } : prev))
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onMoveChapter = async (payload: {
    id: string
    parentId: string | null
    afterId: string | null
  }): Promise<void> => {
    if (!bookId) return
    if (!confirmDiscard()) return
    setStatus({ kind: 'idle' })
    try {
      const { book } = await moveChapter(payload.id, {
        parentId: payload.parentId,
        afterId: payload.afterId,
      })
      setChapters(book.chapters)
      dirtyRef.current = false
      setDirty(false)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onCreateBook = async (): Promise<void> => {
    if (screen === 'workshop' && !confirmDiscard()) return
    const title = globalThis.prompt?.(tr('newBookPrompt'), tr('untitledBook'))?.trim()
    if (title === undefined) return
    setStatus({ kind: 'idle' })
    try {
      const book = await createBook(title)
      await loadBooks()
      openWorkshop(book.id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onRenameBook = async (book: Book): Promise<void> => {
    const title = globalThis.prompt?.(tr('bookRenamePrompt'), book.title)?.trim()
    if (title === undefined || title === '') return
    setStatus({ kind: 'idle' })
    try {
      const updated = await updateBook(book.id, { title })
      setBooks((rows) => rows.map((row) => (row.id === updated.id ? { ...row, title: updated.title } : row)))
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onDeleteBook = async (book: Book): Promise<void> => {
    if (screen === 'workshop' && book.id === bookId && !confirmDiscard()) return
    const ok = globalThis.confirm?.(tr('bookDeleteConfirm', { title: book.title }))
    if (!ok) return
    setStatus({ kind: 'idle' })
    try {
      await deleteBook(book.id)
      if (book.id === bookId) backToLibrary()
      await loadBooks()
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onExportFeb = async (book: Book): Promise<void> => {
    setStatus({ kind: 'idle' })
    try {
      const blob = await exportFebBook(book.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${(book.title || 'book').replace(/[^\w\u4e00-\u9fff.-]+/g, '_')}.feb`
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onImportFebPick = (): void => {
    febInputRef.current?.click()
  }

  const onImportFebFile = async (file: File): Promise<void> => {
    const updateTarget = screen === 'workshop' && bookId && globalThis.confirm?.(tr('febImportUpdateConfirm'))
      ? bookId
      : ''
    const mode: 'new' | 'update' = updateTarget ? 'update' : 'new'
    setStatus({ kind: 'idle' })
    try {
      const book = await importFebFile(file, mode, updateTarget || undefined)
      await loadBooks()
      openWorkshop(book.id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onDuplicateSelected = async (): Promise<void> => {
    if (!selectedRow) return
    if (!confirmDiscard()) return
    setStatus({ kind: 'idle' })
    try {
      const { chapter: created, book } = await duplicateChapter(selectedRow.id)
      setChapters(book.chapters)
      setSelectedId(created.id)
      if (created.role === 'page') setChapterId(created.id)
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onDeleteSelected = async (): Promise<void> => {
    if (!selectedRow) return
    if (!confirmDiscard()) return
    const ok = globalThis.confirm?.(
      tr('chapterDeleteConfirm', { title: selectedRow.title || tr('noChapter') }),
    )
    if (!ok) return
    setStatus({ kind: 'idle' })
    try {
      const book = await deleteChapter(selectedRow.id)
      setChapters(book.chapters)
      const stillSelected = book.chapters.some((item) => item.id === selectedId)
      if (!stillSelected) setSelectedId('')
      if (chapterId && !book.chapters.some((item) => item.id === chapterId)) {
        clearOpenChapter()
      }
      setStatus({ kind: 'saved' })
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const onTreeSelect = (node: TreeChapter): void => {
    if (dirty && !globalThis.confirm?.(tr('discardChanges'))) return
    setSelectedId(node.id)
    if (node.role === 'page') {
      setChapterId(node.id)
      return
    }
    setChapterId('')
    setChapter(null)
    setStatus({ kind: 'idle' })
  }

  const showEmptyWork =
    !booksLoading && !chaptersLoading && bookId && !chapterLoading && !chapter && !folderSelected
  const showFolderHint = folderSelected && !chapterLoading

  return (
    <div className="fe-workshop">
      <input
        ref={febInputRef}
        type="file"
        accept=".feb,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void onImportFebFile(file)
        }}
      />

      {screen === 'library' ? (
        <BookLibraryPage
          books={books}
          loading={booksLoading}
          query={libraryQuery}
          translate={tr}
          onQueryChange={setLibraryQuery}
          onRefresh={() => { void loadBooks() }}
          onCreate={() => { void onCreateBook() }}
          onImport={onImportFebPick}
          onOpen={openWorkshop}
          onRename={(book) => { void onRenameBook(book) }}
          onDelete={(book) => { void onDeleteBook(book) }}
          onExport={(book) => { void onExportFeb(book) }}
        />
      ) : (
        <>
      <header className="fe-workshop-topbar">
        <button type="button" className="fe-workshop-btn" onClick={backToLibrary} title={tr('backToLibrary')}>
          {tr('backToLibrary')}
        </button>
        <div className="fe-workshop-brand fe-workshop-brand--book">
          <strong className="fe-workshop-book-title">{currentBook?.title ?? tr('noBooks')}</strong>
          <span>{tr('panelDescription')}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="fe-workshop-btn"
          onClick={() => currentBook && void onExportFeb(currentBook)}
          disabled={!currentBook}
          title={tr('exportFeb')}
        >
          {tr('exportFeb')}
        </button>
        <button
          type="button"
          className="fe-workshop-btn"
          onClick={() => { void loadBooks() }}
          disabled={booksLoading}
          title={tr('refreshTitle')}
        >
          {booksLoading ? tr('loading') : tr('refresh')}
        </button>
        <button
          type="button"
          className="fe-workshop-btn"
          onClick={() => { void openTask('section') }}
          disabled={taskBusy || chapter === null}
          title="生成一条写作任务，复制到对话里让 Agent 按建议流程写"
        >
          {tr('aiWrite')}
        </button>
      </header>

      {proposals.length === 0 ? null : (
        <div className="se-proposals">
          <div className="se-proposals-head">
            <strong>{tr('proposalsTitle')}</strong>
            <span style={{ flex: 1 }} />
            <button type="button" className="fe-workshop-btn" onClick={() => { void acceptAll() }}>
              {tr('proposalAcceptAll')}
            </button>
            <button type="button" className="fe-workshop-btn" onClick={() => { void rejectAll() }}>
              {tr('proposalRejectAll')}
            </button>
          </div>
          {proposals.map((proposal) => {
            const revLag = Number(proposal.base_rev) !== Number(rev)
            return (
              <div
                key={proposal.id}
                className={`se-proposal-row${revLag ? ' se-proposal-row--stale' : ''}`}
              >
                <span className="se-proposal-row__note">
                  {proposal.note === '' ? tr('proposalDefaultNote') : proposal.note}
                </span>
                {revLag ? (
                  <span className="se-proposal-row__rev" title={tr('proposalRevLag', { base: String(proposal.base_rev), current: String(rev) })}>
                    {tr('proposalRevLag', { base: String(proposal.base_rev), current: String(rev) })}
                  </span>
                ) : null}
                <button type="button" className="fe-workshop-btn" onClick={() => { void onAcceptProposal(proposal) }}>
                  {tr('proposalAccept')}
                </button>
                <button type="button" className="fe-workshop-btn" onClick={() => { void onRejectProposal(proposal) }}>
                  {tr('proposalReject')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {acceptedProposals.length === 0 ? null : (
        <div className="se-accepted">
          <span className="se-accepted-label">{tr('proposalAcceptedTitle')}</span>
          {acceptedProposals.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              className="fe-workshop-btn"
              title={proposal.note === '' ? tr('proposalDefaultNote') : proposal.note}
              onClick={() => { void onRestoreProposal(proposal) }}
            >
              {tr('proposalUndo')}
            </button>
          ))}
        </div>
      )}

      <div className="fe-workshop-body">
        <aside className="editor-col editor-col-chapters">
          <div className="editor-chapters-head">
            <span>{tr('chapters')}</span>
            {!booksLoading && bookId && chapters.length > 0 ? (
              <div className="editor-chapters-head-actions">
                <button
                  type="button"
                  className="editor-chapters-icon-btn"
                  title={tr('chapterAddMenu')}
                  disabled={addOptions.length === 0}
                  onClick={() => setAddMenuOpen((open) => !open)}
                >
                  +
                </button>
                {addMenuOpen ? (
                  <div className="editor-chapters-add-menu">
                    {addOptions.map((opt) => (
                      <button
                        key={opt.role}
                        type="button"
                        onClick={() => { void addChapterWithRole(opt.role) }}
                      >
                        {tr('chapterAddRole', { role: opt.label })}
                      </button>
                    ))}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="editor-chapters-icon-btn"
                  title={tr('chapterRename')}
                  disabled={!selectedRow}
                  onClick={() => { void onRenameSelected() }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="editor-chapters-icon-btn"
                  title={tr('chapterDuplicate')}
                  disabled={!selectedRow}
                  onClick={() => { void onDuplicateSelected() }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="editor-chapters-icon-btn editor-chapters-icon-btn-danger"
                  title={tr('chapterDelete')}
                  disabled={!selectedRow}
                  onClick={() => { void onDeleteSelected() }}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
          <div className="editor-chapters-body">
            {booksLoading ? <p className="editor-folder-hint">{tr('loadingBooks')}</p> : null}
            {!booksLoading && chaptersLoading ? <p className="editor-folder-hint">{tr('loadingChapter')}</p> : null}
            {!booksLoading && !chaptersLoading && !bookId ? (
              <p className="editor-folder-hint">{books.length === 0 ? tr('noBooksHint') : tr('pickBook')}</p>
            ) : null}
            {!booksLoading && !chaptersLoading && bookId && chapters.length === 0 ? (
              <p className="editor-folder-hint">{tr('noChapter')}</p>
            ) : null}
            {!booksLoading && !chaptersLoading && bookId && chapters.length > 0 ? (
              <ChapterTreeSidebar
                chapters={chapters}
                selectedId={selectedId}
                activePageId={chapterId}
                dirtyPageId={dirty && chapterId ? chapterId : ''}
                previews={treePreviews}
                sortable={Boolean(bookId)}
                onSelect={onTreeSelect}
                onMove={onMoveChapter}
              />
            ) : null}
          </div>
          {!booksLoading && bookId && chapters.length > 0 ? (
            <div className="editor-chapters-summary">
              {tr('chapterSummary', { pages: String(pageCount), total: String(chapters.length) })}
            </div>
          ) : null}
        </aside>

        <main className="editor-col editor-col-work">
          {chapterLoading ? <p className="editor-folder-hint">{tr('loadingChapter')}</p> : null}

          {showEmptyWork ? (
            <p className="editor-folder-hint">{tr('noChapterHint')}</p>
          ) : null}

          {!booksLoading && !bookId ? (
            <p className="editor-folder-hint">{books.length === 0 ? tr('noBooksHint') : tr('pickBook')}</p>
          ) : null}

          {showFolderHint && selectedRow ? (
            <p className="editor-folder-hint">
              {tr('folderSelectedHint', { role: roleLabel(selectedRow.role, tr) })}
            </p>
          ) : null}

          {!chapterLoading && chapter ? (
            <>
              <div className="editor-work-toolbar">
                <div className="editor-work-tabs">
                  {(['rich', 'json'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`editor-work-tab${activeTab === value ? ' active' : ''}`}
                      onClick={() => switchTab(value)}
                      disabled={value === 'rich' && !richAllowed}
                    >
                      {value === 'rich' ? tr('richText') : tr('json')}
                    </button>
                  ))}
                </div>
                <span className="editor-status">{tr('revision', { rev: String(rev) })}</span>
                {dirty ? <span className="editor-status warn">● {tr('unsaved')}</span> : null}
                <span className={statusClass(status)}>{statusText(status, tr)}</span>
                <button
                  type="button"
                  className={`fe-workshop-btn primary${dirty ? ' dirty' : ''}`}
                  onClick={() => { void onSave() }}
                  disabled={!canEdit || saving}
                >
                  {saving ? tr('saving') : dirty ? tr('saveWithRev', { rev: String(rev) }) : tr('save')}
                </button>
              </div>

              {canEdit && unsupportedMarks.length > 0 ? (
                <div className="editor-folder-hint editor-status warn">
                  {tr('richUnsupported', { marks: unsupportedMarks.join('、') })}
                </div>
              ) : null}

              <div className="editor-work-pane">
                {activeTab === 'rich' && richAllowed ? (
                  <RichTextEditor
                    key={`${chapter.id}:${rev}:${richEpoch}`}
                    doc={richDocRef.current}
                    scan={richScan ?? { nodes: new Map(), valid: false }}
                    readOnly={!canEdit}
                    dirty={dirty}
                    bookId={bookId}
                    onChange={setDocument}
                    onQuickEdit={handleQuickEdit}
                    translate={(key) => tr(key as SmartEditKey)}
                    modules={modules}
                    onWriteTask={() => { void openTask('section') }}
                  />
                ) : (
                  <textarea
                    className={`se-json${dirty ? ' dirty' : ''}`}
                    value={jsonDraft}
                    onChange={(event) => {
                      setJsonDraft(event.target.value)
                      dirtyRef.current = true
                      setDirty(true)
                    }}
                    readOnly={!canEdit}
                    spellCheck={false}
                  />
                )}
              </div>
            </>
          ) : null}
        </main>

        <aside className="editor-col editor-col-props">
          <div className="editor-props-head">{tr('propsTitle')}</div>
          <div className="editor-props-body">
            <dl>
              <dt>{tr('bookTitle')}</dt>
              <dd>{currentBook?.title ?? '—'}</dd>
              {selectedRow ? (
                <>
                  <dt>{tr('chapterTitle')}</dt>
                  <dd>{selectedRow.title}</dd>
                  <dt>{tr('chapterRole')}</dt>
                  <dd>{roleLabel(selectedRow.role, tr)}</dd>
                </>
              ) : (
                <>
                  <dt>{tr('chapterTitle')}</dt>
                  <dd>{chapter?.title ?? '—'}</dd>
                </>
              )}
              {chapter ? (
                <>
                  <dt>{tr('revLabel')}</dt>
                  <dd className={dirty ? 'editor-props-value--dirty' : undefined}>
                    {dirty ? `${tr('revision', { rev: String(rev) })} · ${tr('unsaved')}` : tr('revision', { rev: String(rev) })}
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        </aside>
      </div>

      {task === null ? null : (
        <div
          className="se-task-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={task.title}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setTask(null) }}
        >
          <div
            style={{ width: 'min(680px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 10, border: '1px solid var(--dsw-alias-border, #333)', background: 'var(--dsw-alias-bg-overlay, #1c1c1c)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{task.title}</strong>
              <span style={{ flex: 1 }} />
              <button type="button" className="fe-workshop-btn" onClick={() => { void openTask('book') }} disabled={taskBusy}>
                {tr('taskBatch')}
              </button>
              <button type="button" className="fe-workshop-btn" onClick={() => setTask(null)}>{tr('taskClose')}</button>
            </div>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>{tr('taskHint')}</p>
            {taskProgress === '' ? null : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-text-warning, #fbbf24)' }}>{taskProgress}</p>
            )}
            <textarea
              value={task.prompt}
              onChange={(event) => setTask({ ...task, prompt: event.target.value })}
              spellCheck={false}
              style={{ width: '100%', minHeight: 260, flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.6, borderRadius: 6, border: '1px solid var(--dsw-alias-border, #333)', background: 'transparent', color: 'inherit', padding: 8, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="fe-workshop-btn" onClick={() => { void copyTask() }}>{tr('taskCopy')}</button>
              <button
                type="button"
                className="fe-workshop-btn primary"
                onClick={() => { void runTask() }}
                disabled={taskRunning || taskBusy}
              >
                {taskRunning ? tr('taskRunning') : tr('taskRun')}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}