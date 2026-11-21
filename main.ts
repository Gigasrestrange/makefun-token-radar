// Token Radar: make.fun token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), calibrates the value model
// on the protocols whose token already trades (lib/model.ts), ranks every protocol that records no
// token by implied value, writes a farm plan for each (lib/farm.ts), then writes:
//   /output/board.json    the ranked board the gate reads
//   /output/data.js       the same board, compact, for the static dashboard (no fetch, no network)
//   /output/dashboard/    the page;  /output/screenshots/  its three captures
//   /output/dossier.json  written last by the vendored make.fun library
// Outside the grader, MAKEFUN_OUTPUT_DIR (or --output) stands in for /output. Output is deterministic.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, boardIssue, buildBoard, calibrate, parseSnapshot, recordsNoToken, type BoardRow, type Calibration, type Snapshot } from './lib/model.ts';
import { FARM } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(msg: string): never {
  process.stderr.write(`token radar: ${msg}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|dir>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const cal: Calibration = calibrate(snapshot);
const board: BoardRow[] = buildBoard(snapshot, cal);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, model: MODEL.version, calibration: { ...cal, traded: undefined }, rows: board })}\n`);

/** The dashboard's dataset: arrays, not objects, to keep data.js small. Column names travel with it. */
const data = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  universe: snapshot.protocols.length,
  no_token: snapshot.protocols.filter(recordsNoToken).length,
  watchlist: snapshot.watchlist.length,
  model: MODEL,
  farm: FARM,
  fit: { ...cal, traded: undefined },
  rowCols: ['rank', 'slug', 'name', 'category', 'family', 'chains', 'tvl', 'ch7', 'listed', 'age', 'wl', 'implied', 'low', 'high', 'fair', 'catAdj', 'catSrc', 'growthAdj', 'track', 'chain', 'gas', 'fees', 'idle', 'minutes', 'apr', 'drop', 'net', 'verdict', 'kyc', 'steps'],
  rows: board.map((r) => [
    r.rank, r.slug, r.name, r.category, r.family, r.chains, r.tvl_usd, r.change_7d, r.listed_at, r.valuation.age_days, r.watchlist ? 1 : 0,
    r.implied_value_usd, r.implied_low_usd, r.implied_high_usd, r.valuation.fair_usd, r.valuation.category_adj, r.valuation.category_source,
    r.valuation.growth_adj, r.valuation.track_mult, r.farm.chain, r.farm.gas_per_tx, r.farm.fees_usd,
    Math.round((r.farm.total_cost_usd - r.farm.fees_usd) * 100) / 100, r.farm.active_minutes, r.farm.airdrop_apr, r.farm.drop_usd,
    r.farm.net_usd, r.farm.verdict, r.farm.kyc ? 1 : 0, r.farm.steps.map((s) => [s.action, s.cost, s.time]),
  ]),
  tradedCols: ['slug', 'name', 'symbol', 'category', 'family', 'members', 'tvl', 'mcap', 'ch7', 'pred'],
  traded: cal.traded.map((t) => [t.slug, t.name, t.symbol, t.category, t.family, t.members, t.tvl_usd, t.mcap_usd, t.change_7d, t.predicted_usd]),
};
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(data)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const page = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);

// Written last: the scorer rebuilds it from this directory and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const wl = board.filter((r) => r.watchlist).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols; fit on ${cal.n} traded tokens (log mcap = ${cal.a} + ${cal.b} log tvl, r2 ${cal.r2}, growth slope ${cal.g}); ` +
    `${board.length} rows ranked, ${wl}/${snapshot.watchlist.length} watchlist covered; dashboard ${page.length} files, ${shots.length} screenshots\n`,
);
