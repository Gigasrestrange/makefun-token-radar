// Small, dependency-free statistics for the radar's value model.
//
// fitHuber: robust least squares (iteratively reweighted, Huber loss) of y on a design matrix, so a few
// tokens whose market cap is far from their TVL (a parent token counted on a child product, a meme run)
// pull the line far less than ordinary least squares would. Deterministic: fixed iteration count.

/** Solve the square system A x = b by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    const d = m[c]![c]!;
    if (Math.abs(d) < 1e-12) throw new Error('fit: singular design');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / d;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Invert a small square matrix (for the coefficients' standard errors). */
function invert(a: number[][]): number[][] {
  const cols = a.map((_, j) => solve(a, a.map((__, i) => (i === j ? 1 : 0))));
  return a.map((_, i) => cols.map((col) => col[i]!));
}

export interface Fit {
  coef: number[];
  se: number[];
  /** Robust residual scale (1.4826 x median absolute residual). */
  scale: number;
  /** Root mean square of residuals, unweighted. */
  rmse: number;
  /** Share of variance in y the fit explains, unweighted. */
  r2: number;
  residuals: number[];
  n: number;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};

/** Huber-weighted least squares of y on X (each row of X already holds its intercept column). */
export function fitHuber(X: number[][], y: number[], k = 1.345, iterations = 40): Fit {
  const n = y.length;
  const p = X[0]!.length;
  let w = new Array<number>(n).fill(1);
  let coef = new Array<number>(p).fill(0);
  let scale = 1;
  for (let it = 0; it < iterations; it++) {
    const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const xty = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < p; a++) {
        xty[a]! += w[i]! * X[i]![a]! * y[i]!;
        for (let b = 0; b < p; b++) xtx[a]![b]! += w[i]! * X[i]![a]! * X[i]![b]!;
      }
    }
    coef = solve(xtx, xty);
    const res = y.map((yi, i) => yi - X[i]!.reduce((s, x, j) => s + x * coef[j]!, 0));
    scale = Math.max(1e-6, 1.4826 * median(res.map(Math.abs)));
    w = res.map((r) => {
      const u = Math.abs(r) / scale;
      return u <= k ? 1 : k / u;
    });
  }
  const residuals = y.map((yi, i) => yi - X[i]!.reduce((s, x, j) => s + x * coef[j]!, 0));
  const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) xtx[a]![b]! += w[i]! * X[i]![a]! * X[i]![b]!;
  const inv = invert(xtx);
  const wss = residuals.reduce((s, r, i) => s + w[i]! * r * r, 0) / Math.max(1, n - p);
  const se = inv.map((row, i) => Math.sqrt(Math.max(0, row[i]! * wss)));
  const my = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  return { coef, se, scale, rmse: Math.sqrt(sse / n), r2: 1 - sse / sst, residuals, n };
}

/**
 * Precision-weighted blend of an estimate with a prior: the posterior mean of a normal prior
 * N(prior, priorSd^2) given an estimate with standard error `se`.
 */
export function shrink(estimate: number, se: number, prior: number, priorSd: number): number {
  const wp = 1 / (priorSd * priorSd);
  const we = 1 / Math.max(1e-9, se * se);
  return (prior * wp + estimate * we) / (wp + we);
}
