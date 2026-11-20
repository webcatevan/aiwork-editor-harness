import type { Context } from '@deepseek-ai/cordis'
import type { TextbookLibrary } from './textbook-library.js'
import { defineJsonTool, type ParameterSpec } from './tool-def.js'

const P = 'textbook__'

type Args = Record<string, unknown>
type Exec = (args: Args) => unknown | Promise<unknown>

function str(v: unknown, fallback = '') {
  return v != null ? String(v) : fallback
}

/**
 * Register every `textbook__*` tool. Definitions are built locally rather than
 * with the host's `defineTool`, because an installed bundle cannot import
 * `@deepseek-ai/dsh-tools`; see `tool-def.ts` for the shape contract.
 */
export function registerTextbookTools(ctx: Context, lib: TextbookLibrary) {
  const tool = (
    name: string,
    description: string,
    parameters: Record<string, ParameterSpec>,
    execute: Exec,
  ) => {
    ctx.tools.register(defineJsonTool({ name, description, parameters, execute }))
  }

  tool(`${P}list_books`, '列出智能编辑书库中的互动书', { query: { type: 'string' } }, (args) =>
    lib.listBooks(str(args.query)),
  )

  tool(`${P}get_book`, '获取互动书及章节列表', { id: { type: 'string', required: true } }, (args) =>
    lib.getBook(str(args.id)),
  )

  tool(`${P}create_book`, '新建互动书', { title: { type: 'string' } }, (args) =>
    lib.createBook(str(args.title, '未命名')),
  )

  tool(
    `${P}update_book`,
    '更新书名或分类',
    {
      id: { type: 'string', required: true },
      title: { type: 'string' },
      category: { type: 'string' },
    },
    (args) =>
      lib.updateBook(str(args.id), {
        title: args.title != null ? str(args.title) : undefined,
        category: args.category != null ? str(args.category) : undefined,
      }),
  )

  tool(`${P}delete_book`, '删除互动书', { id: { type: 'string', required: true } }, (args) =>
    lib.deleteBook(str(args.id)),
  )

  tool(
    `${P}list_chapters`,
    '列出某书章节',
    { bookId: { type: 'string', required: true }, parentId: { type: 'string' } },
    (args) => lib.listChapters(str(args.bookId), args.parentId ? str(args.parentId) : null),
  )

  tool(`${P}get_chapter`, '章节元数据含 rev', { id: { type: 'string', required: true } }, (args) =>
    lib.getChapter(str(args.id)),
  )

  tool(`${P}get_chapter_json`, '章节 Tiptap doc', { id: { type: 'string', required: true } }, (args) => {
    const ch = lib.getChapter(str(args.id))
    return { ...ch, content: JSON.parse(ch.content_json) }
  })

  tool(
    `${P}save_chapter_json`,
    '保存页面 Tiptap doc；先 get_chapter 取 rev',
    {
      id: { type: 'string', required: true },
      content: { type: 'object', additionalProperties: true, required: true },
      rev: { type: 'number' },
    },
    (args) =>
      lib.saveChapterJson(str(args.id), args.content, {
        rev: args.rev != null ? Number(args.rev) : undefined,
      }),
  )

  tool(
    `${P}add_chapter`,
    '新增篇/章/页',
    {
      bookId: { type: 'string', required: true },
      title: { type: 'string' },
      parentId: { type: 'string' },
      role: { type: 'string' },
    },
    (args) =>
      lib.addChapter(str(args.bookId), str(args.title, '未命名'), undefined, {
        parentId: args.parentId != null ? str(args.parentId) : null,
        role: args.role as 'part' | 'chapter' | 'page' | undefined,
      }),
  )

  tool(`${P}delete_chapter`, '删除章节', { id: { type: 'string', required: true } }, (args) =>
    lib.deleteChapter(str(args.id)),
  )

  tool(
    `${P}rename_chapter`,
    '重命名章节',
    { id: { type: 'string', required: true }, title: { type: 'string', required: true } },
    (args) => lib.renameChapter(str(args.id), str(args.title)),
  )

  tool(
    `${P}move_chapter`,
    '移动章节',
    { id: { type: 'string', required: true }, parentId: { type: 'string' } },
    (args) =>
      lib.moveChapter(str(args.id), {
        parentId: args.parentId != null ? str(args.parentId) : null,
      }),
  )

  tool(
    `${P}duplicate_chapter`,
    '复制章节子树（含页面正文）',
    { id: { type: 'string', required: true } },
    (args) => lib.duplicateChapter(str(args.id)),
  )

  tool(`${P}list_module_catalog`, '已启用模块目录', {}, () => lib.listModuleCatalog())

  tool(`${P}describe_module`, '模块 defaultConfig', { type: { type: 'string', required: true } }, (args) =>
    lib.describeModule(str(args.type)),
  )

  tool(
    `${P}insert_module_block`,
    '插入互动模块块',
    {
      bookId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
      type: { type: 'string', required: true },
      config: { type: 'object', additionalProperties: true },
      afterBlockId: { type: 'string' },
      rev: { type: 'number' },
    },
    (args) =>
      lib.insertModuleBlock({
        bookId: str(args.bookId),
        chapterId: str(args.chapterId),
        type: str(args.type),
        config: (args.config || {}) as Record<string, unknown>,
        afterBlockId: args.afterBlockId ? str(args.afterBlockId) : undefined,
        rev: args.rev != null ? Number(args.rev) : undefined,
      }),
  )

  tool(
    `${P}update_module_block`,
    '更新模块 config',
    {
      chapterId: { type: 'string', required: true },
      blockId: { type: 'string', required: true },
      config: { type: 'object', additionalProperties: true, required: true },
      rev: { type: 'number' },
    },
    (args) =>
      lib.updateModuleBlock({
        chapterId: str(args.chapterId),
        blockId: str(args.blockId),
        config: args.config as Record<string, unknown>,
        rev: args.rev != null ? Number(args.rev) : undefined,
      }),
  )

  tool(
    `${P}remove_block`,
    '删除互动块',
    {
      chapterId: { type: 'string', required: true },
      blockId: { type: 'string', required: true },
      rev: { type: 'number' },
    },
    (args) =>
      lib.removeBlock({
        chapterId: str(args.chapterId),
        blockId: str(args.blockId),
        rev: args.rev != null ? Number(args.rev) : undefined,
      }),
  )

  tool(`${P}search_library`, '检索书库', { query: { type: 'string', required: true } }, (args) =>
    lib.searchLibrary(str(args.query)),
  )

  tool(
    `${P}import_feb`,
    '导入 .feb',
    { path: { type: 'string', required: true }, mode: { type: 'string' } },
    (args) => lib.importFeb(str(args.path), (args.mode as 'new' | 'update') || 'new'),
  )

  tool(
    `${P}export_feb`,
    '导出 .feb',
    {
      bookId: { type: 'string', required: true },
      destPath: { type: 'string', required: true },
      forFutureEditor: { type: 'boolean' },
    },
    (args) =>
      lib.exportFeb(str(args.bookId), str(args.destPath), args.forFutureEditor !== false),
  )

  tool(
    `${P}import_json`,
    '导入 JSON 书稿',
    { json: { type: 'object', additionalProperties: true, required: true }, title: { type: 'string' } },
    (args) => lib.importJson(args.json, str(args.title, '未命名')),
  )

  tool(
    `${P}focus_chapter`,
    '设置工坊 UI 焦点',
    { bookId: { type: 'string' }, chapterId: { type: 'string' } },
    (args) =>
      lib.setFocus(
        args.bookId ? str(args.bookId) : undefined,
        args.chapterId ? str(args.chapterId) : undefined,
      ),
  )

  tool(`${P}get_workshop_state`, '工坊状态', {}, () => lib.getWorkshopState())

  tool(
    `${P}writing_context`,
    '一次取齐写作上下文：书、篇章大纲、当前章正文、用户选区、可用模块',
    {
      bookId: { type: 'string' },
      chapterId: { type: 'string' },
      selection: { type: 'object', additionalProperties: true },
    },
    (args) =>
      lib.writingContext({
        bookId: args.bookId ? str(args.bookId) : undefined,
        chapterId: args.chapterId ? str(args.chapterId) : undefined,
        selection: (args.selection as { text?: string; from?: number; to?: number } | undefined) ?? undefined,
      }),
  )

  tool(
    `${P}propose_edit`,
    '提交一条章节修改建议（不直接写入）；由人在面板里接受或拒绝',
    {
      chapterId: { type: 'string', required: true },
      doc: { type: 'object', additionalProperties: true, required: true },
      baseRev: { type: 'number' },
      note: { type: 'string' },
    },
    (args) =>
      lib.createProposal({
        chapterId: str(args.chapterId),
        doc: args.doc,
        baseRev: args.baseRev != null ? Number(args.baseRev) : undefined,
        note: args.note != null ? str(args.note) : undefined,
        source: 'agent',
      }),
  )

  tool(`${P}list_proposals`, '列出章节的修改建议', { chapterId: { type: 'string' } }, (args) =>
    lib.listProposals(args.chapterId ? str(args.chapterId) : undefined),
  )

  tool(`${P}accept_proposal`, '接受建议并写入章节（rev 不符则冲突）', { id: { type: 'string', required: true } }, (args) =>
    lib.acceptProposal(str(args.id)),
  )

  tool(`${P}reject_proposal`, '拒绝建议', { id: { type: 'string', required: true } }, (args) =>
    lib.rejectProposal(str(args.id)),
  )

  tool(`${P}restore_proposal`, '撤销一条已接受且带快照的建议（rev 不符则冲突）', { id: { type: 'string', required: true } }, (args) =>
    lib.restoreProposal(str(args.id)),
  )
}
