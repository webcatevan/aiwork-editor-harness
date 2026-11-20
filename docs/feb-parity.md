# FEB 对齐说明

- `schemaVersion`: **2**
- `manifest.format`: `feb`
- Harness 导出可选 `manifest.app`: `aiwork-editor-harness`；给 FutureEditor 使用时 `export_feb` 默认 `forFutureEditor: true`，`app` 与媒体 URL 与桌面版兼容。
- 章节目录字段：`parent_id`、`role`（part|chapter|page）、`sort`
- 正文：`chapters/{id}.json` = Tiptap `doc`
- 模块块：`type` + `attrs.config` / `blockId` / `v`

往返验收：H0 测试 `packages/format/tests/feb.spec.ts`；人工用 FutureEditor 打开 Harness 导出的 `.feb`。