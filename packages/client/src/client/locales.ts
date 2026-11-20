/**
 * Copy and dictionaries of the smart-edit panel.
 *
 * The dictionaries are plain TypeScript objects so the browser bundle stays
 * self-contained: no JSON fetch, no CSS import, no `?raw` asset. They are
 * registered under {@link NS} by the browser entry.
 *
 * @module harness-client-smart-edit/client/locales
 */

/** Locale namespace owned by this plugin. */
export const NS = 'smart-edit'

/** Chinese copy. */
const zh = {
  'panel': '智能编辑',
  'panelDescription': '编辑教材章节的 Tiptap 文档',
  'book': '书库',
  'refresh': '刷新',
  'refreshTitle': '重新读取书库',
  'chapters': '章节',
  'noBooks': '书库为空',
  'noBooksHint': '请先在书库中创建一本教材，然后点「刷新」。',
  'pickBook': '请选择一本教材',
  'noChapter': '未选择章节',
  'noChapterHint': '从左侧章节列表选择一个页面开始编辑。',
  'loading': '加载中…',
  'loadingBooks': '正在读取书库…',
  'loadingChapter': '正在读取章节…',
  'save': '保存',
  'saving': '保存中…',
  'saveWithRev': '保存（rev {rev}）',
  'saved': '已保存',
  'conflict': '版本冲突',
  'invalidJson': 'JSON 格式错误，请修正后再保存',
  'error': '错误',
  'onlyPages': '仅页面节点（page）可编辑正文',
  'content': 'Tiptap 文档 JSON',
  'revision': 'rev {rev}',
  'rolePart': '篇',
  'roleChapter': '章',
  'rolePage': '页',
  'richText': '富文本',
  'json': 'JSON',
  'unsaved': '未保存',
  'discardChanges': '当前修改尚未保存，切换章节会丢失，继续？',
  'richUnsupported': '该章节包含编辑器不支持的标记（{marks}），已切到 JSON 页；保存不会丢失内容。',
  'folderSelectedHint': '当前选中的是目录节点（{role}），请在左侧选择页面（●）编辑正文。',
  'chapterSummary': '{pages} 页 · 共 {total} 个节点',
  'propsTitle': '章节信息',
  'bookTitle': '书名',
  'chapterTitle': '标题',
  'chapterRole': '类型',
  'revLabel': '版本',
  'quickPolish': '润色',
  'quickExpand': '扩写',
  'quickShorten': '精简',
  'suggestionTitle': 'AI 建议',
  'quickEditLoading': '生成中…',
  'suggestionApply': '接受',
  'suggestionDismiss': '拒绝',
  'proposalsTitle': 'AI 待审建议',
  'proposalAccept': '接受',
  'proposalReject': '拒绝',
  'proposalDefaultNote': '修改建议',
  'aiWrite': 'AI 写作',
  'proposalAcceptAll': '全部接受',
  'proposalRejectAll': '全部拒绝',
  'proposalAcceptedTitle': '已接受：',
  'proposalUndo': '撤销',
  'taskBatch': '按大纲写整本',
  'taskClose': '关闭',
  'taskHint': '点「执行」直接让模型按写作上下文写，结果作为待审建议出现在顶部；也可以复制任务交给对话里的 Agent（它能插入互动模块）。',
  'taskCopy': '复制任务',
  'taskRun': '执行',
  'taskRunning': '生成中…',
  'proposalRevLag': 'rev {base}→{current}',
  'chapterAddMenu': '新建章节',
  'chapterAddRole': '新建{role}',
  'chapterRename': '重命名',
  'chapterDelete': '删除',
  'chapterRenamePrompt': '章节标题',
  'chapterDeleteConfirm': '确定删除「{title}」及其子节点？此操作不可撤销。',
  'chapterDeleteFailed': '删除失败',
  'untitledPart': '未命名篇',
  'untitledChapterGroup': '未命名章',
  'untitledPage': '未命名页',
  'newBook': '新建书',
  'untitledBook': '未命名教材',
  'newBookPrompt': '书名',
  'renameBook': '重命名书',
  'deleteBook': '删除书',
  'bookRenamePrompt': '书名',
  'bookDeleteConfirm': '确定删除「{title}」及全部章节与媒体？不可撤销。',
  'importFeb': '导入 .feb',
  'exportFeb': '导出 .feb',
  'febImportUpdateConfirm': '检测到当前已选书籍：是否以「更新」模式导入（覆盖该书章节与媒体）？取消则导入为新书。',
  'chapterDuplicate': '复制章节',
  'libraryTitle': '互动教材书库',
  'librarySubtitle': '选择一本书进入章节编辑',
  'librarySearch': '搜索书名…',
  'libraryOpen': '打开编辑',
  'backToLibrary': '← 书库',
} as const

/** English copy. */
const en = {
  'panel': 'Smart edit',
  'panelDescription': "Edit a textbook chapter's Tiptap document",
  'book': 'Book',
  'refresh': 'Refresh',
  'refreshTitle': 'Reload the library',
  'chapters': 'Chapters',
  'noBooks': 'No books yet',
  'noBooksHint': 'Create a book in the library, then choose Refresh.',
  'pickBook': 'Choose a book',
  'noChapter': 'No chapter selected',
  'noChapterHint': 'Pick a page from the chapter list to start editing.',
  'loading': 'Loading…',
  'loadingBooks': 'Reading the library…',
  'loadingChapter': 'Reading the chapter…',
  'save': 'Save',
  'saving': 'Saving…',
  'saveWithRev': 'Save (rev {rev})',
  'saved': 'Saved',
  'conflict': 'Revision conflict',
  'invalidJson': 'Invalid JSON; fix it before saving',
  'error': 'Error',
  'onlyPages': 'Only page nodes can be edited',
  'content': 'Tiptap document JSON',
  'revision': 'rev {rev}',
  'rolePart': 'Part',
  'roleChapter': 'Chapter',
  'rolePage': 'Page',
  'richText': 'Rich text',
  'json': 'JSON',
  'unsaved': 'Unsaved',
  'discardChanges': 'This chapter has unsaved changes. Discard them and switch?',
  'richUnsupported': 'This chapter uses marks the editor cannot represent ({marks}), so it opened in the JSON tab; saving keeps everything.',
  'folderSelectedHint': 'This folder ({role}) is not editable — select a page (●) in the tree.',
  'chapterSummary': '{pages} pages · {total} nodes',
  'propsTitle': 'Chapter',
  'bookTitle': 'Book',
  'chapterTitle': 'Title',
  'chapterRole': 'Role',
  'revLabel': 'Revision',
  'quickPolish': 'Polish',
  'quickExpand': 'Expand',
  'quickShorten': 'Shorten',
  'suggestionTitle': 'AI suggestion',
  'quickEditLoading': 'Generating…',
  'suggestionApply': 'Apply',
  'suggestionDismiss': 'Dismiss',
  'proposalsTitle': 'Pending AI suggestions',
  'proposalAccept': 'Accept',
  'proposalReject': 'Reject',
  'proposalDefaultNote': 'Proposed edit',
  'aiWrite': 'AI writing',
  'proposalAcceptAll': 'Accept all',
  'proposalRejectAll': 'Reject all',
  'proposalAcceptedTitle': 'Accepted:',
  'proposalUndo': 'Undo',
  'taskBatch': 'Whole book from outline',
  'taskClose': 'Close',
  'taskHint': 'Run it to have the model write from the writing context and leave a pending proposal above; or copy the task into the chat, where the agent can also insert interactive modules.',
  'taskCopy': 'Copy task',
  'taskRun': 'Run',
  'taskRunning': 'Generating…',
  'proposalRevLag': 'rev {base}→{current}',
  'chapterAddMenu': 'New chapter',
  'chapterAddRole': 'New {role}',
  'chapterRename': 'Rename',
  'chapterDelete': 'Delete',
  'chapterRenamePrompt': 'Chapter title',
  'chapterDeleteConfirm': 'Delete “{title}” and its children? This cannot be undone.',
  'chapterDeleteFailed': 'Delete failed',
  'untitledPart': 'Untitled part',
  'untitledChapterGroup': 'Untitled chapter',
  'untitledPage': 'Untitled page',
  'newBook': 'New book',
  'untitledBook': 'Untitled book',
  'newBookPrompt': 'Book title',
  'renameBook': 'Rename book',
  'deleteBook': 'Delete book',
  'bookRenamePrompt': 'Book title',
  'bookDeleteConfirm': 'Delete “{title}” and all chapters/media? This cannot be undone.',
  'importFeb': 'Import .feb',
  'exportFeb': 'Export .feb',
  'febImportUpdateConfirm': 'A book is selected. Update it in place (overwrite chapters and media)? Cancel imports as a new book.',
  'chapterDuplicate': 'Duplicate',
  'libraryTitle': 'Library',
  'librarySubtitle': 'Choose a book to edit chapters',
  'librarySearch': 'Search by title…',
  'libraryOpen': 'Open',
  'backToLibrary': '← Library',
} as const

/** Every copy key of this namespace. */
export type SmartEditKey = keyof typeof zh

/** Dictionaries registered under {@link NS}. */
export const dictionaries: Record<string, Record<string, string>> = { zh, en }

/**
 * Resolve one key from a dictionary, substituting `{name}` placeholders.
 * Used as the panel's fallback when no locale seat is supplied (for example
 * when the component is rendered standalone in a test).
 * @param dictionary - one locale dictionary.
 * @param key - copy key.
 * @param params - placeholder values.
 * @returns the resolved copy.
 */
export function translate(
  dictionary: Record<string, string>,
  key: string,
  params?: Record<string, string>,
): string {
  const template = dictionary[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/**
 * Fallback translator backed by the Chinese dictionary.
 * @param key - copy key.
 * @param params - placeholder values.
 * @returns the resolved Chinese copy.
 */
export function fallbackTranslate(key: SmartEditKey, params?: Record<string, string>): string {
  return translate(zh, key, params)
}
