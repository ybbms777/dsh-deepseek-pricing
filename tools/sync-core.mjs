#!/usr/bin/env node
// Regenerate tier.js from the panel's own schedule core.
//
// The panel (deepseek-pricing-panel) owns the peak/off-peak rule; this plugin must not
// re-implement it. This script extracts the /*CORE-START*/ … /*CORE-END*/ block out of
// index.html at a pinned commit and writes it to tier.js verbatim, so there is exactly
// one implementation in the world and CI can prove the two never drift.
//
//   node tools/sync-core.mjs            # write tier.js from the pinned source
//   node tools/sync-core.mjs --check    # fail (exit 1) if tier.js is out of date
//   PANEL_SOURCE=<url|path> node tools/sync-core.mjs
//
// Pinned source is immutable: bump PANEL_PIN below and re-run.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'tier.js');

const PANEL_REPO = 'ybbms777/deepseek-pricing-panel';
const PANEL_PIN = 'a8ed932ed9e33b85b33038577a8b9932dbbce439';
const DEFAULT_SOURCE = `https://raw.githubusercontent.com/${PANEL_REPO}/${PANEL_PIN}/index.html`;

function readSource(spec) {
  if (/^https?:\/\//.test(spec)) {
    return fetch(spec).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${spec}`);
      return r.text();
    });
  }
  if (!existsSync(spec)) throw new Error('local source not found: ' + spec);
  return Promise.resolve(readFileSync(spec, 'utf8'));
}

function extractCore(html) {
  const after = html.split('/*CORE-START*/')[1];
  if (!after) throw new Error('no /*CORE-START*/ marker in the panel source');
  const core = after.split('/*CORE-END*/')[0];
  if (!core || !core.includes('isPeakHour')) throw new Error('CORE block looks empty');
  return core.trim();
}

function compose(core, source, sha256) {
  return `// GENERATED FILE — DO NOT EDIT BY HAND.
// The peak/off-peak rule lives in one place: the panel's index.html CORE block.
// Source: https://github.com/${PANEL_REPO} @ ${PANEL_PIN}
//         index.html${/^https?:/.test(source) ? '' : ` (local: ${source})`}
// CORE sha256: ${sha256}
// Regenerate: node tools/sync-core.mjs
${core}

const MODEL_NAMES = Object.fromEntries(Object.entries(PRICES).map(([m, v]) => [m, v.ver]));

export { tierAt, nextSwitch, daySegments, bj, HOLIDAYS, PRICES, MODEL_NAMES };
`;
}

const check = process.argv.includes('--check');
const source = process.env.PANEL_SOURCE || DEFAULT_SOURCE;

try {
  const html = await readSource(source);
  const core = extractCore(html);
  const sha256 = createHash('sha256').update(core).digest('hex');
  const next = compose(core, source, sha256);
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const size = Buffer.byteLength(next);

  if (check) {
    // Compare content, not line endings: a Windows checkout may rewrite LF to CRLF
    // (autocrlf), and a red CI badge on that basis teaches nobody anything. Real drift
    // — any byte outside the line-ending convention — still fails.
    const normalize = (s) => s.replace(/\r\n/g, '\n');
    if (normalize(current) !== normalize(next)) {
      console.error('tier.js is OUT OF DATE — run: node tools/sync-core.mjs');
      process.exit(1);
    }
    if (current !== next) {
      console.log('tier.js matches the pinned source (line endings differ: working copy is CRLF).');
    }
    console.log(`tier.js is up to date with ${PANEL_REPO}@${PANEL_PIN.slice(0, 7)} (CORE sha256 ${sha256.slice(0, 16)}…)`);
  } else {
    writeFileSync(OUT, next);
    console.log(`wrote tier.js (${size} bytes) from ${/^https?:/.test(source) ? source : source}`);
    console.log(`CORE sha256 ${sha256}`);
  }
} catch (e) {
  console.error('sync-core failed: ' + e.message);
  process.exit(2);
}
