// Token Radar dashboard: a static page over window.RADAR (data.js, written by main.ts). No network.
// State lives in the URL hash (#view=board&fam=Lending&p=slug...), so every view can be linked.
(function () {
  'use strict';
  const R = window.RADAR;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const zip = (cols, rows) => rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const rows = zip(R.rowCols, R.rows);
  const traded = zip(R.tradedCols, R.traded);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const fit = R.fit;

  // ---------- formatting
  function money(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(2);
  }
  const pct = (n, d = 1) => (n === null || n === undefined ? '–' : (n > 0 ? '+' : '') + n.toFixed(d) + '%');
  const mult = (dex) => '×' + Math.pow(10, dex).toFixed(2);
  const days = (d) => (d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d');
  const famColor = { Vaults: 'f1', Lending: 'f2', Stables: 'f3', Trading: 'f4', RWA: 'f5', Staking: 'f6', Infra: 'f7', Other: 'f8' };

  // ---------- state <-> hash
  const DEF = { view: 'board', q: '', fam: '', chain: '', scope: 'all', verdict: '', grow: '', sort: 'rank', dir: 'asc', p: '' };
  let S = { ...DEF };
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    S = { ...DEF };
    for (const k of Object.keys(DEF)) if (h.has(k)) S[k] = h.get(k);
  }
  function set(patch) {
    S = { ...S, ...patch };
    const h = new URLSearchParams();
    for (const k of Object.keys(DEF)) if (S[k] !== DEF[k]) h.set(k, S[k]);
    history.replaceState(null, '', '#' + h.toString());
    render();
  }
  window.addEventListener('hashchange', () => { readHash(); render(); });

  // ---------- filtering and sorting
  const chainCount = {};
  rows.forEach((r) => r.chains.forEach((c) => (chainCount[c] = (chainCount[c] || 0) + 1)));
  const topChains = Object.entries(chainCount).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 14).map((e) => e[0]);
  const families = [...new Set(rows.map((r) => r.family))].sort();
  const VERDICTS = ['Prime', 'Worth it', 'Marginal', 'Skip'];

  function filtered() {
    const q = S.q.trim().toLowerCase();
    const fams = S.fam ? S.fam.split(',') : [];
    let out = rows.filter((r) =>
      (!q || r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || r.chains.join(' ').toLowerCase().includes(q)) &&
      (!fams.length || fams.includes(r.family)) &&
      (!S.chain || r.chains.includes(S.chain)) &&
      (S.scope === 'all' || (S.scope === 'watch' ? r.wl : !r.wl)) &&
      (!S.verdict || r.verdict === S.verdict) &&
      (!S.grow || (S.grow === 'up' ? r.ch7 > 0 : r.ch7 !== null && r.ch7 < 0)));
    const k = S.sort, sgn = S.dir === 'asc' ? 1 : -1;
    const key = { rank: (r) => r.rank, name: (r) => r.name.toLowerCase(), tvl: (r) => r.tvl, ch7: (r) => r.ch7 ?? -1e9, age: (r) => r.age ?? -1, implied: (r) => r.implied, ratio: (r) => r.implied / r.tvl, apr: (r) => r.apr, net: (r) => r.net }[k] || ((r) => r.rank);
    out.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sgn || a.rank - b.rank; });
    return out;
  }

  // ---------- header pieces
  function renderTabs() {
    const t = [['board', 'Pre-token board', rows.length], ['traded', 'Calibration set', traded.length], ['model', 'The model', null]];
    $('tabs').innerHTML = t.map(([v, label, n]) => `<button class="tab${S.view === v ? ' on' : ''}" data-view="${v}" aria-pressed="${S.view === v}">${label}${n ? ` <span>${n}</span>` : ''}</button>`).join('');
  }
  function renderStats() {
    const wl = rows.filter((r) => r.wl).length;
    const top = rows[0];
    const prime = rows.filter((r) => r.verdict === 'Prime' || r.verdict === 'Worth it').length;
    const cells = [
      ['Watchlist covered', `${wl}<small>/${R.watchlist}</small>`, `all ≥ ${money(R.floor_usd)} with no token`],
      ['Ranked protocols', rows.length, `${rows.length - wl} more found below the floor`],
      ['Market line', `${fit.b.toFixed(2)}<small> TVL elasticity</small>`, `fitted on ${fit.n} traded tokens`],
      ['Top implied value', money(top.implied), esc(top.name)],
      ['Plans that pay', `${prime}<small>/${rows.length}</small>`, 'drop beats fees + idle yield'],
      ['Snapshot', esc(R.as_of), 'sealed DefiLlama protocol list'],
    ];
    $('stats').innerHTML = cells.map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  }

  // ---------- sidebar
  function renderSide() {
    if (S.view !== 'board') { $('side').innerHTML = modelCard(); return; }
    const fams = S.fam ? S.fam.split(',') : [];
    $('side').innerHTML = `
      <div class="card">
        <label class="lbl" for="q">Search</label>
        <input id="q" type="search" placeholder="Name, category or chain" value="${esc(S.q)}" autocomplete="off">
        <div class="lbl">Family</div>
        <div class="chips">${families.map((f) => `<button class="chip ${famColor[f]}${fams.includes(f) ? ' on' : ''}" data-fam="${f}" aria-pressed="${fams.includes(f)}">${f}</button>`).join('')}</div>
        <div class="lbl">Scope</div>
        <div class="seg">${[['all', 'All'], ['watch', 'Watchlist'], ['early', 'Below floor']].map(([v, l]) => `<button data-scope="${v}" class="${S.scope === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row2">
          <div><label class="lbl" for="chain">Chain</label><select id="chain"><option value="">Any chain</option>${topChains.map((c) => `<option${S.chain === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div><label class="lbl" for="verdict">Farm verdict</label><select id="verdict"><option value="">Any</option>${VERDICTS.map((v) => `<option${S.verdict === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <div class="lbl">7-day TVL</div>
        <div class="seg">${[['', 'Any'], ['up', 'Rising'], ['down', 'Falling']].map(([v, l]) => `<button data-grow="${v}" class="${S.grow === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="reset" id="reset">Reset filters</button>
      </div>${modelCard()}`;
  }
  function modelCard() {
    return `<div class="card model">
      <div class="lbl">How a value is made</div>
      ${scatter(248, 132, null, true)}
      <ol class="recipe">
        <li><b>Market line.</b> Fitted on ${fit.n} traded tokens: ${fit.b.toFixed(2)} decades of market cap per decade of TVL.</li>
        <li><b>Category.</b> Mean residual of its category, shrunk to its family (k=${R.model.shrink_k}), capped ${mult(R.model.category_cap_dex)}.</li>
        <li><b>Growth.</b> 10^(${fit.g.toFixed(2)} × 7-day change), change clamped ±${R.model.growth_clamp_pct}%.</li>
        <li><b>Tokenless runtime.</b> ${R.model.track_floor} + ${(1 - R.model.track_floor).toFixed(2)}·(1 − e<sup>−age/${R.model.track_tau_days}</sup>).</li>
      </ol>
      <p class="fine">Band: ×/÷ ${Math.pow(10, fit.scale).toFixed(1)} (robust residual scale). A value is the board's claim on the snapshot's figures, not a forecast of a launch.</p>
    </div>`;
  }

  // ---------- scatter: traded tokens, the fitted line and band, pre-token implied values
  function scatter(w, h, hi, mini) {
    const xs = traded.map((t) => Math.log10(t.tvl)).concat(rows.map((r) => Math.log10(r.tvl)));
    const ys = traded.map((t) => Math.log10(t.mcap)).concat(rows.map((r) => Math.log10(r.implied)));
    const x0 = Math.floor(Math.min(...xs) * 2) / 2, x1 = Math.ceil(Math.max(...xs) * 2) / 2;
    const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    const pad = mini ? 6 : 34, padB = mini ? 6 : 26;
    const X = (v) => pad + ((v - x0) / (x1 - x0)) * (w - pad - 6);
    const Y = (v) => h - padB - ((v - y0) / (y1 - y0)) * (h - padB - 6);
    const line = (dx) => `${X(x0)},${Y(fit.a + fit.b * x0 + dx)} ${X(x1)},${Y(fit.a + fit.b * x1 + dx)}`;
    let g = `<polygon class="band" points="${line(fit.scale)} ${X(x1)},${Y(fit.a + fit.b * x1 - fit.scale)} ${X(x0)},${Y(fit.a + fit.b * x0 - fit.scale)}"/>`;
    if (!mini) {
      for (let v = Math.ceil(x0); v <= x1; v++) g += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="6" y2="${h - padB}"/><text class="ax" x="${X(v)}" y="${h - 8}" text-anchor="middle">${money(Math.pow(10, v))}</text>`;
      for (let v = y0; v <= y1; v++) g += `<line class="grid" y1="${Y(v)}" y2="${Y(v)}" x1="${pad}" x2="${w - 6}"/><text class="ax" x="${pad - 5}" y="${Y(v) + 3}" text-anchor="end">${money(Math.pow(10, v))}</text>`;
    }
    g += `<polyline class="fitline" points="${line(0)}"/>`;
    g += traded.map((t) => `<circle class="tok" cx="${X(Math.log10(t.tvl)).toFixed(1)}" cy="${Y(Math.log10(t.mcap)).toFixed(1)}" r="${mini ? 1.8 : 3}"><title>${esc(t.name)}: ${money(t.mcap)} cap on ${money(t.tvl)} TVL</title></circle>`).join('');
    g += rows.map((r) => `<rect class="pre${r.wl ? ' wl' : ''}" x="${(X(Math.log10(r.tvl)) - (mini ? 1.6 : 2.6)).toFixed(1)}" y="${(Y(Math.log10(r.implied)) - (mini ? 1.6 : 2.6)).toFixed(1)}" width="${mini ? 3.2 : 5.2}" height="${mini ? 3.2 : 5.2}"><title>${esc(r.name)}: implied ${money(r.implied)}</title></rect>`).join('');
    if (hi) {
      const cx = X(Math.log10(hi.tvl)), cy = Y(Math.log10(hi.implied));
      g += `<circle class="hi" cx="${cx}" cy="${cy}" r="7"/><text class="hil" x="${cx + (cx > w * 0.7 ? -11 : 11)}" y="${cy - 9}" text-anchor="${cx > w * 0.7 ? 'end' : 'start'}">${esc(hi.name)}</text>`;
    }
    return `<svg class="scatter" viewBox="0 0 ${w} ${h}" role="img" aria-label="Market cap against TVL: traded tokens as dots, the fitted line, and pre-token implied values as squares">${g}</svg>
      <div class="legend"><span><i class="dot"></i>${mini ? 'traded' : 'token trades'}</span><span><i class="sq"></i>${mini ? 'implied' : 'no token: implied'}</span><span><i class="sq wl"></i>watchlist</span></div>`;
  }

  // ---------- the board
  const COLS = [
    ['rank', '#', 'num'], ['name', 'Protocol', ''], ['tvl', 'TVL', 'num'], ['ch7', '7d', 'num'], ['age', 'Tokenless', 'num wide'],
    ['implied', 'Implied value', 'num'], ['ratio', '÷ TVL', 'num wide'], ['apr', 'Drop yield', 'num'], ['net', 'Farm plan', 'num'],
  ];
  function bar(r) {
    const lo = Math.log10(rows[rows.length - 1].low), hi = Math.log10(rows[0].high);
    const P = (v) => (((Math.log10(v) - lo) / (hi - lo)) * 100).toFixed(1);
    return `<span class="vbar"><span class="band" style="left:${P(r.low)}%;width:${(P(r.high) - P(r.low)).toFixed(1)}%"></span><span class="pt" style="left:${P(r.implied)}%"></span></span>`;
  }
  function renderBoard() {
    const list = filtered();
    const head = COLS.map(([k, label, cls]) => {
      const on = S.sort === k;
      return `<th class="${cls}" aria-sort="${on ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button data-sort="${k}">${label}<i>${on ? (S.dir === 'asc' ? '▲' : '▼') : ''}</i></button></th>`;
    }).join('');
    const body = list.map((r) => `<tr data-slug="${esc(r.slug)}" class="${S.p === r.slug ? 'sel' : ''}" tabindex="0">
        <td class="num rank">${r.rank}</td>
        <td><div class="nm">${esc(r.name)}${r.wl ? '<span class="wlb" title="On the snapshot watchlist">WL</span>' : ''}</div><div class="meta"><i class="fd ${famColor[r.family]}"></i>${esc(r.category || 'Uncategorised')} · ${esc(r.chains.slice(0, 2).join(', '))}${r.chains.length > 2 ? ` +${r.chains.length - 2}` : ''}</div></td>
        <td class="num">${money(r.tvl)}</td>
        <td class="num ${r.ch7 > 0 ? 'up' : r.ch7 < 0 ? 'dn' : ''}">${pct(r.ch7)}</td>
        <td class="num wide">${days(r.age)}</td>
        <td class="num val"><b>${money(r.implied)}</b>${bar(r)}</td>
        <td class="num wide">${(r.implied / r.tvl).toFixed(2)}×</td>
        <td class="num">${(r.apr * 100).toFixed(1)}%</td>
        <td class="num"><span class="vd v${VERDICTS.indexOf(r.verdict)}">${r.verdict}</span><div class="meta">${money(r.fees)} fees</div></td>
      </tr>`).join('');
    const fams = S.fam ? S.fam.split(',') : [];
    const desc = [S.q && `“${esc(S.q)}”`, fams.length && fams.join(' + '), S.chain, S.scope === 'watch' ? 'watchlist' : S.scope === 'early' ? 'below the floor' : '', S.verdict && `verdict ${S.verdict}`, S.grow && (S.grow === 'up' ? 'TVL rising' : 'TVL falling')].filter(Boolean).join(' · ');
    const sum = list.reduce((s, r) => s + r.implied, 0);
    $('main').innerHTML = `<div class="tbar"><h2>${list.length === rows.length ? 'All protocols that record no token' : `${list.length} of ${rows.length} protocols`}</h2><span class="tdesc">${desc || 'ranked by implied value; click a row for its value breakdown and farm plan'}</span><span class="tsum">Σ implied ${money(sum)}</span></div>
      <div class="tablewrap"><table class="board"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>`}</tbody></table></div>`;
  }

  // ---------- calibration set
  function renderTraded() {
    const list = traded.slice().sort((a, b) => b.mcap - a.mcap);
    $('main').innerHTML = `<div class="tbar"><h2>Tokens that already trade</h2><span class="tdesc">The model's calibration set: ${fit.n} tokens (exchanges set aside; protocols sharing a token merged). Market cap is the market's value, not the model's.</span></div>
      <div class="tablewrap"><table class="board"><thead><tr><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">÷ TVL</th><th class="num">Line says</th><th class="num">Market vs line</th></tr></thead><tbody>${list.map((t) => {
      const res = Math.log10(t.mcap / t.pred);
      return `<tr><td><div class="nm">${esc(t.name)} <span class="sym">${esc(t.symbol)}</span></div></td><td><i class="fd ${famColor[t.family]}"></i>${esc(t.category || '–')}</td><td class="num">${money(t.tvl)}</td><td class="num"><b>${money(t.mcap)}</b></td><td class="num">${(t.mcap / t.tvl).toFixed(2)}×</td><td class="num">${money(t.pred)}</td><td class="num ${res > 0 ? 'up' : 'dn'}">${mult(res)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // ---------- model page
  function renderModel() {
    const cats = Object.entries(fit.category_adj).sort((a, b) => b[1].adj - a[1].adj);
    $('main').innerHTML = `<div class="tbar"><h2>The value model, fitted on this snapshot</h2><span class="tdesc">model ${esc(R.model.version)} · no protocol name appears in it</span></div>
      <div class="modelgrid"><div class="card">${scatter(640, 380, null, false)}
        <p class="fine">Robust (Huber) fit of log<sub>10</sub> market cap on log<sub>10</sub> TVL and 7-day growth over ${fit.n} traded tokens. R² ${fit.r2.toFixed(2)}, robust scale ${fit.scale.toFixed(2)} decades: TVL explains only part of a token's price, so every value carries a band of ×/÷ ${Math.pow(10, fit.scale).toFixed(1)}.</p></div>
      <div class="card"><div class="lbl">Fitted figures</div><table class="kv">
        <tr><td>Intercept a</td><td>${fit.a.toFixed(3)}</td></tr><tr><td>TVL elasticity b</td><td>${fit.b.toFixed(3)}</td></tr>
        <tr><td>Growth slope, fitted</td><td>${fit.g_fit.toFixed(3)} ± ${fit.g_se.toFixed(2)}</td></tr><tr><td>Growth slope, used (prior ${R.model.growth_prior} ± ${R.model.growth_prior_sd})</td><td>${fit.g.toFixed(3)}</td></tr>
        <tr><td>Exchanges set aside</td><td>${fit.excluded_exchanges}</td></tr><tr><td>Farm plan size</td><td>${money(R.farm.capital_usd)} for ${R.farm.hold_days} days</td></tr>
        <tr><td>Users' share of a token</td><td>${R.farm.user_share * 100}%</td></tr></table>
        <div class="lbl">Category shift (shrunk)</div><div class="cats">${cats.map(([c, v]) => `<div class="cat"><span>${esc(c)} <small>n=${v.n}</small></span><span class="cb"><span style="${v.adj >= 0 ? 'left:50%' : `left:${50 + (v.adj / R.model.category_cap_dex) * 50}%`};width:${(Math.abs(v.adj) / R.model.category_cap_dex) * 50}%" class="${v.adj >= 0 ? 'pos' : 'neg'}"></span></span><b>${mult(v.adj)}</b></div>`).join('')}</div></div></div>`;
  }

  // ---------- detail
  function renderDetail() {
    const d = $('detail');
    const r = bySlug.get(S.p);
    document.body.classList.toggle('has-detail', !!r && S.view === 'board');
    if (!r || S.view !== 'board') { d.hidden = true; d.innerHTML = ''; return; }
    d.hidden = false;
    const fairLog = Math.log10(r.fair);
    const parts = [
      ['Market line at ' + money(r.tvl) + ' TVL', r.fair, null],
      [`Category: ${r.category || 'none'}${r.catSrc === 'family' ? ' (family)' : ''}`, Math.pow(10, fairLog + r.catAdj), r.catAdj],
      [`7-day growth ${pct(r.ch7)}`, Math.pow(10, fairLog + r.catAdj + r.growthAdj), r.growthAdj],
      [`Tokenless ${days(r.age)}`, r.implied, Math.log10(r.track)],
    ];
    const lo = Math.log10(Math.min(...parts.map((p) => p[1]))) - 0.15, hi = Math.log10(Math.max(...parts.map((p) => p[1]))) + 0.15;
    const W = (v) => (((Math.log10(v) - lo) / (hi - lo)) * 100).toFixed(1);
    const fall = parts.map(([label, v, dx]) => `<div class="wf"><span class="wl">${esc(label)}</span><span class="wb"><span style="width:${W(v)}%" class="${dx === null ? 'base' : dx >= 0 ? 'pos' : 'neg'}"></span></span><span class="wv">${dx === null ? money(v) : mult(dx)}</span></div>`).join('') +
      `<div class="wf total"><span class="wl">Implied value</span><span class="wb"><span style="width:${W(r.implied)}%" class="fin"></span></span><span class="wv">${money(r.implied)}</span></div>`;
    const steps = r.steps.map(([a, c, t], i) => `<li><span class="sn">${i + 1}</span><div><p>${esc(a)}</p><div class="tags"><span class="tag cost">${esc(c)}</span><span class="tag time">${esc(t)}</span></div></div></li>`).join('');
    d.innerHTML = `<div class="dhead"><div><div class="drank">#${r.rank} of ${rows.length}${r.wl ? ' · watchlist' : ''}</div><h2>${esc(r.name)}</h2>
        <div class="meta"><i class="fd ${famColor[r.family]}"></i>${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', '))}</div></div><button class="x" id="close" aria-label="Close detail">×</button></div>
      <div class="big"><div><div class="k">Implied value</div><div class="bv">${money(r.implied)}</div><div class="fine">band ${money(r.low)} – ${money(r.high)}<br>${(r.implied / r.tvl).toFixed(2)}× TVL · no token recorded</div></div>
        <div class="facts"><div><span>TVL</span><b>${money(r.tvl)}</b></div><div><span>7 days</span><b class="${r.ch7 > 0 ? 'up' : 'dn'}">${pct(r.ch7)}</b></div><div><span>Listed</span><b>${esc(r.listed || 'unknown')}</b></div><div><span>Tokenless</span><b>${days(r.age)}</b></div></div></div>
      <div class="lbl">Why this value</div>${fall}
      <div class="plan"><div class="lbl">Farm plan · ${money(R.farm.capital_usd)} on ${esc(r.chain)} for ${R.farm.hold_days} days <span class="vd v${VERDICTS.indexOf(r.verdict)}">${r.verdict}</span></div>
        <div class="pm"><div><span>Expected drop</span><b>${money(r.drop)}</b></div><div><span>Fees</span><b>${money(r.fees)}</b></div><div><span>Forgone yield</span><b>${money(r.idle)}</b></div><div><span>Your time</span><b>${(r.minutes / 60).toFixed(1)} h</b></div></div>
        ${r.kyc ? '<p class="warn">Onboarding may need KYC: allow a day or more before the deposit step.</p>' : ''}
        <ol class="steps">${steps}</ol></div>
      <div class="lbl">On the market line</div>${scatter(392, 210, r, false)}`;
  }

  // ---------- render + events
  function render() {
    document.body.dataset.view = S.view;
    renderTabs(); renderStats(); renderSide();
    if (S.view === 'traded') renderTraded(); else if (S.view === 'model') renderModel(); else renderBoard();
    renderDetail();
    $('foot').innerHTML = `${esc(R.source)} · ${R.universe} protocols ≥ $5M TVL · “records no token” means DefiLlama carries none, not that none exists · implied values are this board's claim, not a forecast of any launch.`;
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, tr[data-slug]');
    if (!t) return;
    if (t.dataset.view) set({ view: t.dataset.view, p: '' });
    else if (t.dataset.sort) set({ sort: t.dataset.sort, dir: S.sort === t.dataset.sort ? (S.dir === 'asc' ? 'desc' : 'asc') : ['rank', 'name'].includes(t.dataset.sort) ? 'asc' : 'desc' });
    else if (t.dataset.fam) { const f = new Set(S.fam ? S.fam.split(',') : []); f.has(t.dataset.fam) ? f.delete(t.dataset.fam) : f.add(t.dataset.fam); set({ fam: [...f].sort().join(',') }); }
    else if (t.dataset.scope) set({ scope: t.dataset.scope });
    else if (t.dataset.grow !== undefined) set({ grow: t.dataset.grow });
    else if (t.id === 'reset') set({ q: '', fam: '', chain: '', scope: 'all', verdict: '', grow: '' });
    else if (t.id === 'close') set({ p: '' });
    else if (t.dataset.slug) set({ p: t.dataset.slug === S.p ? '' : t.dataset.slug });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) set({ p: e.target.dataset.slug });
    if (e.key === 'Escape' && S.p) set({ p: '' });
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'chain') set({ chain: e.target.value }); if (e.target.id === 'verdict') set({ verdict: e.target.value }); });
  let typing;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'q') return;
    clearTimeout(typing);
    typing = setTimeout(() => { const pos = e.target.selectionStart; set({ q: e.target.value }); const q = $('q'); q.focus(); q.setSelectionRange(pos, pos); }, 120);
  });
  readHash();
  render();
})();
