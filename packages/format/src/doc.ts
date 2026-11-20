export const EMPTY_DOC = { type: 'doc', content: [] as unknown[] }
export const EMPTY_GROUP_DOC = JSON.stringify({ type: 'doc', content: [] })

export type ChapterRole = 'part' | 'chapter' | 'page'

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function normalizeRole(role?: string | null): ChapterRole {
  return role === 'part' || role === 'chapter' ? role : 'page'
}