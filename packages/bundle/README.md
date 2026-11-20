# @aiwork/dsh-smart-edit

DSH bundle for Smart Edit. One package carries a library, chapter editing, and agent tools:

| Half | Output | What it is |
|----|----|----|
| Host | `dist/index.js` | SQLite (`node:sqlite`) book library, the `textbook__*` agent tools, and the `/api/textbook/*` routes |
| Client | `dist/client.js` | A `window.__ModuleLoader__` factory: the 「智能编辑」sidebar panel (Tiptap rich text + JSON tabs), calling the host over HTTP |
| Skill | `skill/SKILL.md` | Served by a second skill provider inserted by the bundle patch |

It is fully isolated from FutureEditor; `.feb` v2 files are the only exchange format
(`textbook__export_feb` / `textbook__import_feb`).

## Install

Install **this package** (`packages/bundle`), not the repository root: the root is a
private workspace with no `dsh.bundle`, so DSH refuses it during `inspect`:

```bash
dsh plugin install link:/absolute/path/aiwork-editor-harness/packages/bundle --profile <name>
```

Or point the DSH Desktop / `plugin_manager` install at `.../aiwork-editor-harness/packages/bundle`.

After the profile reloads:

1. Sidebar 「智能编辑」 opens the library panel.
2. Agent tools are `textbook__*`.
3. Skill `smart-edit` is available.

## Editor

A page chapter opens in the **rich text** tab: Tiptap (StarterKit — headings 1-3, bold/italic/underline/strike, lists, quotes, code blocks, links, images, tables, alignment) plus a little chrome of its own.

- **Unknown module blocks** (`examQuestion`, `chemRust`, `columnLayout`, …) become generic nodes derived from the document itself: atoms render as cards (type, `blockId`, expandable config), containers keep their children, and every attribute key seen in the document is preserved — so opening and saving never drops a block, its config, or nested content.
- Chapters using **marks the editor cannot express** (e.g. `pinyinRuby`) open in the **JSON** tab with a notice instead of being silently degraded.
- The JSON tab is always available for fine-grained block config and for structures the agent tools produce.
- Saves still carry `rev`; a 409 shows the conflict and reloads the chapter.

Tiptap and its dependencies (ProseMirror, …) are **bundled into `dist/client.js`** (~485 KiB); at runtime the bundle only requires the platform modules `react`, `react-dom` and `react/jsx-runtime`, because a third-party package cannot resolve anything else from a profile.

## AI writing (P0)

- Select text → the「Polish / Expand / Shorten」menu appears → the host calls the Agent's default model (`ctx.llm`) and shows the result as a **suggestion bar**; Apply writes it, Dismiss drops it, and the chapter is never replaced wholesale.
- An agent can fetch everything it needs with `textbook__writing_context` (book, outline, open chapter, selection, module catalog) and leave a **pending proposal** with `textbook__propose_edit`; the panel shows「Pending AI suggestions」and a person accepts one.
- Proposals carry `baseRev`: if the chapter changed while you were reviewing, accepting returns 409 instead of overwriting.
- New routes: `/api/textbook/quick-edit`, `/api/textbook/proposals`, `/api/textbook/proposals/accept|reject`.

## AI writing (P1/P2)

- **Task cards**: the「AI writing」button in the panel builds a task for the current book/chapter (this section / continue / whole book from the outline). It embeds `writing_context` (outline, body, module catalog) and the rule to submit through `propose_edit` rather than saving; copy it into the chat.
- **Proposal queue**: the panel refreshes this chapter's proposals every 5s; accept one/all, reject all, and **undo** an accepted one (`restore_proposal` writes the pre-proposal snapshot back, 409 on a revision mismatch).
- **Slash menu**: type `/` in an empty block → headings, lists, quote, code, divider, **interactive modules** (inserted from the catalog with their default config), and 「let AI write this section」.
- **Agent tools**: `textbook__writing_context`, `propose_edit`, `list_proposals`, `accept_proposal`, `reject_proposal`, `restore_proposal`.

> The panel cannot post a task into the conversation directly: a third-party bundle has no scoped `conversation.send` (it requires `ctx.sessions.scopeOf(ctx)`). The task card therefore hands off through the clipboard; one-click send needs a session-submission seam in DSH.

- **Run the task card**: 「AI writing」→ Run → the host calls the Agent's default model, writes a complete Tiptap document from the writing context, and leaves it as a **pending proposal** (nothing is written directly); the whole-book mode runs section by section. Copying the task into the chat stays available for the agent's module tools.

## Develop

```bash
cd packages/bundle
node build.mjs          # host + client
node build.mjs host     # dist/index.js only
node build.mjs client   # dist/client.js only
node tests/host.smoke.mjs     # tools + routes + SQLite
node tests/client.smoke.mjs   # bundle shape + schema round-trip (blocks and marks survive)
node tests/editor.dom.mjs     # mounts the real Tiptap editor in jsdom and saves
```

`dist/` is generated; the published `files` list is `dist`, the patch, `locale`, `icon.svg`,
`skill`, `catalog`.

## Data

The library lives at `<DSH_PROFILE_DIR>/textbook-workshop/library.sqlite` with media under
`media/<bookId>/`; the patch can override `dataDir`.
