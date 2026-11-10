// D4 · parseInstant must reject an impossible calendar day instead of letting Date.parse roll
// it into the next month.
//
// Date.parse('2026-02-30T09:00:00+08:00') does not throw — it answers 2026-03-02 09:00 BJ.
// 2026-04-31 becomes 05-01, 2026-02-29 (non-leap) becomes 03-01, 2026-11-31 becomes 12-01.
// A different instant means a possibly different tier, reported with no error at all — the
// same class of silent wrong answer as the Date-object bug (see tests/core.test.mjs).
//
// Two guards in index.js: month 13/00 and minute 60 are already NaN for Date.parse, but
// day-of-month, hour 24 ("24:00" is another day) and sub-millisecond precision are not, so
// the components are validated, and then the parsed value is rendered back through the
// caller's own offset and compared character for character.
//
// The two positive cases below are guards against over-correction: a real leap day and a
// valid instant must keep working byte for byte.
//
// Originally written as the RED suite by @qa; landed here so it runs with the plugin.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInstant } from '../index.js'

const IMPOSSIBLE = [
  ['2026-02-30T09:00:00+08:00', 'February 2026 has 28 days'],
  ['2026-04-31T09:00:00+08:00', 'April has 30 days'],
  ['2026-06-31T09:00:00+08:00', 'June has 30 days'],
  ['2026-11-31T09:00:00+08:00', 'November has 30 days'],
  ['2026-11-00T09:00:00+08:00', 'day 00 does not exist'],
  ['2026-02-29T09:00:00+08:00', '2026 is not a leap year'],
  ['2027-02-29T09:00:00+08:00', '2027 is not a leap year'],
  ['2026-11-10T24:00:00+08:00', '24:00 belongs to the next day'],
  ['2026-11-10T09:30:00.1234+08:00', 'sub-millisecond precision would be dropped'],
]

for (const [value, why] of IMPOSSIBLE) {
  test(`parseInstant rejects ${value} (${why})`, () => {
    assert.throws(
      () => parseInstant(value),
      /at must be/,
      `${value} must be rejected, not rolled into another day`,
    )
  })
}

test('the error names the offending field, not just "invalid"', () => {
  assert.throws(() => parseInstant('2026-02-30T09:00:00+08:00'), /2026-02-30 does not exist \(2026-02 has 28 days\)/)
  assert.throws(() => parseInstant('2026-11-10T24:00:00+08:00'), /24:00:00 is not a clock time/)
})

test('parseInstant still accepts a real leap day', () => {
  assert.equal(parseInstant('2024-02-29T09:00:00+08:00'), Date.parse('2024-02-29T01:00:00Z'))
})

test('parseInstant keeps a valid instant byte-for-byte (no silent shift)', () => {
  const iso = '2026-11-10T09:30:00+08:00'
  const ms = parseInstant(iso)
  assert.equal(ms, Date.parse(iso))
  // Rendering back through the same offset must reproduce the input — this is also the
  // self-check of the round-trip guard added for D4.
  const back = new Date(ms + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00'
  assert.equal(back, iso)
})

test('accepted spellings of one instant still agree', () => {
  const target = Date.parse('2026-11-10T01:30:00Z')
  for (const ok of [
    '2026-11-10T01:30:00Z',
    '2026-11-10T09:30:00+08:00',
    '2026-11-10T09:30+08:00',
    '2026-11-09T20:30:00-05:00',
  ]) {
    assert.equal(parseInstant(ok), target, ok)
  }
})
