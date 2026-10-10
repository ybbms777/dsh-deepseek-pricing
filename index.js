import { defineTool } from '@deepseek-ai/dsh-tools'
import { tierAt, nextSwitch, daySegments, bj, HOLIDAYS, PRICES, MODEL_NAMES } from './tier.js'

export const name = 'dsh-deepseek-pricing'
export const inject = ['tools']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MAX_DAYS = 14

const pad = (n) => String(n).padStart(2, '0')
const bjStamp = (p) => `${p.key} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`
const hhmm = (n) => `${pad(n)}:00`

function humanDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** Explain a tier from the calendar facts, not from the clock alone. */
function why(p, segs) {
  if (HOLIDAYS.has(p.key)) return 'Chinese public holiday'
  if (p.wd === 0 || p.wd === 6) return 'weekend'
  if (segs.length) return 'outside the weekday peak windows (Beijing 09:00-12:00, 14:00-18:00)'
  return 'weekday with no peak window today'
}

/**
 * Pure evaluation of one instant — the same arithmetic the panel performs, from the
 * same generated core (see tools/sync-core.mjs).
 */
export function evaluate(atMs, days = 0) {
  const tier = tierAt(atMs)
  const segs = daySegments(atMs)
  const p = bj(atMs)
  const nx = nextSwitch(atMs)
  const offPeak = tier === 'off'
  const idx = offPeak ? 0 : 1

  const prices = Object.fromEntries(
    Object.entries(PRICES).map(([model, v]) => [
      model,
      {
        model_version: v.ver,
        input_cache_hit: v.hit[idx],
        input_cache_miss: v.miss[idx],
        output: v.out[idx],
        concurrency_limit: v.conc,
      },
    ]),
  )

  const value = {
    evaluated_at_beijing: bjStamp(p),
    weekday: WEEKDAYS[p.wd],
    tier,
    off_peak: offPeak,
    reason: why(p, segs),
    today_peak_windows: segs.map((s) => `${hhmm(s.h0)}-${hhmm(s.h1)}`),
    next_switch_beijing: nx ? bjStamp(bj(nx)) : '',
    seconds_until_switch: nx ? Math.max(0, Math.floor((nx - atMs) / 1000)) : -1,
    next_switch_to: nx ? (tierAt(nx) === 'peak' ? 'peak (full price)' : 'off-peak (half price)') : '',
    prices_rmb_per_1m_tokens: prices,
    upcoming_switches: [],
  }

  if (days > 0) {
    let t = atMs
    for (let i = 0; i < days * 3 + 1; i++) {
      const n = nextSwitch(t)
      if (!n) break
      value.upcoming_switches.push({
        at_beijing: bjStamp(bj(n)),
        to: tierAt(n) === 'peak' ? 'peak (full price)' : 'off-peak (half price)',
      })
      t = n
      if (value.upcoming_switches.length >= days * 3) break
    }
  }

  return value
}

const priceProperties = Object.fromEntries(
  Object.keys(PRICES).map((m) => [
    m,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        model_version: { type: 'string' },
        input_cache_hit: { type: 'number' },
        input_cache_miss: { type: 'number' },
        output: { type: 'number' },
        concurrency_limit: { type: 'integer' },
      },
    },
  ]),
)

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'deepseek_pricing_tier',
    description:
      'Report whether the DeepSeek API is billing at peak (full price) or off-peak ' +
      '(exactly half price) right now, plus the next peak/off-peak switch time in ' +
      'Beijing time and the live list prices per 1M tokens. Peak hours are Beijing ' +
      '(UTC+8) Monday-Friday 09:00-12:00 and 14:00-18:00, excluding Chinese public ' +
      'holidays; every other instant, including all weekends and holidays, is ' +
      'off-peak. Use it before scheduling DeepSeek batch work: the same tokens cost ' +
      'twice as much inside a peak window.',
    parameters: {
      at: {
        type: 'string',
        description:
          'ISO-8601 instant to evaluate, e.g. "2026-10-12T09:30:00+08:00". Defaults to now.',
      },
      days: {
        type: 'integer',
        default: 0,
        description:
          `When greater than 0, also list the upcoming switches (about ${MAX_DAYS} days max).`,
      },
      format: {
        type: 'string',
        enum: ['summary', 'json'],
        default: 'summary',
        description: 'summary renders compact text; json returns the canonical value as JSON.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evaluated_at_beijing: { type: 'string', description: 'Beijing wall clock of the evaluation instant.' },
          weekday: { type: 'string' },
          tier: { type: 'string', enum: ['off', 'peak'] },
          off_peak: { type: 'boolean' },
          reason: { type: 'string' },
          today_peak_windows: { type: 'array', items: { type: 'string' } },
          next_switch_beijing: { type: 'string', description: 'Empty when no switch was found within 15 days.' },
          seconds_until_switch: { type: 'integer', description: '-1 when no switch was found within 15 days.' },
          next_switch_to: { type: 'string' },
          prices_rmb_per_1m_tokens: {
            type: 'object',
            additionalProperties: false,
            properties: priceProperties,
          },
          upcoming_switches: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at_beijing: { type: 'string' },
                to: { type: 'string' },
              },
            },
          },
        },
      },
      render(args, value) {
        if (args.format === 'json') {
          return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
        }
        const lines = [
          value.off_peak
            ? 'OFF-PEAK — DeepSeek bills half price right now'
            : 'PEAK — DeepSeek bills full price right now',
          `now (Beijing): ${value.evaluated_at_beijing} (${value.weekday}) — ${value.reason}`,
          `today's peak windows: ${value.today_peak_windows.length ? value.today_peak_windows.join(', ') + ' (Beijing)' : 'none'}`,
        ]
        if (value.next_switch_beijing) {
          lines.push(`next switch: ${value.next_switch_beijing} → ${value.next_switch_to} (in ${humanDuration(value.seconds_until_switch * 1000)})`)
        }
        for (const [model, v] of Object.entries(value.prices_rmb_per_1m_tokens)) {
          lines.push(`${model}: in(cache miss) ${v.input_cache_miss} / out ${v.output} RMB per 1M — ${v.model_version}, concurrency ${v.concurrency_limit}`)
        }
        if (value.upcoming_switches.length) {
          lines.push('upcoming switches:')
          for (const s of value.upcoming_switches) lines.push(`  ${s.at_beijing} → ${s.to}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const atMs = args.at ? new Date(args.at).getTime() : Date.now()
      if (Number.isNaN(atMs)) throw new Error(`at is not a valid date: ${args.at}`)
      const days = Math.max(0, Math.min(MAX_DAYS, Number(args.days ?? 0)))
      return evaluate(atMs, days)
    },
  }))

  // Mount-time self-test against the generated core, mirroring the panel's CI cases.
  console.log('[dsh-deepseek-pricing] plugin loaded')
  const cases = [
    ['2026-10-12T09:30:00+08:00', 'peak'],
    ['2026-10-12T12:30:00+08:00', 'off'],
    ['2026-10-02T10:00:00+08:00', 'off'],
    ['2026-10-10T10:00:00+08:00', 'off'],
  ]
  for (const [iso, expected] of cases) {
    const got = evaluate(new Date(iso).getTime(), 0).tier
    console.log(
      `[dsh-deepseek-pricing] self-test ${iso} -> ${got} (expected ${expected}) ` +
      `${got === expected ? '[ok]' : '[FAIL]'}`,
    )
  }
}
