// Farm plans: concrete steps with a cost and a time each, derived from the protocol's own record
// (category, first chain, TVL, seven-day change, tokenless runtime) and its implied value. No protocol
// name is special-cased; chain gas figures are typical per-transaction costs, stated as estimates.

import type { SnapshotProtocol, Valuation } from './model.ts';

export const FARM = {
  capital_usd: 1000, // every plan is sized per $1,000 so plans compare; scale linearly
  hold_days: 90,
  user_share: 0.1, // share of the implied value assumed to go to users, split by deposit-days
  baseline_apy: 0.04, // what the same $1,000 earns idle in a plain stablecoin position
  exit_drawdown_pct: 25, // leave if TVL falls this much in a week
};

/** Typical cost of one transaction, USD, by chain name (DefiLlama's spelling). */
const GAS: Record<string, number> = {
  ethereum: 3, bitcoin: 2.5, tron: 1.2, cardano: 0.25, binance: 0.08, bsc: 0.08, avalanche: 0.06, polygon: 0.02,
  solana: 0.01, sui: 0.01, aptos: 0.01, near: 0.01, ton: 0.02, algorand: 0.002, stellar: 0.001, ripple: 0.001,
  noble: 0.01, bittensor: 0.01, monad: 0.02, hyperliquid: 0.02, 'hyperliquid l1': 0.02, flare: 0.02,
};
const L2_GAS = 0.05; // Arbitrum, Base, Optimism, Ink and other rollups and app-chains not listed above

export function gasFor(chain: string): number {
  return GAS[chain.toLowerCase()] ?? L2_GAS;
}

/** What a plan funds with: USDC where the chain carries it, else the chain's own asset. */
const NATIVE: Record<string, string> = { bitcoin: 'BTC', bittensor: 'TAO', mezo: 'BTC', bsquared: 'BTC', core: 'BTC', 'babylon genesis': 'BTC' };
export function assetFor(chain: string): string {
  return NATIVE[chain.toLowerCase()] ?? 'USDC';
}

export interface FarmStep {
  action: string;
  cost: string;
  time: string;
  cost_usd: number;
  minutes: number;
}

export interface FarmPlan {
  chain: string;
  gas_per_tx: number;
  capital_usd: number;
  hold_days: number;
  total_cost_usd: number; // gas, fees and the idle yield forgone
  fees_usd: number; // gas and fees alone
  active_minutes: number;
  airdrop_apr: number; // user share x implied value / TVL, per year
  drop_usd: number; // this plan's expected allocation
  net_usd: number; // drop minus every cost
  edge: number; // drop / fees
  verdict: 'Prime' | 'Worth it' | 'Marginal' | 'Skip';
  kyc: boolean;
  steps: FarmStep[];
}

const usd = (n: number): string => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`);
const mins = (m: number): string => (m >= 1440 ? `${Math.round(m / 1440)} day${m >= 2880 ? 's' : ''}` : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

interface Core {
  action: string;
  txs: number;
  minutes: number;
  fee: number;
  second: string;
  secondTxs: number;
  weekly: string;
  touchFee?: number;
  timeText?: string; // when waiting time differs from hands-on time
  kyc?: boolean;
}

/** The category's core position and its second, breadth-building action. */
function core(p: SnapshotProtocol, family: string, chain: string, cap: string): Core {
  const a = assetFor(chain);
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (['risk curators', 'onchain capital allocator', 'yield aggregator', 'options vault', 'liquidity manager'].includes(c))
    return { action: `Deposit ${cap} of ${a} into the largest ${a} vault ${n} curates on ${chain} (pick it by TVL on ${n}'s own vault list, not the highest APY).`, txs: 2, minutes: 15, fee: 0,
      second: `Split ${usd(FARM.capital_usd * 0.25)} of it into a second ${n} vault on another asset or chain so the wallet shows breadth, not one deposit.`, secondTxs: 3, weekly: 'Compound or re-deposit the accrued yield' };
  if (c === 'lending' || c === 'uncollateralized lending' || c === 'collateral management')
    return { action: `Supply ${cap} of ${a} to ${n} on ${chain}, and enable it as collateral.`, txs: 2, minutes: 10, fee: 0,
      second: `Borrow ${usd(FARM.capital_usd * 0.25)} of a different asset against it (25% loan-to-value keeps liquidation far away) and keep the loan open; lenders usually score supply and borrow.`, secondTxs: 1, weekly: 'Repay and re-borrow a small slice' };
  if (c === 'cdp' || c === 'cdp manager')
    return { action: `Open a vault on ${n} on ${chain} with ${cap} of accepted collateral and mint ${usd(FARM.capital_usd * 0.3)} of its stablecoin (30% of collateral, far from liquidation).`, txs: 3, minutes: 15, fee: 0,
      second: `Deposit the minted stablecoin into ${n}'s own savings or stability module, if it has one, so both sides of the protocol count.`, secondTxs: 2, weekly: 'Check the collateral ratio and top up or repay' };
  if (family === 'Stables')
    return { action: `Mint ${cap} of ${n}'s yield-bearing dollar on ${chain} with ${a} through the protocol's own app.`, txs: 2, minutes: 10, fee: FARM.capital_usd * 0.001,
      second: `Stake or lock the minted dollar in ${n}'s own staking or points module for the longest lock you can afford to leave.`, secondTxs: 2, weekly: 'Claim and restake the yield' };
  if (c === 'dexs')
    return { action: `Add ${cap} of liquidity to a stablecoin pair on ${n} on ${chain} (a wide range, or a full-range pool, so the position stays in range without rebalancing).`, txs: 3, minutes: 15, fee: 0,
      second: `Make four swaps of ${usd(FARM.capital_usd * 0.25)} spread over the period (about ${usd(FARM.capital_usd * 0.25 * 0.003)} of fees each at a 0.3% pool) so the wallet trades as well as provides.`, secondTxs: 4, weekly: 'Swap once and check the range', touchFee: FARM.capital_usd * 0.1 * 0.003 };
  if (c === 'derivatives' || c === 'options' || c === 'synthetics' || c === 'interest rate derivatives')
    return { action: `Deposit ${cap} of ${a} as margin on ${n} on ${chain}.`, txs: 2, minutes: 10, fee: 0,
      second: `Trade about ${usd(FARM.capital_usd * 2)} of notional a week at 1-2x leverage, opening and closing the same day, so volume counts without carrying a directional bet.`, secondTxs: 2, weekly: `Trade ${usd(FARM.capital_usd * 2)} of notional (about ${usd(FARM.capital_usd * 2 * 0.0005 * 2)} of taker fees each time)`, touchFee: FARM.capital_usd * 2 * 0.0005 * 2 };
  if (c === 'prediction market')
    return { action: `Fund ${n} with ${cap} of ${a} on ${chain}.`, txs: 2, minutes: 10, fee: 0,
      second: `Take small positions in five or more markets that resolve inside the farm window, so you trade, hold and redeem.`, secondTxs: 5, weekly: 'Place one new position' };
  if (family === 'RWA')
    return { action: `Complete ${n}'s onboarding (it may ask for KYC and set a minimum; check before you bridge) and buy ${cap} of its tokenised product on ${chain}.`, txs: 2, minutes: 60, timeText: '1 h of forms, then up to 1 day for approval', fee: FARM.capital_usd * 0.002, kyc: true,
      second: `Hold the product through at least one of its yield or NAV distributions and use it in any on-chain integration ${n} lists, so the holding is active.`, secondTxs: 2, weekly: 'Check the distribution or NAV update' };
  if (family === 'Staking' || c === 'collateral markets')
    return { action: `Deposit ${cap} of an accepted collateral asset into a ${n} vault or pool on ${chain}.`, txs: 2, minutes: 15, fee: 0,
      second: `Delegate or point the stake at a second operator or network ${n} supports, so the position spreads across its set.`, secondTxs: 2, weekly: 'Claim and restake rewards' };
  if (c === 'chain')
    return { action: `Bridge ${cap} to ${chain} through its official bridge and deposit it in two of the chain's largest apps.`, txs: 4, minutes: 30, fee: 2,
      second: `Make one transaction on ${chain} on at least ten different days, the pattern chain-level airdrops have tended to reward.`, secondTxs: 10, weekly: 'Use one app on the chain' };
  if (c === 'payments')
    return { action: `Route ${cap} through ${n} on ${chain} (open a channel or account with it and keep the balance funded).`, txs: 2, minutes: 30, fee: 1,
      second: `Make ten small payments over the period so the account shows use, not only a balance.`, secondTxs: 10, weekly: 'Send one payment' };
  if (c === 'governance incentives')
    return { action: `Lock ${cap} of the asset ${n} accepts on ${chain} and direct its votes or incentives.`, txs: 2, minutes: 15, fee: 0,
      second: `Vote in every incentive round inside the farm window.`, secondTxs: 6, weekly: 'Vote or re-delegate' };
  if (c === 'insurance')
    return { action: `Provide ${cap} of cover capital to ${n} on ${chain}, or buy cover on a position you already hold.`, txs: 2, minutes: 15, fee: 0,
      second: `Buy a small policy as well, so you are both a capital provider and a buyer.`, secondTxs: 2, weekly: 'Check open policies' };
  return { action: `Deposit ${cap} of ${a} into ${n}'s main product on ${chain} and keep it there.`, txs: 2, minutes: 15, fee: 0,
    second: `Use a second product or market ${n} offers with ${usd(FARM.capital_usd * 0.25)} of the deposit.`, secondTxs: 2, weekly: 'Make one deposit, claim or swap' };
}

export function farmPlan(p: SnapshotProtocol, v: Valuation, family: string): FarmPlan {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(chain);
  const cap = usd(FARM.capital_usd);
  const days = FARM.hold_days;
  const k = core(p, family, chain, cap);
  // On a chain where a transaction costs a dollar or more, touch the position every other week.
  const every = gas >= 1 ? 2 : 1;
  const touches = Math.round(days / 7 / every);
  const onEth = chain.toLowerCase() === 'ethereum';
  const bridgeCost = onEth ? gas : 2 + gas;
  const coreCost = k.txs * gas + k.fee;
  const secondCost = k.secondTxs * gas;
  const weeklyCost = touches * (gas + (k.touchFee ?? 0));
  const idle = FARM.capital_usd * FARM.baseline_apy * (days / 365);
  const exitCost = 2 * gas;

  // Implied airdrop yield: the users' share of the implied value, spread over one year of deposits at
  // today's TVL. This plan's take is its capital's slice of that for the days it holds.
  const apr = (FARM.user_share * v.implied_usd) / Math.max(1, p.tvl_usd);
  const drop = FARM.capital_usd * apr * (days / 365);

  const steps: FarmStep[] = [
    { action: `Set up a fresh wallet used only for this farm and fund it with ${cap} of ${assetFor(chain)} on ${chain}${onEth ? '' : assetFor(chain) === 'USDC' ? ', by an exchange withdrawal straight to the chain or a bridge from Ethereum' : ', bought on an exchange and withdrawn straight to the chain'}; keep a little of ${chain}'s gas token for fees.`,
      cost: `about ${usd(bridgeCost)} in withdrawal or bridge fees`, time: onEth ? '15 min' : '30 min', cost_usd: bridgeCost, minutes: onEth ? 15 : 30 },
    { action: k.action, cost: `${cap} of capital at risk plus about ${usd(coreCost)} in gas${k.fee ? ' and fees' : ''} (${k.txs} transactions at ~${usd(gas)} each)`, time: k.timeText ?? mins(k.minutes), cost_usd: coreCost, minutes: k.minutes },
    { action: k.second, cost: `about ${usd(secondCost)} in gas (${k.secondTxs} transactions)`, time: mins(10 + k.secondTxs * 3), cost_usd: secondCost, minutes: 10 + k.secondTxs * 3 },
    { action: `${k.weekly} ${every === 2 ? 'every other week (gas is dear on this chain)' : 'every week'}, ${touches} times in all, so the wallet stays active through any snapshot inside the window.`,
      cost: `about ${usd(weeklyCost)} over the period`, time: `10 min each, ${mins(touches * 10)} in all`, cost_usd: weeklyCost, minutes: touches * 10 },
    { action: `Hold the position for ${days} days. The model's cost of waiting is the ${Math.round(FARM.baseline_apy * 100)}% a plain stablecoin position would have paid instead (less whatever ${p.name} pays you).`,
      cost: `at most ${usd(idle)} of forgone yield`, time: `${days} days, no attention needed`, cost_usd: idle, minutes: 0 },
    { action: `Set an exit rule: withdraw if ${p.name}'s TVL falls more than ${FARM.exit_drawdown_pct}% in a week (it moved ${p.change_7d === null ? 'an unreported amount' : `${p.change_7d > 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`} in the snapshot week) or if withdrawals are paused.`,
      cost: `about ${usd(exitCost)} in gas to unwind`, time: '10 min', cost_usd: exitCost, minutes: 10 },
    { action: `Claim only from the link ${p.name} publishes on its own site and verified accounts, and never sign an approval in a claim; record each transaction in a farm log.`,
      cost: 'no fee to check; never pay to claim', time: '10 min', cost_usd: 0, minutes: 10 },
  ];
  const total = steps.reduce((s, x) => s + x.cost_usd, 0);
  const fees = total - idle; // out of pocket: gas and fees, not the forgone yield
  const active = steps.reduce((s, x) => s + x.minutes, 0);
  const edge = drop / Math.max(0.01, fees);
  const net = drop - total;
  steps.push({
    action: `Check the payoff: ${Math.round(FARM.user_share * 100)}% of the implied ${usd(v.implied_usd)} shared over a year of today's ${usd(p.tvl_usd)} TVL is a ${(apr * 100).toFixed(1)}% airdrop yield, so ${cap} for ${days} days earns about ${usd(drop)} against ${usd(fees)} of fees and ${usd(idle)} of forgone yield.`,
    cost: 'nothing; it is arithmetic on the snapshot', time: '2 min', cost_usd: 0, minutes: 2,
  });
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    chain, gas_per_tx: gas, capital_usd: FARM.capital_usd, hold_days: days,
    total_cost_usd: r2(total), fees_usd: r2(fees), active_minutes: active + 2,
    airdrop_apr: Math.round(apr * 1e4) / 1e4, drop_usd: r2(drop), net_usd: r2(net), edge: r2(edge),
    verdict: net > 0 && edge >= 3 ? 'Prime' : net > 0 ? 'Worth it' : drop >= fees ? 'Marginal' : 'Skip',
    kyc: k.kyc === true, steps,
  };
}
