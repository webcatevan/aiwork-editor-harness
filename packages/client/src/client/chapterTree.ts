/**
 * Chapter tree helpers (aligned with aiwork-editor `lib/chapterTree.js`).
 */

export const CHAPTER_ROLES = ['part', 'chapter', 'page'] as const
export const MAX_CHAPTER_DEPTH = 3

export type ChapterRole = (typeof CHAPTER_ROLES)[number]

export function normalizeChapterRole(role?: string | null): ChapterRole {
  return role === 'part' || role === 'chapter' ? role : 'page'
}

export function normalizeParentId(parentId?: string | null): string | null {
  if (parentId == null || parentId === '') return null
  return String(parentId)
}

const PART_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export function formatChapterIndex(pathIndex: number[], role: string): string {
  const r = normalizeChapterRole(role)
  if (r === 'part') {
    const n = pathIndex[0] || 1
    const partLabel = n <= 10 ? PART_CN[n] : String(n)
    return `第${partLabel}篇`
  }
  return (pathIndex || []).join('.')
}

export type FlatChapter = {
  id: string
  title: string
  sort?: number
  parent_id?: string | null
  parentId?: string | null
  role?: string
  rev?: number
}

export type TreeChapter = FlatChapter & {
  role: ChapterRole
  parentId: string | null
  depth: number
  pathIndex: number[]
  label: string
  children: TreeChapter[]
  isEditable: boolean
}

export function buildChapterTree(flat: FlatChapter[]): TreeChapter[] {
  const byParent = new Map<string | null, FlatChapter[]>()
  for (const raw of flat || []) {
    const p = normalizeParentId(raw.parent_id ?? raw.parentId)
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(raw)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
  }

  const attach = (nodes: FlatChapter[], depth = 1, path: number[] = []): TreeChapter[] =>
    nodes.map((node, index) => {
      const role = normalizeChapterRole(node.role)
      const id = String(node.id)
      const pathIndex = [...path, index + 1]
      const title = String(node.title || '').trim() || '未命名'
      const label =
        role === 'part'
          ? `${formatChapterIndex(pathIndex, role)} ${title}`
          : `${formatChapterIndex(pathIndex, role)} ${title}`
      const children =
        role === 'page' ? [] : attach(byParent.get(id) || [], depth + 1, pathIndex)
      return {
        ...node,
        id,
        title,
        role,
        parentId: normalizeParentId(node.parent_id ?? node.parentId),
        depth,
        pathIndex,
        label,
        children,
        isEditable: role === 'page',
      }
    })

  return attach(byParent.get(null) || [])
}

export function countChapterPages(flat: readonly FlatChapter[]): number {
  return (flat || []).filter((c) => normalizeChapterRole(c.role) === 'page').length
}

export function roleLabel(role: string, tr: (key: string) => string): string {
  const r = normalizeChapterRole(role)
  if (r === 'part') return tr('rolePart')
  if (r === 'chapter') return tr('roleChapter')
  return tr('rolePage')
}

export function allowedChildRoles(parentDepth: number): ChapterRole[] {
  const childDepth = parentDepth + 1
  if (childDepth > MAX_CHAPTER_DEPTH) return []
  if (childDepth === 1) return ['part', 'chapter', 'page']
  if (childDepth === 2) return ['chapter', 'page']
  return ['page']
}

export function canAddRole(parentNode: TreeChapter | null | undefined, role: ChapterRole): boolean {
  const parentDepth = parentNode?.depth ?? 0
  const childDepth = parentDepth + 1
  if (childDepth > MAX_CHAPTER_DEPTH) return false
  if (parentNode?.role === 'page') return false
  if (role === 'part' && parentDepth !== 0) return false
  return allowedChildRoles(parentDepth).includes(role)
}

export type AddChapterOption = { role: ChapterRole; label: string }

/** Options for the “新建” menu, aligned with aiwork-editor. */
export function getAddChapterOptions(
  parentNode: TreeChapter | null | undefined,
  tr: (key: string) => string,
): AddChapterOption[] {
  const parent = parentNode ?? null
  const roles: AddChapterOption[] = []
  if (!parent || parent.role !== 'page') {
    for (const role of ['part', 'chapter', 'page'] as const) {
      if (canAddRole(parent, role)) roles.push({ role, label: roleLabel(role, tr) })
    }
  }
  return roles
}

export function findTreeNode(nodes: TreeChapter[], id: string): TreeChapter | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findTreeNode(node.children, id)
    if (found) return found
  }
  return undefined
}