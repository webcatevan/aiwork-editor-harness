#!/usr/bin/env node
/**
 * Offline check that a built bundle can be a profile layer.
 *
 * Builds a throwaway profile whose only dependency is a `link:` to this
 * package, then runs DSH's own `loadProfileDirectory` over it: patch files are
 * resolved through the profile's node_modules, parsed, and platform/version
 * gated exactly as at boot. Nothing in the live profile is touched.
 *
 * Usage: node scripts/verify-profile.mjs
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = join(root, 'packages/bundle')
const dsh = process.env.DSH_CHECKOUT
  ?? '/Users/wenpu/projects/zhiyuan/new/aiwork/aiwork-harness/deepseek-harness'
const { loadProfileDirectory } = await import(join(dsh, 'packages/boot/app-boot/lib/index.js'))
const appPackage = join(dsh, 'apps/desktop/package.json')

const scratch = join(tmpdir(), `smart-edit-profile-${process.pid}`)
const profile = join(scratch, 'profiles/smart-edit')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(join(profile, 'node_modules/@aiwork'), { recursive: true })
symlinkSync(bundle, join(profile, 'node_modules/@aiwork/dsh-smart-edit'), 'dir')
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-smart-edit-check',
  private: true,
  dependencies: { '@aiwork/dsh-smart-edit': `link:${bundle}` },
  dsh: { profile: { bundles: ['@aiwork/dsh-smart-edit'] } },
}, null, 2))

const fail = (message) => {
  console.error(`FAIL ${message}`)
  rmSync(scratch, { recursive: true, force: true })
  process.exit(1)
}

try {
  const loaded = loadProfileDirectory('dsh', profile, appPackage, { userLayer: false })
  if (loaded.skippedBundles.length > 0) {
    fail(`bundle skipped at load: ${loaded.skippedBundles.map(s => `${s.packageName}: ${s.reason}`).join('; ')}`)
  }
  const layer = loaded.layers.find(entry => entry.packageName === '@aiwork/dsh-smart-edit')
  if (layer === undefined) fail('the bundle produced no profile layer')
  const rows = layer.patches.flatMap(patch => patch.insert ?? []).map(row => `${row.id} → ${row.name}`)
  console.log(`bundle   ${layer.packageName}`)
  console.log(`dir      ${layer.packageDir}`)
  console.log(`patches  ${layer.patchPaths.join(', ')}`)
  for (const row of rows) console.log(`row      ${row}`)
  if (rows.length !== 1 || !rows[0].includes('@aiwork/dsh-smart-edit')) {
    fail(`expected exactly one smart-edit row, got: ${rows.join(' | ') || '(none)'}`)
  }
  const config = layer.patches.flatMap(patch => patch.insert ?? []).find(row => row.id === 'smart-edit')?.config
  if (config !== undefined && Object.keys(config).length > 0) {
    fail(`the smart-edit row must not carry config (the host resolves its own paths), got: ${JSON.stringify(config)}`)
  }
  console.log('PASS profile layer loads with the smart-edit row')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
