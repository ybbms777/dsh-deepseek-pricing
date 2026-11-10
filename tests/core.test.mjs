// The schedule rules, asserted against the generated core (tier.js).
// These mirror deepseek-pricing-panel's own suite — if the two ever disagree,
// `npm run sync:core` (and CI) catches it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tierAt, nextSwitch, daySegments, bj, HOLIDAYS, PRICES, MODEL_NAMES } from '../tier.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = (iso) => new Date(iso).getTime()
const bjISO = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 16)

test('tier.js is a generated file pinned to a panel commit', () => {
  const head = readFileSync(path.join(ROOT, 'tier.js'), 'utf8').split('\n').slice(0, 8).join('\n')
  assert.match(head, /GENERATED FILE — DO NOT EDIT BY HAND/)
  assert.match(head, /deepseek-pricing-panel @ [0-9a-f]{40}/)
  assert.match(head, /CORE sha256: [0-9a-f]{64}/)
})

test('peak windows are Beijing Mon-Fri 09:00-12:00 and 14:00-18:00', () => {
  assert.equal(tierAt(at('2026-10-12T08:59:59+08:00')), 'off')
  assert.equal(tierAt(at('2026-10-12T09:00:00+08:00')), 'peak')
  assert.equal(tierAt(at('2026-10-12T11:59:59+08:00')), 'peak')
  assert.equal(tierAt(at('2026-10-12T12:00:00+08:00')), 'off')
  assert.equal(tierAt(at('2026-10-12T14:00:00+08:00')), 'peak')
  assert.equal(tierAt(at('2026-10-12T18:00:00+08:00')), 'off')
  assert.deepEqual(daySegments(at('2026-10-12T09:30:00+08:00')), [{ h0: 9, h1: 12 }, { h0: 14, h1: 18 }])
})

test('weekends and Chinese public holidays are off-peak', () => {
  assert.equal(tierAt(at('2026-10-10T10:00:00+08:00')), 'off', 'Saturday')
  assert.equal(tierAt(at('2026-10-02T10:00:00+08:00')), 'off', 'National Day')
  assert.equal(tierAt(at('2026-02-17T15:00:00+08:00')), 'off', 'Spring Festival')
  assert.equal(tierAt(at('2026-10-08T10:00:00+08:00')), 'peak', 'first workday after Golden Week')
  assert.equal(HOLIDAYS.size, 33)
})

test('next switch is the next tier change, on the hour', () => {
  assert.equal(bjISO(nextSwitch(at('2026-10-10T10:56:00+08:00'))), '2026-10-12T09:00')
  assert.equal(bjISO(nextSwitch(at('2026-10-12T09:30:00+08:00'))), '2026-10-12T12:00')
  assert.equal(bjISO(nextSwitch(at('2026-10-07T10:00:00+08:00'))), '2026-10-08T09:00')
})

test('off-peak is exactly half of peak on every line', () => {
  for (const [model, v] of Object.entries(PRICES)) {
    for (const row of ['hit', 'miss', 'out']) {
      assert.equal(v[row][0] * 2, v[row][1], `${model}.${row}`)
    }
  }
  assert.equal(MODEL_NAMES['deepseek-flash'], 'DeepSeek-V4.1-Flash')
  assert.match(MODEL_NAMES['deepseek-v4-pro'], /V4-Pro/)
})

test('Beijing time is derived from the instant, not the host clock', () => {
  const p = bj(at('2026-10-12T01:00:00+08:00'))
  assert.equal(p.key, '2026-10-12')
  assert.equal(p.h, 1)
  assert.equal(p.wd, 1, 'Monday')
})

// Guard against the silent half-price bug: passing a Date (or an ISO string) used to make
// `ts + TZ` a string concatenation → Invalid Date → NaN fields → 'off', so a peak instant
// was reported as the half-price tier with no error and a wrong next_switch. Every entry
// point now throws TypeError on a non-finite instant; the number path is untouched.
test('a non-finite instant throws instead of silently reporting off-peak', () => {
  const peak = at('2026-11-10T09:30:00+08:00') // Tuesday, inside 09:00-12:00
  assert.equal(tierAt(peak), 'peak', 'the number path still answers peak')

  const bad = [
    ['Date', new Date(peak)],
    ['ISO string', '2026-11-10T09:30:00+08:00'],
    ['offset-less string', '2026-11-10T09:30'],
    ['undefined', undefined],
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ]
  for (const [label, value] of bad) {
    for (const [name, fn] of [['tierAt', tierAt], ['nextSwitch', nextSwitch], ['daySegments', daySegments], ['bj', bj]]) {
      assert.throws(() => fn(value), TypeError, `${name}(${label}) must throw TypeError`)
    }
  }
  assert.throws(() => tierAt(new Date(peak)), /tierAt expects a finite millisecond timestamp \(number\), got Date/)
})
