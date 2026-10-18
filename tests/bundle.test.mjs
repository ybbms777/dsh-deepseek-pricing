// The installable-bundle contract: package.json must declare dsh.bundle.patch
// the way @deepseek-ai/dsh-app-boot reads it (bundlePatchFiles: a package-relative
// path string, or an ordered list of them), and the public copy must describe
// the bundled rate card rather than a live price fetch.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_METADATA } from '../tier.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(path.join(ROOT, name), 'utf8')

test('package.json declares dsh.bundle.patch at the shipped cordis.patch.yml', () => {
  const pkg = JSON.parse(read('package.json'))
  const declared = pkg.dsh?.bundle?.patch
  assert.equal(declared, './cordis.patch.yml')
  assert.equal(path.posix.normalize(declared), 'cordis.patch.yml')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'the patch file must be published')
  const patchPath = path.join(ROOT, declared)
  assert.equal(existsSync(patchPath), true)

  // Same shape loadOverlayPatches accepts: a top-level YAML array of mappings,
  // here one insert row naming this package so Node resolves the installed module.
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^-\s+insert:\s*$/m)
  assert.match(patch, /^\s+-\s+id:\s+deepseek-pricing\s*$/m)
  assert.match(patch, /^\s+name:\s+dsh-deepseek-pricing\s*$/m)
  assert.equal(pkg.name, 'dsh-deepseek-pricing')
})

test('public copy states the bundled rate card and 2026-only holiday scope', () => {
  const pkg = JSON.parse(read('package.json'))
  const readme = read('README.md')
  const tool = read('index.js')
  const checked = DATA_METADATA.pricing_checked_on
  assert.equal(checked, '2026-10-15')
  assert.deepEqual(DATA_METADATA.holiday_years, [2026])

  for (const text of [pkg.description, readme, tool]) {
    assert.match(text, new RegExp(checked))
    assert.doesNotMatch(text, /live prices|live list prices/)
  }
  assert.match(pkg.description, /[Bb]undled rate card/)
  assert.match(pkg.description, /2026 only/)
  assert.match(readme, /declares `dsh\.bundle\.patch`/)
  assert.match(readme, /包内声明了 `dsh\.bundle\.patch`/)
  assert.match(readme, /bundled rate card/)
  assert.match(readme, /covers \*\*2026 only\*\*/)
  assert.match(readme, /内置价目表/)
  assert.match(readme, /只覆盖 2026 年/)
  assert.match(tool, /bundled rate card/)
  assert.match(tool, /covers 2026 only/)
  assert.match(tool, /not fetched live/)
})
