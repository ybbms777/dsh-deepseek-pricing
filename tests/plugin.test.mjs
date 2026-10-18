// Boots the plugin against the REAL harness packages (@deepseek-ai/cordis +
// @deepseek-ai/dsh-tools) instead of stubs, so this suite proves the plugin loads,
// registers and executes through the same pipeline DSH uses.
//
//   npm ci && node --test
//
// The only stand-in is the `systemPrompt` service the tool registry injects: DSH provides it,
// and here it is a two-method stub (tools()/section()) good enough for construction.
//
// 0.0.1-rc.1 exports that service as ToolRegistry. From 0.0.1-rc.5 onward, including
// the 0.2.0-rc.2 line, the same service is exported as ToolRuntime and still mounts
// on ctx.tools with register / schemas / execute.

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import * as dshTools from '@deepseek-ai/dsh-tools'

const ToolRegistry = dshTools.ToolRegistry ?? dshTools.ToolRuntime
if (typeof ToolRegistry !== 'function') {
  throw new Error('@deepseek-ai/dsh-tools exports neither ToolRegistry nor ToolRuntime')
}
import * as plugin from '../index.js'
import { DATA_METADATA } from '../tier.js'

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function systemPromptStub() {
  const calls = { tools: 0, section: 0, sections: [] }
  return {
    calls,
    tools() { calls.tools++ },
    section(text) { calls.section++; calls.sections.push(text); return '' },
  }
}

let ctx
let sp
const call = (args) => ctx.tools.execute({
  callId: 'test-' + Math.random().toString(36).slice(2, 8),
  name: 'deepseek_pricing_tier',
  arguments: args,
  signal: new AbortController().signal,
})

before(async () => {
  ctx = new Context()
  sp = systemPromptStub()
  ctx.provide('systemPrompt', sp)
  ctx.plugin(ToolRegistry, {})
  await delay(300)
  assert.ok(ctx.tools, 'ToolRegistry must expose ctx.tools')
  ctx.plugin(plugin)
  await delay(300)
})

test('the plugin declares the DSH contract (name + inject)', () => {
  assert.equal(plugin.name, 'dsh-deepseek-pricing')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('mounting registers exactly one tool and wires the prompt section', () => {
  const names = ctx.tools.schemas().map((s) => s.function?.name || s.name)
  assert.deepEqual(names, ['deepseek_pricing_tier'])
  assert.equal(sp.calls.tools, 1, 'registry asked systemPrompt for a tool section once')
})

test('model-facing schema keeps the declared parameters', () => {
  const s = ctx.tools.schemas()[0]
  const fn = s.function ?? s
  assert.equal(fn.name, 'deepseek_pricing_tier')
  const props = fn.parameters.properties
  assert.deepEqual(Object.keys(props).sort(), ['at', 'days', 'format'])
  assert.equal(props.format.enum.join(','), 'summary,json')
  assert.match(fn.description, /half price/)
  assert.match(fn.description, /bundled rate card/)
  assert.match(fn.description, new RegExp(DATA_METADATA.pricing_checked_on))
  assert.match(fn.description, /covers 2026 only/)
  assert.deepEqual(DATA_METADATA.holiday_years, [2026])
  assert.doesNotMatch(fn.description, /live list prices|live prices/)
})

test('peak window renders the full-price warning', async () => {
  const res = await call({ at: '2026-10-12T09:30:00+08:00' })
  assert.equal(res.isError, false)
  const text = res.content[0].text
  assert.match(text, /^PEAK — DeepSeek bills full price right now/)
  assert.match(text, /next switch: 2026-10-12 12:00:00/)
  assert.match(text, /today's peak windows: 09:00-12:00, 14:00-18:00 \(Beijing\)/)
  assert.match(text, /deepseek-flash: in\(cache miss\) 2 \/ out 8 RMB per 1M/)
  assert.match(text, new RegExp(`pricing checked ${DATA_METADATA.pricing_checked_on}`))
  assert.match(text, /holiday years 2026/)
})

test('lunch break renders the half-price case with the doubled-off rates', async () => {
  const res = await call({ at: '2026-10-12T12:30:00+08:00' })
  const text = res.content[0].text
  assert.match(text, /^OFF-PEAK — DeepSeek bills half price right now/)
  assert.match(text, /deepseek-flash: in\(cache miss\) 1 \/ out 4 RMB per 1M/)
  assert.match(text, /deepseek-v4-pro: in\(cache miss\) 4\.5 \/ out 13\.5 RMB per 1M/)
})

test('a public holiday is named as the reason', async () => {
  const res = await call({ at: '2026-10-02T10:00:00+08:00' })
  const text = res.content[0].text
  assert.match(text, /Chinese public holiday/)
  assert.match(text, /2026-10-08 09:00:00/)
})

test('format=json returns the canonical value, parseable', async () => {
  const res = await call({ at: '2026-10-12T12:30:00+08:00', format: 'json' })
  const value = JSON.parse(res.content[0].text)
  assert.equal(value.tier, 'off')
  assert.equal(value.off_peak, true)
  assert.equal(value.next_switch_beijing, '2026-10-12 14:00:00')
  assert.equal(value.prices_rmb_per_1m_tokens['deepseek-flash'].output, 4)
  assert.equal(value.prices_rmb_per_1m_tokens['deepseek-v4-pro'].model_version, 'DeepSeek-V4-Pro（0813 版）')
})

test('days>0 lists upcoming switches', async () => {
  const res = await call({ at: '2026-10-12T09:30:00+08:00', days: 1, format: 'json' })
  const value = JSON.parse(res.content[0].text)
  assert.deepEqual(value.upcoming_switches.slice(0, 3), [
    { at_beijing: '2026-10-12 12:00:00', to: 'off-peak (half price)' },
    { at_beijing: '2026-10-12 14:00:00', to: 'peak (full price)' },
    { at_beijing: '2026-10-12 18:00:00', to: 'off-peak (half price)' },
  ])
})

test('an unusable at value surfaces as a tool error, not a crash', async () => {
  const res = await call({ at: 'not-a-date' })
  assert.equal(res.isError, true)
  assert.match(res.content[0].text, /not a valid date/)
})

test('the tool declares itself concurrency-safe (read-only arithmetic)', async () => {
  const res = await call({ at: '2026-10-12T09:30:00+08:00' })
  assert.equal(res.isError, false)
})
