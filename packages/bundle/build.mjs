#!/usr/bin/env node
/**
 * Build the installable `@aiwork/dsh-smart-edit` bundle:
 *
 *   dist/index.js   host half: one ESM file (library + tools + fetch routes),
 *                   DSH and Node builtins stay external.
 *   dist/client.js  browser half: a `__ModuleLoader__.load` factory whose
 *                   externals (React, UI primitives) come from the module table.
 *
 * Usage: node build.mjs [host|client|all]   (default all)
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
const repoRoot = resolve(root, '..', '..')
const which = process.argv[2] ?? 'all'

/** Every DSH peer and Node builtin is resolved by the host, never inlined. */
const hostExternals = [/^node:/, /^@deepseek-ai\//, 'better-sqlite3']

/** Browser modules the module table hands the bundle through `require`. */
const clientExternals = ['react', 'react-dom', 'react/jsx-runtime', /^@deepseek-ai\/dsh-client-/]

async function buildHost() {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    resolve: {
      // Build the workspace sibling from source; its own tsc dist is not a prerequisite.
      alias: { '@aiwork/interactive-book-format': join(repoRoot, 'packages/format/src/index.ts') },
    },
    build: {
      outDir: join(root, 'dist/.host'),
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      sourcemap: false,
      lib: {
        entry: join(repoRoot, 'packages/library/src/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: { external: hostExternals },
    },
  })
  const body = readFileSync(join(root, 'dist/.host/index.js'), 'utf8')
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist/index.js'), body)
  rmSync(join(root, 'dist/.host'), { recursive: true, force: true })
  console.log(`host   dist/index.js        ${(body.length / 1024).toFixed(0)} KiB`)
}

async function buildClient() {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    esbuild: { jsx: 'automatic' },
    // ProseMirror and Tiptap read `process.env.NODE_ENV` at import time. The
    // browser has no `process`, so an unsubstituted read throws during the
    // module import and takes the whole plugin down with it.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: join(root, 'dist/.client'),
      emptyOutDir: true,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      lib: {
        entry: join(repoRoot, 'packages/client/src/client/index.tsx'),
        formats: ['cjs'],
        fileName: () => 'client.body',
      },
      rollupOptions: {
        external: clientExternals,
        output: { exports: 'named' },
        // Tiptap ships a React Server Components `"use client"` banner that has
        // no meaning in this browser bundle; rolldown warns on every build.
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
          warn(warning)
        },
      },
    },
  })
  const body = readFileSync(join(root, 'dist/.client/client.body'), 'utf8')
  // Tiptap, ProseMirror and every helper must be inlined: the module table only
  // hands the bundle React. A leaked `require("@tiptap/…")` must fail the build,
  // not the browser.
  const leaked = [...body.matchAll(/require\("([^"]+)"\)/g)]
    .map(match => match[1])
    .filter(specifier => specifier !== 'react' && specifier !== 'react-dom' && specifier !== 'react/jsx-runtime' && !specifier.startsWith('@deepseek-ai/dsh-client-'))
  if (leaked.length > 0) throw new Error(`client bundle must not require ${[...new Set(leaked)].join(', ')}`)
  // The browser has no Node globals; a stray reference fails at import time.
  const nodeGlobal = /\bprocess\.(?:env|argv|platform|cwd)\b/.exec(body)
  if (nodeGlobal !== null) throw new Error(`client bundle references the Node global ${nodeGlobal[0]}`)
  const wrapped = [
    '//! Smart Edit client half — sidebar panel, talks to /api/textbook/*.',
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(packageName)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    body,
    '\t\treturn module.exports;',
    '\t}',
    '});',
    '',
  ].join('\n')
  writeFileSync(join(root, 'dist/client.js'), wrapped)
  rmSync(join(root, 'dist/.client'), { recursive: true, force: true })
  console.log(`client dist/client.js       ${(wrapped.length / 1024).toFixed(0)} KiB`)
}

if (which === 'host' || which === 'all') await buildHost()
if (which === 'client' || which === 'all') await buildClient()
