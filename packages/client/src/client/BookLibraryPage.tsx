/**
 * 书库文件列表：进入工坊编辑前的第一站（对齐 FutureEditor 书架）。
 *
 * @module harness-client-smart-edit/client/BookLibraryPage
 */

import { useMemo, type ReactNode } from 'react'
import type { Book } from './api.js'
import type { SmartEditKey } from './locales.js'

type Translate = (key: SmartEditKey, params?: Record<string, string>) => string

export interface BookLibraryPageProps {
  readonly books: readonly Book[]
  readonly loading: boolean
  readonly query: string
  readonly translate: Translate
  readonly onQueryChange: (value: string) => void
  readonly onRefresh: () => void
  readonly onCreate: () => void
  readonly onImport: () => void
  readonly onOpen: (bookId: string) => void
  readonly onRename: (book: Book) => void
  readonly onDelete: (book: Book) => void
  readonly onExport: (book: Book) => void
}

function formatTime(ts?: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export function BookLibraryPage({
  books,
  loading,
  query,
  translate: tr,
  onQueryChange,
  onRefresh,
  onCreate,
  onImport,
  onOpen,
  onRename,
  onDelete,
  onExport,
}: BookLibraryPageProps): ReactNode {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return books
    return books.filter((book) => (book.title || '').toLowerCase().includes(q))
  }, [books, query])

  return (
    <div className="fe-library-page" data-testid="fe-library-page">
      <header className="fe-library-toolbar">
        <div className="fe-library-toolbar-title">
          <strong>{tr('libraryTitle')}</strong>
          <span>{tr('librarySubtitle')}</span>
        </div>
        <input
          type="search"
          className="fe-library-search"
          placeholder={tr('librarySearch')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button type="button" className="fe-workshop-btn" onClick={onCreate} disabled={loading}>
          {tr('newBook')}
        </button>
        <button type="button" className="fe-workshop-btn" onClick={onImport}>
          {tr('importFeb')}
        </button>
        <button type="button" className="fe-workshop-btn" onClick={onRefresh} disabled={loading}>
          {loading ? tr('loading') : tr('refresh')}
        </button>
      </header>

      <div className="fe-library-body">
        {loading ? <p className="editor-folder-hint">{tr('loadingBooks')}</p> : null}
        {!loading && filtered.length === 0 ? (
          <p className="editor-folder-hint fe-library-empty">{tr('noBooksHint')}</p>
        ) : null}
        {!loading && filtered.length > 0 ? (
          <ul className="fe-library-grid" role="list">
            {filtered.map((book) => (
              <li key={book.id}>
                <article
                  className="fe-library-card"
                  data-testid="fe-library-card"
                  onClick={() => onOpen(book.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpen(book.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="fe-library-card-cover" aria-hidden />
                  <h3 className="fe-library-card-title">{book.title || tr('untitledBook')}</h3>
                  <p className="fe-library-card-meta">
                    {book.kind ? `${book.kind}` : 'interactive'}
                    {book.updated_at ? ` · ${formatTime(book.updated_at)}` : ''}
                  </p>
                  <div className="fe-library-card-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="fe-workshop-btn primary" onClick={() => onOpen(book.id)}>
                      {tr('libraryOpen')}
                    </button>
                    <button type="button" className="fe-workshop-btn" onClick={() => onRename(book)} title={tr('renameBook')}>
                      {tr('renameBook')}
                    </button>
                    <button type="button" className="fe-workshop-btn" onClick={() => onExport(book)} title={tr('exportFeb')}>
                      {tr('exportFeb')}
                    </button>
                    <button
                      type="button"
                      className="fe-workshop-btn fe-library-card-delete"
                      onClick={() => onDelete(book)}
                      title={tr('deleteBook')}
                    >
                      {tr('deleteBook')}
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}