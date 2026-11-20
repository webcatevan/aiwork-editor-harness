#!/usr/bin/env node
/**
 * Pre-publish: sync module catalog, build bundle, run smoke/dom tests.
 *
 * Usage (from repo root `aiwork-editor-harness`):
 *   node scripts/release-prep.mjs
 *
 * Requires Node ≥22.5 and a built `deepseek-harness` checkout (for host.smoke schema assertion).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const harnessRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundleDir = path.join(harnessRoot, 'packages/bundle')

function run(label, command, args, cwd, extraEnv = {}) {
  console.log(`\n>> ${label}`)
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error(`\nFAIL  ${label} (exit ${result.status ?? '?'})`)
    process.exit(result.status ?? 1)
  }
}

run('sync module catalog', 'node', ['scripts/sync-module-catalog.mjs'], harnessRoot)
run('build host + client', 'node', ['build.mjs', 'all'], bundleDir)

const dshDefault = path.join(harnessRoot, '../aiwork-harness/deepseek-harness')
const dsh = process.env.DSH_CHECKOUT ?? dshDefault
const toolsEntry = path.join(dsh, 'packages/core/tools/lib/index.js')
if (!fs.existsSync(toolsEntry)) {
  console.error(`\nFAIL  missing ${toolsEntry}`)
  console.error('      build deepseek-harness packages/core/tools, or set DSH_CHECKOUT')
  process.exit(1)
}

run('npm test (host + client + editor.dom)', 'npm', ['test'], bundleDir, { DSH_CHECKOUT: dsh })
console.log('\nPASS  release-prep complete (sync + build + test)')