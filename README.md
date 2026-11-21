# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gigasrestrange/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gigasrestrange/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for make.fun's *Build the best token launch radar* bounty (token-radar-01).

It ranks every DefiLlama protocol that records no token by an implied value. The value comes from fitting the market's own price of TVL over the protocols whose token already trades. Every row gets a farm plan with costs and times. The dashboard is a static page that works offline.

```
node main.ts --input kit/input/snapshot.json   # writes to /output, or to $MAKEFUN_OUTPUT_DIR / --output <dir>
```

- `main.ts` reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. Output is deterministic.
- `lib/fit.ts` holds the robust (Huber) regression and the shrinkage.
- `lib/model.ts` does the calibration on traded tokens, the category, growth and tokenless-runtime adjustments, and builds the board.
- `lib/farm.ts` writes the per-protocol farm plans: steps with dollar costs and times, the implied airdrop yield, and a verdict.
- `dashboard/` is the page: board, detail view, filters, the calibration set and the model. `dashboard/MODEL.md` states the model.
- `vendor/makefun-board.ts` is make.fun's dossier library, unchanged.

The board covers all 40 watchlist protocols plus 158 more that record no token and aren't a wrapped, staked, bridged or versioned product: 198 rows. A protocol "records no token" in DefiLlama's data; that doesn't mean it has none. An implied value is this board's claim on the snapshot's figures, not a forecast of any launch.

Standard library only, Node 22.18 or later. MIT licence.
