// The radar's value model. Every number comes from the snapshot itself; no protocol name is ever
// special-cased, and the same function scores every row.
//
//   1. Calibrate. Take the protocols whose token already trades (a CoinGecko id and a market cap),
//      drop exchanges (their market cap prices an exchange business, not on-chain TVL) and merge
//      protocols sharing one token (a V2 and a V3 under one ticker count once, against their summed
//      TVL). Fit log10(mcap) = a + b*log10(tvl) + g*growth by robust (Huber) least squares.
//   2. Category. Each category's mean residual, shrunk toward its family's, the family's shrunk toward
//      zero (n / (n + K)): a category with few traded tokens moves the value little.
//   3. Growth. The fitted growth slope g, shrunk toward a stated prior by its standard error.
//   4. Tokenless runtime. A young protocol has proven less: track = T0 + (1 - T0)(1 - e^(-age/TAU)).
//
//   implied = 10^(a + b*log10(tvl) + category + g*clamp(change_7d)) * track
//   band    = implied x/÷ 10^scale  (the fit's robust residual scale: roughly a 68% band)

import { fitHuber, shrink, type Fit } from './fit.ts';
import { farmPlan, type FarmPlan } from './farm.ts';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The stated constants. Everything else in the model is fitted from the snapshot. */
export const MODEL = {
  version: 'radar-fit-2',
  growth_clamp_pct: 50, // a seven-day change past +/-50% is read as +/-50%
  growth_prior: 0.5, // prior log10 slope per 100% weekly TVL change (+10% a week -> x1.12)
  growth_prior_sd: 0.5,
  shrink_k: 4, // pseudo-count pulling category and family residuals toward their parent
  category_cap_dex: 0.5, // a category moves value by at most x/÷ 10^0.5 (about 3.2x)
  track_floor: 0.55, // a protocol listed today is worth 55% of a seasoned one
  track_tau_days: 365, // e-folding time of the tokenless-runtime discount
  unknown_age_days: 365,
};

/** Category families: categories grouped by what a user does in them, so thin categories borrow strength. */
const FAMILIES: [string, string[]][] = [
  ['Vaults', ['risk curators', 'onchain capital allocator', 'yield aggregator', 'yield', 'liquidity manager', 'leveraged farming', 'farm', 'options vault', 'indexes']],
  ['Lending', ['lending', 'cdp', 'cdp manager', 'uncollateralized lending', 'collateral management', 'collateral markets']],
  ['Stables', ['basis trading', 'stablecoin wrapper', 'stablecoin issuer', 'dual-token stablecoin', 'algo-stables', 'reserve currency']],
  ['Trading', ['dexs', 'derivatives', 'options', 'synthetics', 'prediction market', 'interest rate derivatives', 'otc marketplace', 'nft marketplace']],
  ['RWA', ['rwa', 'cedefi', 'crypto card issuer', 'payments']],
  ['Staking', ['staking pool', 'restaking', 'liquid staking', 'liquid restaking', 'restaked btc', 'anchor btc', 'decentralized btc']],
  ['Infra', ['bridge', 'canonical bridge', 'cross chain bridge', 'chain', 'privacy', 'dor']],
];

export function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  for (const [family, cats] of FAMILIES) if (cats.includes(c)) return family;
  return 'Other';
}

/** The house's exclusion rules bar the floor: what makes a protocol a product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export const recordsNoToken = (p: SnapshotProtocol): boolean => p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
export const tokenTrades = (p: SnapshotProtocol): boolean => p.gecko_id !== null && p.mcap_usd !== null && p.mcap_usd > 0;

/** A protocol the radar may rank: no token recorded, and not a wrapped, staked, bridged or versioned product. */
export function isRadarCandidate(p: SnapshotProtocol): boolean {
  return (
    recordsNoToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !DERIVATIVE_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const DAY_MS = 86_400_000;
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clampGrowth = (pct: number | null): number => Math.max(-MODEL.growth_clamp_pct, Math.min(MODEL.growth_clamp_pct, pct ?? 0)) / 100;
const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One traded token, its protocols merged: the calibration set's row. */
export interface Traded {
  slug: string;
  name: string;
  symbol: string;
  category: string | null;
  family: string;
  members: number;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  predicted_usd: number;
}

export interface Calibration {
  a: number;
  b: number;
  g_fit: number;
  g_se: number;
  g: number;
  scale: number;
  rmse: number;
  r2: number;
  n: number;
  excluded_exchanges: number;
  merged_protocols: number;
  family_adj: Record<string, { adj: number; n: number }>;
  category_adj: Record<string, { adj: number; n: number }>;
  traded: Traded[];
}

/** Step 1-3: fit the market's price of TVL over the protocols whose token trades. */
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter(tokenTrades);
  const exchanges = live.filter((p) => p.category === 'CEX').length;
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of live) if (p.category !== 'CEX' && p.tvl_usd > 0) (groups.get(p.gecko_id!) ?? groups.set(p.gecko_id!, []).get(p.gecko_id!)!).push(p);
  const tokens = [...groups.entries()]
    .sort((x, y) => byText(x[0], y[0]))
    .map(([, ps]) => {
      const lead = [...ps].sort((x, y) => y.tvl_usd - x.tvl_usd || byText(x.slug, y.slug))[0]!;
      const tvl = ps.reduce((s, p) => s + p.tvl_usd, 0);
      const known = ps.filter((p) => p.change_7d !== null);
      const ch = known.length ? known.reduce((s, p) => s + p.change_7d! * p.tvl_usd, 0) / Math.max(1, known.reduce((s, p) => s + p.tvl_usd, 0)) : null;
      return { lead, ps, tvl, mcap: Math.max(...ps.map((p) => p.mcap_usd!)), ch };
    });
  const X = tokens.map((t) => [1, Math.log10(t.tvl), clampGrowth(t.ch)]);
  const y = tokens.map((t) => Math.log10(t.mcap));
  const fit: Fit = fitHuber(X, y);
  const [a, b, gFit] = fit.coef as [number, number, number];
  const g = shrink(gFit, fit.se[2]!, MODEL.growth_prior, MODEL.growth_prior_sd);

  // Category adjustment: residuals of the size-only line (growth is scored separately).
  const res = tokens.map((t, i) => y[i]! - (a + b * Math.log10(t.tvl) + gFit * X[i]![2]!));
  const K = MODEL.shrink_k;
  const cap = MODEL.category_cap_dex;
  const fam: Record<string, { sum: number; n: number }> = {};
  const cat: Record<string, { sum: number; n: number; family: string }> = {};
  tokens.forEach((t, i) => {
    const f = familyOf(t.lead.category);
    const c = t.lead.category ?? 'Uncategorised';
    (fam[f] ??= { sum: 0, n: 0 }).sum += res[i]!;
    fam[f]!.n++;
    (cat[c] ??= { sum: 0, n: 0, family: f }).sum += res[i]!;
    cat[c]!.n++;
  });
  const clampAdj = (v: number): number => r4(Math.max(-cap, Math.min(cap, v)));
  const family_adj: Calibration['family_adj'] = {};
  for (const [f, s] of Object.entries(fam).sort((x, y) => byText(x[0], y[0]))) family_adj[f] = { adj: clampAdj(s.sum / (s.n + K)), n: s.n };
  const category_adj: Calibration['category_adj'] = {};
  for (const [c, s] of Object.entries(cat).sort((x, y) => byText(x[0], y[0]))) {
    const parent = family_adj[s.family]!.adj;
    category_adj[c] = { adj: clampAdj(parent + (s.sum - s.n * parent) / (s.n + K)), n: s.n };
  }

  const traded: Traded[] = tokens
    .map((t, i) => ({
      slug: t.lead.slug,
      name: t.lead.name,
      symbol: t.lead.symbol ?? '',
      category: t.lead.category,
      family: familyOf(t.lead.category),
      members: t.ps.length,
      tvl_usd: t.tvl,
      mcap_usd: t.mcap,
      change_7d: t.ch === null ? null : r4(t.ch),
      predicted_usd: Math.round(10 ** (a + b * Math.log10(t.tvl) + g * X[i]![2]!)),
    }))
    .sort((x, y) => y.mcap_usd - x.mcap_usd || byText(x.slug, y.slug));
  return {
    a: r4(a), b: r4(b), g_fit: r4(gFit), g_se: r4(fit.se[2]!), g: r4(g),
    scale: r4(fit.scale), rmse: r4(fit.rmse), r2: r4(fit.r2), n: fit.n,
    excluded_exchanges: exchanges,
    merged_protocols: live.length - exchanges - tokens.length,
    family_adj, category_adj, traded,
  };
}

/** The value of one protocol, broken into the steps the dashboard shows as a waterfall. */
export interface Valuation {
  fair_usd: number; // the fitted line at its TVL
  category_adj: number; // log10 shift
  category_source: string; // 'category', 'family' or 'none'
  growth_adj: number; // log10 shift
  track_mult: number;
  age_days: number | null;
  implied_usd: number;
  low_usd: number;
  high_usd: number;
}

export function value(p: SnapshotProtocol, cal: Calibration, asOf: string): Valuation {
  const lineLog = cal.a + cal.b * Math.log10(Math.max(1, p.tvl_usd));
  const c = p.category ?? 'Uncategorised';
  const f = familyOf(p.category);
  const [catAdj, source] = cal.category_adj[c] ? [cal.category_adj[c]!.adj, 'category'] : cal.family_adj[f] ? [cal.family_adj[f]!.adj, 'family'] : [0, 'none'];
  const growthAdj = cal.g * clampGrowth(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const track = MODEL.track_floor + (1 - MODEL.track_floor) * (1 - Math.exp(-(age ?? MODEL.unknown_age_days) / MODEL.track_tau_days));
  const implied = 10 ** (lineLog + catAdj + growthAdj) * track;
  const band = 10 ** cal.scale;
  return {
    fair_usd: Math.round(10 ** lineLog),
    category_adj: r4(catAdj),
    category_source: source,
    growth_adj: r4(growthAdj),
    track_mult: r4(track),
    age_days: age,
    implied_usd: Math.max(1, Math.min(1e14, Math.round(implied))),
    low_usd: Math.max(1, Math.round(implied / band)),
    high_usd: Math.max(1, Math.round(implied * band)),
  };
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'no token recorded';
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  valuation: Valuation;
  farm: FarmPlan;
  farm_steps: string[];
}

/** The ranked board: every watchlist slug, then every other radar candidate, by implied value. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRadarCandidate(p));
  const scored = chosen.map((p) => ({ p, v: value(p, cal, snapshot.as_of) }));
  scored.sort((x, y) => y.v.implied_usd - x.v.implied_usd || byText(x.p.slug, y.p.slug));
  return scored.map(({ p, v }, i) => {
    const farm = farmPlan(p, v, familyOf(p.category));
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      family: familyOf(p.category),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      token_status: 'no token recorded',
      watchlist: watch.has(p.slug),
      implied_value_usd: v.implied_usd,
      implied_low_usd: v.low_usd,
      implied_high_usd: v.high_usd,
      valuation: v,
      farm,
      farm_steps: farm.steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`),
    };
  });
}

/** Why a board is not one the gate takes, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  if (board.length < 100 || board.length > 4000) return `${board.length} rows`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `misses watchlist slugs ${missing.slice(0, 5).join(', ')}`;
  for (const [i, r] of board.entries()) {
    if (!known.has(r.slug) || /\s/.test(r.slug)) return `unknown slug ${r.slug}`;
    if (r.rank !== i + 1) return `rank ${r.rank} at row ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug} outranks the row above`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} step of ${s.trim().length} chars`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every implied value is the same';
  return null;
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text) as Snapshot;
  if (typeof o !== 'object' || o === null || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot.json is not the radar snapshot');
  const protocols = o.protocols
    .filter((p) => p && typeof p.slug === 'string' && typeof p.name === 'string' && Number.isFinite(p.tvl_usd))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    }));
  return { as_of: String(o.as_of), source: String(o.source), floor_usd: Number(o.floor_usd), protocols, watchlist: o.watchlist.filter((s) => typeof s === 'string') };
}
