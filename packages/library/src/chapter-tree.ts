export type ChapterRole = 'part' | 'chapter' | 'page'

export type ChapterNode = {
  id: string
  book_id: string
  title: string
  sort: number
  parent_id: string | null
  role: ChapterRole
  content_json: string
  rev: number
  updated_at: number
  created_at: number
}

export const MAX_CHAPTER_DEPTH = 3

export function normalizeRole(role?: string | null): ChapterRole {
  return role === 'part' || role === 'chapter' ? role : 'page'
}

export function normalizeParentId(parentId?: string | null) {
  if (!parentId) return null
  return String(parentId)
}

export function buildById(all: ChapterNode[]) {
  return new Map(all.map((c) => [c.id, c]))
}

export function isDescendant(id: string, maybeAncestor: string, byId: Map<string, ChapterNode>) {
  let cur = byId.get(id)
  while (cur?.parent_id) {
    if (cur.parent_id === maybeAncestor) return true
    cur = byId.get(cur.parent_id)
  }
  return false
}

export function chapterDepth(node: ChapterNode, byId: Map<string, ChapterNode>) {
  let depth = 1
  let cur: ChapterNode | undefined = node
  while (cur?.parent_id) {
    depth += 1
    cur = byId.get(cur.parent_id)
    if (!cur || depth > 10) break
  }
  return depth
}

export function validateRoleAtDepth(role: ChapterRole, depth: number) {
  if (depth < 1 || depth > MAX_CHAPTER_DEPTH) return '最多三级目录'
  if (role === 'part' && depth !== 1) return '篇只能放在根下'
  if (role === 'chapter' && depth > 2) return '章最多放在第二级'
  return null
}

export function validateMove(node: ChapterNode, newParentId: string | null, byId: Map<string, ChapterNode>) {
  if (newParentId && !byId.has(newParentId)) return '目标父节点不存在'
  if (newParentId && isDescendant(newParentId, node.id, byId)) return '不能移动到自身或子节点下'
  const parent = newParentId ? byId.get(newParentId) : null
  if (parent?.role === 'page') return '页面下不能再放子节点'
  const depth = newParentId ? chapterDepth(parent!, byId) + 1 : 1
  const roleErr = validateRoleAtDepth(node.role, depth)
  if (roleErr) return roleErr
  return null
}

export function countPages(all: ChapterNode[]) {
  return all.filter((c) => normalizeRole(c.role) === 'page').length
}

/** Collect one node and every descendant id (depth-first). */
export function collectSubtreeIds(rootId: string, all: ChapterNode[]) {
  const byParent = new Map<string | null, ChapterNode[]>()
  for (const c of all) {
    const p = normalizeParentId(c.parent_id)
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(c)
  }
  const ids: string[] = []
  const walk = (id: string) => {
    ids.push(id)
    for (const ch of byParent.get(id) || []) walk(ch.id)
  }
  walk(rootId)
  return ids
}