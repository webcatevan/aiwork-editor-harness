import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { TextbookLibrary } from './textbook-library.js'
import { registerTextbookTools } from './tools.js'
import { registerTextbookRoutes } from './routes.js'

export const name = 'smart-edit'
export const inject = ['tools', 'connection', 'skills', 'llm']

export interface SmartEditLibraryConfig {
  /** 书库根目录；默认 <profile>/textbook-workshop */
  dataDir?: string
  /** editor-module.json 路径 */
  moduleCatalogPath?: string
}

/**
 * The package root of the loaded half: `<bundle>/dist/index.js` → `<bundle>`,
 * `<repo>/packages/library/src/index.ts` → `<repo>/packages/library`.
 */
function packageRoot(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
}

/**
 * Where the module catalog lives:
 *
 * - bundle: `<bundle>/dist/index.js` → `<bundle>/catalog/editor-module.json`
 * - source: `<repo>/packages/library/src/index.ts` → `<repo>/packages/bundle/catalog/editor-module.json`
 * - either: `<repo>/shared/module-catalog/editor-module.json`
 *
 * The host resolves this from its own location, so the profile patch needs no
 * absolute path (a `!!js` expression cannot call `require` at load time).
 * A missing catalog is not fatal.
 */
function defaultModuleCatalogPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(packageRoot(), 'catalog', 'editor-module.json'),
    path.resolve(here, '../../bundle/catalog/editor-module.json'),
    path.resolve(here, '../../../shared/module-catalog/editor-module.json'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

/** Read the two frontmatter fields a runtime skill needs. */
function readSkill(source: string): { name: string; description: string; content: string } | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (frontmatter?.[1] === undefined) return undefined
  const fields: Record<string, string> = {}
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  const name = fields.name
  const description = fields.description
  if (!name || !description) return undefined
  return { name, description, content: source.slice(frontmatter[0].length).trim() }
}

/**
 * Register this package's `skill/SKILL.md` as a runtime skill. A third-party
 * bundle cannot configure `@deepseek-ai/dsh-skill-filesystem` with its own
 * directory (the patch has no way to resolve its install path), so the host
 * half contributes the skill through the registry it already injects.
 */
function registerBundledSkill(ctx: CordisContext) {
  const file = path.join(packageRoot(), 'skill', 'SKILL.md')
  if (!fs.existsSync(file)) return
  const skill = readSkill(fs.readFileSync(file, 'utf8'))
  if (skill === undefined) {
    ctx.logger?.warn?.('smart-edit: skill/SKILL.md has no usable frontmatter')
    return
  }
  ctx.effect(
    () =>
      ctx.skills.register({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        path: file,
        resourceBase: { kind: 'directory', path: path.dirname(file) },
      }),
    'smart-edit: skill',
  )
}

export async function apply(ctx: CordisContext, config: SmartEditLibraryConfig = {}) {
  const dataDir =
    config.dataDir?.trim() ||
    path.join(process.env.DSH_PROFILE_DIR ?? process.cwd(), 'textbook-workshop')
  const catalogPath = config.moduleCatalogPath?.trim() || defaultModuleCatalogPath()
  const lib = new TextbookLibrary(dataDir, catalogPath)

  // Cordis 0.2.x rejects assigning an undeclared context property. Declaring
  // the handle as an owned service keeps `ctx.textbookLibrary = lib` (and any
  // host-side consumer of that handle) working on a real plugin context.
  if (typeof ctx.provide === 'function') ctx.provide('textbookLibrary', lib)
  ctx.textbookLibrary = lib

  registerTextbookTools(ctx, lib)
  registerTextbookRoutes(ctx, lib)
  registerBundledSkill(ctx)

  ctx.effect(() => () => {
    if (ctx.textbookLibrary === lib) ctx.textbookLibrary = undefined
  }, 'smart-edit: library handle')
}
