import { describe, expect, it } from 'vitest'
import { buildFebBuffer, readFebBuffer, rewriteDocMediaUrls } from '../src/index.js'
import { EMPTY_DOC } from '../src/doc.js'

describe('feb', () => {
  it('round-trips book with media URL rewrite', async () => {
    const bookId = 'book-1'
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'see textbook://book-1/media/a.png',
            },
          ],
        },
      ],
    }
    const buf = await buildFebBuffer({
      bookId,
      title: 'Test',
      chapters: [
        {
          id: 'ch1',
          title: 'P1',
          sort: 0,
          parent_id: null,
          role: 'page',
          content_json: JSON.stringify(doc),
        },
      ],
      media: [{ filename: 'a.png', bytes: Buffer.from('png') }],
      exportForFutureEditor: false,
    })
    const imp = await readFebBuffer(buf)
    expect(imp.bookMeta.title).toBe('Test')
    expect(imp.chapterPayloads).toHaveLength(1)
    const rewritten = rewriteDocMediaUrls(imp.chapterPayloads[0]!.doc, {
      fromBookId: bookId,
      toBookId: bookId,
      toProtocol: 'editor-local',
      fromProtocols: ['textbook'],
    }) as typeof EMPTY_DOC
    expect(JSON.stringify(rewritten)).toContain('editor-local://')
  })

  it('exports for FutureEditor protocol', async () => {
    const buf = await buildFebBuffer({
      bookId: 'b2',
      title: 'FE',
      chapters: [
        {
          id: 'c1',
          title: 'x',
          sort: 0,
          parent_id: null,
          role: 'page',
          content_json: JSON.stringify(EMPTY_DOC),
        },
      ],
      media: [],
      exportForFutureEditor: true,
    })
    const imp = await readFebBuffer(buf)
    expect(imp.chapterPayloads[0]!.doc).toEqual(EMPTY_DOC)
  })
})