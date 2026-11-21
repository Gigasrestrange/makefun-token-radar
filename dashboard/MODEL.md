# How Token Radar values a protocol that records no token

The page reads `data.js`, which `main.ts` writes from the sealed snapshot. The numbers come from
`lib/model.ts` (`calibrate`, `value`, `buildBoard`) and `lib/farm.ts` (`farmPlan`). No protocol name
appears in either file: one function scores every row.

## Value
1. **Market line.** `calibrate` takes every protocol whose token trades (a CoinGecko id and a market cap),
   sets exchanges aside and merges protocols that share one token, then fits
   `log10 mcap = a + b·log10 TVL + g·growth` by robust (Huber) least squares. On this snapshot:
   119 tokens, b ≈ 0.49, so market cap rises about 3x for every 10x of TVL.
2. **Category.** Each category's mean residual is shrunk toward its family's (k = 4 pseudo-tokens) and the
   family's toward zero, capped at ×/÷ 3.2.
3. **Growth.** The fitted growth slope is noisy, so it is blended with a prior (0.5 ± 0.5) by its standard
   error. The seven-day change is clamped to ±50%.
4. **Tokenless runtime.** `track = 0.55 + 0.45·(1 − e^(−age/365))`, where age counts days since DefiLlama
   began tracking the protocol. One listed last month has proven less than one that has run for two years
   with no token.

`implied = 10^(line + category + growth) × track`. The band ×/÷ 10^scale uses the fit's robust residual
scale. Rank 1 is the highest implied value. Tokens that already trade are never ranked: they appear in the
Calibration set tab with their market cap.

## Farm plans
`farmPlan` writes 8 steps for every row from the protocol's category, first chain, TVL and seven-day change:
- funding, the core position, a second action for breadth, recurring touches, the hold, an exit rule, safe
  claiming, and the payoff arithmetic;
- each step carries a dollar cost (gas per chain × transactions, fees, forgone yield) and a time;
- the airdrop yield is `10% × implied ÷ TVL` a year, and the verdict compares it with the plan's costs.
