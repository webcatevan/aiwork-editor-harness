import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import {
  buildChapterTree,
  formatChapterIndex,
  normalizeChapterRole,
  normalizeParentId,
  type FlatChapter,
  type TreeChapter,
} from './chapterTree.js'

function roleIcon(role: string): string {
  const r = normalizeChapterRole(role)
  if (r === 'part') return '篇'
  if (r === 'chapter') return '章'
  return '●'
}

type DragOver = { id: string; pos: 'before' | 'inside' }

type MovePayload = { id: string; parentId: string | null; afterId: string | null }

function TreeNode({
  node,
  depth,
  selectedId,
  activePageId,
  dirtyPageId,
  previews,
  collapsed,
  sortable,
  dragId,
  dragOver,
  onToggle,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  node: TreeChapter
  depth: number
  selectedId: string
  activePageId: string
  dirtyPageId: string
  previews?: Record<string, { thumb?: string; snippet?: string }>
  collapsed: Set<string>
  sortable: boolean
  dragId: string | null
  dragOver: DragOver | null
  onToggle: (id: string) => void
  onSelect: (node: TreeChapter) => void
  onDragStart: (event: DragEvent<HTMLDivElement>, node: TreeChapter) => void
  onDragOver: (event: DragEvent<HTMLDivElement>, node: TreeChapter) => void
  onDrop: (event: DragEvent<HTMLDivElement>, node: TreeChapter) => void
  onDragEnd: () => void
}): ReactNode {
  const hasChildren = node.children.length > 0
  const isFolder = node.role !== 'page'
  const collapsedHere = collapsed.has(node.id)
  const selected = String(selectedId) === String(node.id)
  const active = String(activePageId) === String(node.id)
  const indexLabel = formatChapterIndex(node.pathIndex, node.role)
  const titleLabel = String(node.title || '').trim()
  const dragging = dragId === node.id
  const dragOverBefore = dragOver?.id === node.id && dragOver.pos === 'before'
  const dragOverInside = dragOver?.id === node.id && dragOver.pos === 'inside'

  const dirty = !isFolder && dirtyPageId !== '' && String(dirtyPageId) === String(node.id)
  const previewThumb = !isFolder ? previews?.[node.id]?.thumb : undefined
  const previewSnippet = !isFolder ? previews?.[node.id]?.snippet : undefined
  const className = [
    'chapter-tree-item',
    selected ? 'selected' : '',
    active ? 'active-page' : '',
    isFolder ? 'chapter-tree-item--folder' : 'chapter-tree-item--page',
    dirty ? 'chapter-tree-item--dirty' : '',
    dragging ? 'dragging' : '',
    dragOverBefore ? 'drag-over-before' : '',
    dragOverInside ? 'drag-over-inside' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div
        className={className}
        style={{ ['--tree-depth' as string]: depth - 1 }}
        draggable={sortable}
        onDragStart={(event) => onDragStart(event, node)}
        onDragOver={(event) => onDragOver(event, node)}
        onDrop={(event) => onDrop(event, node)}
        onDragEnd={onDragEnd}
      >
        {isFolder ? (
          <button
            type="button"
            className="chapter-tree-toggle"
            aria-label={collapsedHere ? '展开' : '折叠'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.id)
            }}
          >
            {hasChildren ? (collapsedHere ? '▸' : '▾') : '·'}
          </button>
        ) : null}
        <button
          type="button"
          className="chapter-tree-btn"
          onClick={() => onSelect(node)}
          title={node.label}
        >
          <span className="chapter-tree-leading">
            {previewThumb ? (
              <span
                className="chapter-tree-thumb"
                style={{ backgroundImage: `url(${previewThumb})` }}
                aria-hidden
              />
            ) : null}
            <span className="chapter-tree-role" aria-hidden>
              {roleIcon(node.role)}
            </span>
            <span className="chapter-tree-index">{indexLabel}</span>
          </span>
          <span className="chapter-tree-text">
            {titleLabel ? <span className="chapter-tree-title">{titleLabel}</span> : null}
            {previewSnippet ? <span className="chapter-tree-snippet">{previewSnippet}</span> : null}
          </span>
        </button>
      </div>
      {hasChildren && !collapsedHere
        ? node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              activePageId={activePageId}
              dirtyPageId={dirtyPageId}
              previews={previews}
              collapsed={collapsed}
              sortable={sortable}
              dragId={dragId}
              dragOver={dragOver}
              onToggle={onToggle}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))
        : null}
    </>
  )
}

export interface ChapterTreeSidebarProps {
  chapters: FlatChapter[]
  selectedId: string
  activePageId: string
  /** Page id with unsaved local edits; highlighted in the tree. */
  dirtyPageId?: string
  /** Page thumbnails and text snippets for the tree. */
  previews?: Record<string, { thumb?: string; snippet?: string }>
  sortable?: boolean
  onSelect: (node: TreeChapter) => void
  onMove?: (payload: MovePayload) => void | Promise<void>
}

export function ChapterTreeSidebar({
  chapters,
  selectedId,
  activePageId,
  dirtyPageId = '',
  previews,
  sortable = true,
  onSelect,
  onMove,
}: ChapterTreeSidebarProps): ReactNode {
  const tree = useMemo(() => buildChapterTree(chapters), [chapters])
  const [collapsed, setCollapsed] = useState(() => new Set<string>())
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<DragOver | null>(null)

  useEffect(() => {
    if (!selectedId) return
    document.querySelector('.chapter-tree-item.selected')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, chapters.length])

  const onToggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const parentKey = (row: FlatChapter | TreeChapter): string | null =>
    normalizeParentId(row.parent_id ?? row.parentId)

  const siblingsOf = (parentId: string | null): FlatChapter[] =>
    chapters.filter((row) => parentKey(row) === parentId)

  const onDragStart = (event: DragEvent<HTMLDivElement>, node: TreeChapter): void => {
    if (!sortable) return
    setDragId(node.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', node.id)
  }

  const onDragOverNode = (event: DragEvent<HTMLDivElement>, node: TreeChapter): void => {
    if (!sortable || !dragId || dragId === node.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const y = event.clientY - rect.top
    const ratio = rect.height > 0 ? y / rect.height : 0.5
    if (node.role !== 'page' && ratio > 0.28 && ratio < 0.72) {
      setDragOver({ id: node.id, pos: 'inside' })
    } else {
      setDragOver({ id: node.id, pos: 'before' })
    }
  }

  const onDropNode = (event: DragEvent<HTMLDivElement>, targetNode: TreeChapter): void => {
    if (!sortable) return
    event.preventDefault()
    const fromId = dragId
    const over = dragOver
    setDragId(null)
    setDragOver(null)
    if (!fromId || fromId === targetNode.id) return

    let parentId: string | null = parentKey(targetNode)
    let afterId: string | null = null

    if (over?.pos === 'inside' && targetNode.role !== 'page') {
      parentId = targetNode.id
      const children = siblingsOf(parentId)
      afterId = children.length > 0 ? children[children.length - 1]!.id : null
    } else {
      parentId = parentKey(targetNode)
      const siblings = siblingsOf(parentId)
      const index = siblings.findIndex((row) => row.id === targetNode.id)
      afterId = index > 0 ? siblings[index - 1]!.id : null
    }

    void onMove?.({ id: fromId, parentId, afterId })
  }

  const onDragEnd = (): void => {
    setDragId(null)
    setDragOver(null)
  }

  return (
    <nav className="chapter-sidebar chapter-tree-sidebar chapter-sidebar--list" aria-label="章节">
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={1}
          selectedId={selectedId}
          activePageId={activePageId}
          dirtyPageId={dirtyPageId}
          previews={previews}
          collapsed={collapsed}
          sortable={sortable && onMove !== undefined}
          dragId={dragId}
          dragOver={dragOver}
          onToggle={onToggle}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragOver={onDragOverNode}
          onDrop={onDropNode}
          onDragEnd={onDragEnd}
        />
      ))}
    </nav>
  )
}