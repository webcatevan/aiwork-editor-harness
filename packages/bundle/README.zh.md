# @aiwork/dsh-smart-edit

DSH 组合包：AIWork 智能编辑。一个包装齐书库、章节编辑和 Agent 工具。书稿不限于教材：

| 部分 | 产物 | 说明 |
|----|----|----|
| Host | `dist/index.js` | SQLite（`node:sqlite`）书库 + `textbook__*` Agent 工具 + `/api/textbook/*` 路由 |
| Client | `dist/client.js` | `window.__ModuleLoader__` 工厂：侧栏「智能编辑」面板（Tiptap 富文本 + JSON 双页），走 HTTP 调 Host |
| Skill | `skill/SKILL.md` | 由补丁里的第二个 skill provider 提供 |

与 FutureEditor **完全隔离**；交换格式为 `.feb` v2，仅通过 `textbook__export_feb` / `textbook__import_feb` 交换文件。

## 安装

在 profile 里装**这个包**（`packages/bundle`），不是 monorepo 根目录——根目录是 private 工作区，
没有 `dsh.bundle`，DSH 会在 inspect 阶段拒绝：

```bash
dsh plugin install link:/绝对路径/aiwork-editor-harness/packages/bundle --profile <name>
```

或在 DSH Desktop / `plugin_manager` 里安装路径 `.../aiwork-editor-harness/packages/bundle`。

测试版用 `dsh plugin install <路径>` 时，profile 里会出现 `@aiwork/dsh-smart-edit` 依赖和
`dsh.profile.bundles` 条目；重启（或让 DSH 重新加载 profile）后生效：

1. 侧栏「智能编辑」→ 书库面板
2. Agent 工具 `textbook__*`
3. Skill `smart-edit`

## 书库与交换（面板）

侧栏点「智能编辑」后先进入 **书库列表**（搜索、卡片网格、新建/导入 .feb）；点 **「打开编辑」** 或卡片进入三栏工坊。工坊顶栏 **「← 书库」** 返回列表。

书库卡片上可重命名、导出、删除；工坊内可导出当前书、刷新章节。

章树：**新建篇/章/页**、重命名、**复制子树（⧉）**、删除、拖拽排序；页节点显示摘要与首图缩略图。

## 编辑器

面板打开页面章节时默认进 **富文本** 页：Tiptap（StarterKit：标题 1-3、加粗/斜体/下划线/删除线、列表、引用、代码块、链接、图片、表格、对齐）+ 少量自有样式；工具栏支持**上传图片**（`textbook://` 媒体）、**行内公式**（`inlineLatex`）。

- 文档里的**未知模块块**（`examQuestion`、`chemRust`、`columnLayout`…）按文档实际出现的类型动态建节点：无子节点的是 atom 卡片（显示类型、blockId、config 可展开），有子节点的是容器，属性按文档里出现过的 key 全量保留 —— 因此打开再保存不会丢块、丢配置、丢嵌套内容。
- 遇到编辑器无法表达的**未知标记**（如 `pinyinRuby`：基线没有的 mark），面板自动切到 **JSON** 页并提示，绝不静默降级。
- JSON 页始终可用：块内的精细配置、Agent 工具写出来的结构，都可以在这里直接改。
- 保存仍带 `rev`；409 会提示冲突并重新拉取章节。

Tiptap 及其依赖（ProseMirror 等）**打进 `dist/client.js`**（约 485 KiB），运行时只 `require` 平台模块 `react` / `react-dom` / `react/jsx-runtime` —— 第三方包在 profile 里拿不到其他模块。

## AI 写作（P0）

- 选中正文 → 浮出「润色 / 扩写 / 精简」→ Host 调 Agent 默认模型（`ctx.llm`），结果以**建议条**显示，点「接受」才写回（不整篇覆盖），「拒绝」丢弃。
- Agent 可以 `textbook__writing_context` 一次取齐上下文（书、大纲、当前章、选区、模块目录），再用 `textbook__propose_edit` 提交**待审建议**；面板顶部出现「AI 待审建议」，人接受才写入。
- 建议带 `baseRev`：章节在你审阅期间被改过，接受会 409，绝不覆盖。
- 新增路由：`/api/textbook/quick-edit`、`/api/textbook/proposals`、`/api/textbook/proposals/accept|reject`。

## AI 写作（P1/P2）

- **任务卡直接执行**：面板右上「AI 写作」按当前书/章生成任务（写这一节 / 续写 / 按大纲写整本），内嵌 `writing_context`（大纲、正文、模块目录）与「用 `propose_edit` 提交、别直接 save」的约束；复制到对话发送即可。
- **建议队列**：面板每 5 秒刷新本章建议；支持单条/全部接受、全部拒绝；已接受的建议可**撤销**（`restore_proposal`，写回建议生成前的快照，rev 不符则 409）。
- **斜杠菜单**：空段落里输入 `/` → 标题/列表/引用/代码/分割线、**互动模块**（按 `catalog` 插入带默认 config 的块节点）、「让 AI 写这一节」。
- **Agent 侧**：`textbook__writing_context`、`textbook__propose_edit`、`textbook__list_proposals`、`textbook__accept_proposal`、`textbook__reject_proposal`、`textbook__restore_proposal`。

> 说明：面板不能直接把任务发进会话——第三方 bundle 拿不到作用域内的 `conversation.send`（它要求 `ctx.sessions.scopeOf(ctx)`）。所以任务卡采用「复制到对话」这一跳；要一键发送需要一个 DSH 侧的会话提交接缝。

- **任务卡直接执行**：面板右上「AI 写作」→ 执行 → Host 调 Agent 默认模型，按写作上下文生成完整 Tiptap 文档，落成**待审建议**（不直接写章节）；「按大纲写整本」逐节执行。也可以复制任务交给会话里的 Agent（它能插入互动模块）。

## 开发

```bash
cd packages/bundle
node build.mjs          # 同时构建 host 与 client
node build.mjs host     # 只构建 dist/index.js
node build.mjs client   # 只构建 dist/client.js
node tests/host.smoke.mjs     # 工具 + 路由 + SQLite
node tests/client.smoke.mjs   # 包形状 + schema 往返（模块块/标记不丢）
node tests/editor.dom.mjs     # jsdom 里真正挂载 Tiptap 编辑器并保存
```

`dist/` 是构建产物，`files` 里只发布 `dist`、补丁、locale、icon、skill、catalog。

## 数据

书库落在 `<DSH_PROFILE_DIR>/textbook-workshop/library.sqlite`，媒体在 `media/<bookId>/`。
可用 patch 里的 `dataDir` 覆盖。

## 发布

发布前：

1. 在 `aiwork-editor-harness` 根目录：`node scripts/release-prep.mjs`（等价于 catalog 同步 + `build.mjs all` + `npm test`）
2. 或分步：`node scripts/sync-module-catalog.mjs` → `cd packages/bundle && node build.mjs all && npm test`（Node ≥22.5；`host.smoke` 需本仓库旁 `aiwork-harness/deepseek-harness` 已构建，或设置 `DSH_CHECKOUT`）
3. 可选：用 FutureEditor 打开 Harness 导出的 `.feb` 做人工往返（见 `docs/feb-parity.md`）

`npm publish` 仅包含 `dist`、补丁、locale、skill、catalog 等（见 `package.json` `files`）。
