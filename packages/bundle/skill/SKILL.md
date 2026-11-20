---
name: smart-edit
description: 在 DSH 内编辑书库：用 textbook__* 工具读写书、篇章树和 Tiptap 正文，插入/更新互动模块块，导入导出 .feb v2 与 FutureEditor 交换；与 FutureEditor 完全隔离。
---

# 智能编辑

在 DeepSeek Harness 内读写本 profile 书库。与 FutureEditor **完全隔离**；交接请用 `textbook__export_feb` / FutureEditor「另存为 .feb」，或面板「导出 .feb」。

## 工具前缀

所有工具名为 `textbook__*`（不是 `mcp__futureeditor__*`）。

## 正文写入

1. `textbook__get_chapter` → 记 `rev`
2. 仅 `role=page` 可 `textbook__save_chapter_json`
3. 公式在 text 内用 `$...$`，或正文节点 `inlineLatex` / `latexBlock`
4. rev 冲突则重新 get 再保存

## 章节树

- 增删改移：`add_chapter` / `delete_chapter` / `rename_chapter` / `move_chapter`
- **复制子树**：`duplicate_chapter`（与面板 ⧉ 一致）

## 模块

先 `textbook__describe_module`，再 `textbook__insert_module_block` / `textbook__update_module_block`；删块用 `remove_block`。

## 交换

- 导入：`textbook__import_feb` path + mode new|update（面板可走 HTTP 上传 zip）
- 导出：`textbook__export_feb`（默认 FutureEditor 兼容的 editor-local 媒体 URL）

## 工坊 UI 与焦点

侧栏「智能编辑」：选书 → 章树 → 富文本/JSON 编辑并保存（rev 冲突 409）。

- `textbook__focus_chapter` 设置当前书/章；面板约每 2 秒轮询 `GET /api/textbook/workshop-state` 同步（本地未保存时不抢焦点）。
- `textbook__get_workshop_state` 或上述 HTTP 可读当前焦点。

面板还支持：新建/删/重命名书、.feb 导入导出、复制章节、图片上传（`textbook://…/media/`）、互动块 config JSON 编辑。