#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, '../aiwork-editor/resources/seed/editor-module.json')
const targets = [
  path.join(root, 'shared/module-catalog/editor-module.json'),
  path.join(root, 'packages/bundle/catalog/editor-module.json'),
]

if (!fs.existsSync(src)) {
  console.error('missing', src)
  process.exit(1)
}
for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.copyFileSync(src, t)
  console.log('synced', t)
}