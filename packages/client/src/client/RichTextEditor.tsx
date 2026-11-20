/**
 * The rich-text surface of the smart-edit panel.
 *
 * A real Tiptap editor over the chapter's stored document: text, headings,
 * lists, quotes, code, links, images, tables and alignment. Module blocks the
 * schema does not know render as preserved cards (see `tiptap.ts`). Saving is
 * the panel's job; this component only reports every document change.
 *
 * @module harness-client-smart-edit/client/RichTextEditor
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { extensionsFor } from './tiptap.js'
import { errorMessage, uploadMedia, type ModuleInfo, type QuickEditMode } from './api.js'
import { mediaUrlForDisplay } from './media-urls.js'
import { SlashMenu } from './SlashMenu.js'
import type { DocScan } from './doc-model.js'

/** One toolbar action. */
interface Action {
  readonly label: string
  readonly title: string
  readonly run: (editor: Editor) => void
  readonly active?: (editor: Editor) => boolean
  readonly enabled?: (editor: Editor) => boolean
}

/** The text-formatting actions of the toolbar. */
function actions(): Action[] {
  return [
    { label: 'H1', title: '一级标题', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
    { label: 'H2', title: '二级标题', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
    { label: 'H3', title: '三级标题', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
    { label: 'B', title: '加粗', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
    { label: 'I', title: '斜体', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
    { label: 'U', title: '下划线', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
    { label: 'S', title: '删除线', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
    { label: '•', title: '无序列表', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
    { label: '1.', title: '有序列表', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
    { label: '“', title: '引用', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
    { label: '</>', title: '代码块', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
    {
      label: '链接',
      title: '插入或移除链接',
      run: (e) => {
        if (e.isActive('link')) {
          e.chain().focus().unsetLink().run()
          return
        }
        const href = globalThis.prompt?.('链接地址（https://…）')?.trim()
        if (!href) return
        e.chain().focus().extendMarkRange('link').setLink({ href }).run()
      },
      active: (e) => e.isActive('link'),
    },
    { label: '↶', title: '撤销', run: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().chain().focus().undo().run() },
    { label: '↷', title: '重做', run: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().chain().focus().redo().run() },
  ]
}

/** One toolbar button bound to the live editor. */
function ToolButton({ action, editor }: { action: Action; editor: Editor }): ReactNode {
  const active = action.active?.(editor) === true
  const enabled = action.enabled?.(editor) !== false
  return (
    <button
      type="button"
      className={`se-tool-btn${active ? ' active' : ''}`}
      title={action.title}
      disabled={!enabled}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => action.run(editor)}
    >
      {action.label}
    </button>
  )
}

/** Props of the rich-text surface. */
export interface RichTextEditorProps {
  /** Parsed Tiptap document to edit. */
  readonly doc: unknown
  /** Node shapes collected from that document. */
  readonly scan: DocScan
  /** Whether the chapter accepts edits (page role, no unsupported marks). */
  readonly readOnly: boolean
  /** Called with the editor's JSON after every change. */
  readonly onChange: (json: unknown) => void
  /** Ask the host to rewrite the selected text; absent disables the selection menu. */
  readonly onQuickEdit?: (mode: QuickEditMode, input: { text: string; from: number; to: number }) => Promise<string>
  /** Copy lookup, so the panel's locale seat reaches this component. */
  readonly translate?: (key: string) => string
  /** Modules the slash menu can insert; absent disables module insertion. */
  readonly modules?: readonly ModuleInfo[]
  /** Hand the current chapter to the AI writing task card. */
  readonly onWriteTask?: () => void
  /** Local edits not yet saved to the server. */
  readonly dirty?: boolean
  /** Book id for media uploads (images). */
  readonly bookId?: string
}

/** The selection actions, in the order the menu shows them. */
const QUICK_MODES: readonly { mode: QuickEditMode; key: string; label: string }[] = [
  { mode: 'polish', key: 'quickPolish', label: '润色' },
  { mode: 'expand', key: 'quickExpand', label: '扩写' },
  { mode: 'shorten', key: 'quickShorten', label: '精简' },
]

/** One selection edit waiting for a decision. */
interface Suggestion {
  readonly mode: QuickEditMode
  readonly from: number
  readonly to: number
  readonly original: string
  readonly text: string
  readonly loading: boolean
  readonly error?: string
}

/**
 * Render the editor and its toolbar.
 * @param props - document, scan, editability and change sink.
 * @returns the editor surface.
 */
export function RichTextEditor({
  doc,
  scan,
  readOnly,
  dirty = false,
  onChange,
  onQuickEdit,
  translate,
  modules,
  onWriteTask,
  bookId = '',
}: RichTextEditorProps): ReactNode {
  // The change sink lives in a ref so a new identity never re-creates the
  // editor. Re-creating it on every keystroke is what breaks IME composition:
  // the composition is torn down while the input method is still committing.
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  // One extension set for this mount; the panel remounts the component (by
  // key) when the chapter or the resolved document changes.
  const extensions = useMemo(() => extensionsFor(scan, (modules ?? []).map((module) => module.type)), [])

  const editor = useEditor({
    extensions,
    content: doc as never,
    editable: !readOnly,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: 'tiptap', spellcheck: 'false' } },
    onUpdate: ({ editor: current }) => changeRef.current(current.getJSON()),
  }, [])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  const tr = (key: string, fallback: string): string => translate?.(key) ?? fallback

  const [selection, setSelection] = useState<{ from: number; to: number; text: string; top: number; left: number } | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [mediaError, setMediaError] = useState('')

  const insertImageFile = async (file: File): Promise<void> => {
    if (editor === null || bookId === '') return
    setMediaError('')
    try {
      const saved = await uploadMedia(bookId, file)
      const src = mediaUrlForDisplay(saved.url)
      editor.chain().focus().setImage({ src }).run()
    } catch (error) {
      setMediaError(errorMessage(error))
    }
  }

  const insertInlineLatex = (): void => {
    if (editor === null) return
    const latex = globalThis.prompt?.('LaTeX 公式（行内）')?.trim()
    if (!latex) return
    editor.chain().focus().insertContent({ type: 'inlineLatex', attrs: { latex } }).run()
  }

  useEffect(() => {
    if (editor === null) return
    const update = (): void => {
      const { from, to } = editor.state.selection
      const text = from === to ? '' : editor.state.doc.textBetween(from, to, '\n')
      if (text.trim() === '') {
        setSelection(null)
        return
      }
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      setSelection({
        from,
        to,
        text,
        top: Math.min(start.top, end.top) - 10,
        left: (start.left + end.left) / 2,
      })
    }
    const clear = (): void => { setSelection(null) }
    editor.on('selectionUpdate', update)
    editor.on('blur', clear)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', clear)
    }
  }, [editor])

  const runQuickEdit = async (mode: QuickEditMode): Promise<void> => {
    if (editor === null || onQuickEdit === undefined || selection === null) return
    const { from, to, text } = selection
    setSuggestion({ mode, from, to, original: text, text: '', loading: true })
    setSelection(null)
    try {
      const edited = await onQuickEdit(mode, { text, from, to })
      setSuggestion((current) => current === null ? current : { ...current, text: edited, loading: false })
    } catch (error) {
      setSuggestion((current) => current === null ? current : {
        ...current, loading: false, error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const applySuggestion = (): void => {
    if (editor === null || suggestion === null || suggestion.text === '') return
    try {
      editor.chain().focus()
        .insertContentAt({ from: suggestion.from, to: suggestion.to }, { type: 'text', text: suggestion.text })
        .run()
      setSuggestion(null)
    } catch (error) {
      setSuggestion((current) => current === null ? current : {
        ...current, error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (editor === null) return null

  return (
    <div
      className={`se-editor${dirty ? ' se-editor--dirty' : ''}`}
      data-readonly={readOnly ? 'true' : 'false'}
    >
      {readOnly ? null : (
        <div className="se-toolbar" role="toolbar" aria-label="格式工具栏">
          {actions().map((action) => <ToolButton key={action.label} action={action} editor={editor} />)}
          <button
            type="button"
            className="se-tool-btn"
            title="插入图片"
            disabled={bookId === ''}
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={() => fileInputRef.current?.click()}
          >
            图
          </button>
          <button
            type="button"
            className="se-tool-btn"
            title="行内公式"
            onMouseDown={(event) => { event.preventDefault() }}
            onClick={insertInlineLatex}
          >
            ∑
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void insertImageFile(file)
            }}
          />
        </div>
      )}
      {mediaError ? <p className="editor-status err">{mediaError}</p> : null}
      <div className="se-editor-scroll">
        <EditorContent editor={editor} />
      </div>
      {readOnly ? null : <SlashMenu editor={editor} modules={modules ?? []} onWriteTask={onWriteTask} />}
      {selection !== null && !readOnly && onQuickEdit !== undefined ? (
        <div
          className="se-quick-menu"
          role="toolbar"
          aria-label="AI 写作"
          style={{
            position: 'fixed',
            top: selection.top,
            left: selection.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 60,
            display: 'flex',
            gap: 2,
            padding: 3,
            border: '1px solid var(--dsw-alias-border, #333)',
            borderRadius: 6,
            background: 'var(--dsw-alias-bg-overlay, #202020)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, .35)',
          }}
          onMouseDown={(event) => { event.preventDefault() }}
        >
          {QUICK_MODES.map((item) => (
            <button
              key={item.mode}
              type="button"
              className="se-tool-btn"
              data-quick-mode={item.mode}
              onClick={() => { void runQuickEdit(item.mode) }}
            >
              {tr(item.key, item.label)}
            </button>
          ))}
        </div>
      ) : null}
      {suggestion === null ? null : (
        <div className="se-suggestion">
          <div className="se-suggestion-head">
            <strong>{tr('suggestionTitle', 'AI 建议')}</strong>
            <span className="se-suggestion-mode">
              {QUICK_MODES.find((item) => item.mode === suggestion.mode)?.label ?? suggestion.mode}
            </span>
            <span style={{ flex: 1 }} />
            {suggestion.loading ? (
              <span style={{ opacity: 0.7, fontSize: 12 }}>{tr('quickEditLoading', '生成中…')}</span>
            ) : suggestion.error !== undefined ? (
              <span className="editor-status err">{suggestion.error}</span>
            ) : (
              <>
                <button type="button" className="se-tool-btn" onClick={applySuggestion}>{tr('suggestionApply', '接受')}</button>
                <button type="button" className="se-tool-btn" onClick={() => setSuggestion(null)}>{tr('suggestionDismiss', '拒绝')}</button>
              </>
            )}
          </div>
          {suggestion.loading || suggestion.error !== undefined ? null : (
            <div className="se-suggestion-compare">
              <div className="se-suggestion-original">{suggestion.original}</div>
              <div className="se-suggestion-new">{suggestion.text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}