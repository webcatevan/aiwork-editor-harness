# aiwork-editor-harness

DeepSeek Harness **智能编辑**插件（可安装包 `@aiwork/dsh-smart-edit`），与 FutureEditor / 网站编辑器 **完全隔离**；图书交换格式为 **`.feb` v2**（与 FutureEditor 一致）。

## 宣传图

![智能编辑](market/promo/xingkong-smart-edit-hero.jpg)

| 封面 | 能力 | 海报 |
| --- | --- | --- |
| ![封面](market/promo/xingkong-smart-edit-cover.jpg) | ![书库、写作、待审](market/promo/xingkong-smart-edit-features.jpg) | ![海报](market/promo/xingkong-smart-edit-poster.jpg) |

## 包

| 包 | 作用 | 是否可安装 |
|----|----|----|
| `packages/bundle` | `@aiwork/dsh-smart-edit`：可安装的 DSH 组合包（host 产物 + client 产物 + skill + 补丁） | ✅ 装这个 |
| `packages/library` | Host 源码：`node:sqlite` 书库 + `textbook__*` 工具 | 源码，打进 bundle |
| `packages/client` | Client 源码：侧栏「智能编辑」面板（Tiptap 富文本 + JSON） | 源码，打进 bundle |
| `packages/format` | `.feb` v2 读写、媒体 URL 改写 | 源码，打进 bundle |

> ⚠️ 仓库根目录不是插件包：它是 private pnpm 工作区，`name` 为 `aiwork-editor-harness`，
> 没有 `dsh.bundle`。把根目录交给 `dsh plugin install` 会在 inspect 阶段被拒绝
> （`aiwork-editor-harness declares no dsh.bundle`）。安装路径必须指到 `packages/bundle`。

## 开发

```bash
cd aiwork-editor-harness
pnpm install
cd packages/bundle && node build.mjs     # 生成 dist/index.js 与 dist/client.js
node tests/host.smoke.mjs
node tests/client.smoke.mjs
```

## 安装到 DSH

在 profile 目录执行（需已安装 DSH 与 pnpm）：

```bash
dsh plugin install link:/绝对路径/aiwork-editor-harness/packages/bundle --profile <name>
```

或使用 `plugin_manager` / Desktop 插件页：安装路径 `.../aiwork-editor-harness/packages/bundle`。

启用后：

1. 侧栏 **智能编辑** 面板（书库 + 章节 JSON 编辑）
2. Agent 工具 `textbook__*`
3. Skill `smart-edit`

## AI 写作

- 选区工具条：润色 / 扩写 / 精简 → 建议条预览，接受才写回
- 任务卡：写这一节 / 续写 / 按大纲写整本，点「执行」直接生成待审建议；也可复制任务交给会话 Agent
- 建议队列：5s 轮询、单条/批量接受或拒绝、已接受的**撤销**
- 斜杠菜单：`/` 插标题/列表/引用/代码/互动模块，或「让 AI 写这一节」
- Agent：`textbook__writing_context`、`propose_edit`、`list_proposals`、`accept_proposal`、`reject_proposal`、`restore_proposal`

## Agent

加载 Skill `smart-edit`，调用 `textbook__list_books`、`textbook__save_chapter_json` 等。

## 与 FutureEditor

- 导出：`textbook__export_feb`（默认 `editor-local://` 媒体 URL）
- 导入：`textbook__import_feb`
- 不连接 `127.0.0.1:18030`，不共用 SQLite。

详见 `docs/feb-parity.md`。
