/**
 * The editor's slash menu.
 *
 * Typing `/` at the start of an empty block opens a menu of block commands:
 * headings, lists, quotes, code, the interactive module catalog, and the AI
 * writing task. Every entry removes the typed `/` before it acts, so the
 * document never keeps the trigger character.
 *
 * @module harness-client-smart-edit/client/SlashMenu
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { ModuleInfo } from './api.js'

/** One selectable slash entry. */
interface SlashItem {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly run: (editor: Editor) => void
}

/** Props of the slash menu. */
export interface SlashMenuProps {
  readonly editor: Editor
  /** Enabled interactive modules, inserted with their starting config. */
  readonly modules: readonly ModuleInfo[]
  /** Start the AI writing task card; absent hides that entry. */
  readonly onWriteTask?: () => void
}

/** Delete the typed `/query` before running an entry. */
function clearTrigger(editor: Editor, from: number, to: number): void {
  editor.chain().focus().deleteRange({ from, to }).run()
}

/** Build every entry, filtered by the typed query. */
function buildItems(modules: readonly ModuleInfo[], onWriteTask?: () => void): SlashItem[] {
  const blocks: SlashItem[] = [
    { id: 'h1', label: '一级标题', group: '文本', run: (editor) => { editor.chain().focus().toggleHeading({ level: 1 }).run() } },
    { id: 'h2', label: '二级标题', group: '文本', run: (editor) => { editor.chain().focus().toggleHeading({ level: 2 }).run() } },
    { id: 'h3', label: '三级标题', group: '文本', run: (editor) => { editor.chain().focus().toggleHeading({ level: 3 }).run() } },
    { id: 'bullet', label: '无序列表', group: '文本', run: (editor) => { editor.chain().focus().toggleBulletList().run() } },
    { id: 'ordered', label: '有序列表', group: '文本', run: (editor) => { editor.chain().focus().toggleOrderedList().run() } },
    { id: 'quote', label: '引用', group: '文本', run: (editor) => { editor.chain().focus().toggleBlockquote().run() } },
    { id: 'code', label: '代码块', group: '文本', run: (editor) => { editor.chain().focus().toggleCodeBlock().run() } },
    { id: 'divide', label: '分割线', group: '文本', run: (editor) => { editor.chain().focus().setHorizontalRule().run() } },
  ]
  const blocksById = new Map(blocks.map((item) => [item.id, item]))
  const moduleItems: SlashItem[] = modules.map((module) => ({
    id: `module:${module.type}`,
    label: module.name,
    group: '互动模块',
    run: (editor) => {
      editor.chain().focus().insertContent({
        type: module.type,
        attrs: {
          config: module.defaultConfig ?? {},
          v: 1,
          blockId: `b_${Math.random().toString(36).slice(2, 10)}`,
        },
      }).run()
    },
  }))
  const writing: SlashItem[] = onWriteTask === undefined ? [] : [{
    id: 'ai-write',
    label: '让 AI 写这一节',
    group: 'AI',
    run: () => onWriteTask(),
  }]
  return [...blocks, ...moduleItems, ...writing].filter((item) => blocksById.has(item.id) || item.id.startsWith('module:') || item.id === 'ai-write')
}

/**
 * Render the slash menu for the current selection.
 * @param props - editor, module catalog and the AI task hook.
 * @returns the menu, or null when the caret is not after a `/` trigger.
 */
export function SlashMenu({ editor, modules, onWriteTask }: SlashMenuProps): ReactNode {
  const [trigger, setTrigger] = useState<{ query: string; from: number; to: number; top: number; left: number } | null>(null)

  useEffect(() => {
    const update = (): void => {
      const { $from, empty } = editor.state.selection
      if (!empty) {
        setTrigger(null)
        return
      }
      const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
      if (!before.startsWith('/') || before.includes(' ') || before.includes('\n')) {
        setTrigger(null)
        return
      }
      const coords = editor.view.coordsAtPos($from.pos)
      setTrigger({
        query: before.slice(1),
        from: $from.pos - before.length,
        to: $from.pos,
        top: coords.bottom + 6,
        left: coords.left,
      })
    }
    editor.on('selectionUpdate', update)
    editor.on('update', update)
    editor.on('blur', () => setTrigger(null))
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('update', update)
    }
  }, [editor])

  const items = useMemo(() => {
    const all = buildItems(modules, onWriteTask)
    const query = trigger?.query.trim().toLowerCase() ?? ''
    return query === '' ? all : all.filter((item) => item.label.toLowerCase().includes(query) || item.id.includes(query))
  }, [modules, onWriteTask, trigger?.query])

  if (trigger === null) return null

  return (
    <div
      className="se-slash-menu"
      role="menu"
      aria-label="插入"
      style={{
        position: 'fixed',
        top: trigger.top,
        left: trigger.left,
        zIndex: 70,
        width: 260,
        maxHeight: 320,
        overflow: 'auto',
        padding: 4,
        border: '1px solid var(--dsw-alias-border, #333)',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-overlay, #202020)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, .4)',
      }}
      onMouseDown={(event) => { event.preventDefault() }}
    >
      {items.length === 0 ? (
        <div style={{ padding: '6px 8px', fontSize: 12, opacity: 0.6 }}>没有匹配的命令</div>
      ) : items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-slash-id={item.id}
          className="se-tool-btn"
          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8 }}
          onClick={() => {
            const { from, to } = trigger
            setTrigger(null)
            clearTrigger(editor, from, to)
            item.run(editor)
          }}
        >
          <span>{item.label}</span>
          <span style={{ opacity: 0.5, fontSize: 11 }}>{item.group}</span>
        </button>
      ))}
    </div>
  )
}
