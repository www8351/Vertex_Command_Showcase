/**
 * Standalone test runner for prop-calculator.ts.
 *
 *   npx tsx server/utils/prop-calculator.test.ts
 *
 * No external test framework — uses node:assert/strict. Exits with code 1
 * if any assertion fails so this can later wire into CI without changes.
 */

import assert from 'node:assert/strict';
import {
  evaluateConsistency,
  computeTradeStats,
  evaluateDrawdown,
  type TradeRecord,
  type DrawdownInput,
} from './prop-calculator.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}\n    ${msg.replace(/\n/g, '\n    ')}`);
    console.log(`  FAIL  ${name}`);
  }
}

const approx = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

console.log('\n=== Prop Calculator Tests ===\n');

// ─────────────────────────────────────────────────────────────────────────
// Consistency Rule
// ─────────────────────────────────────────────────────────────────────────

console.log('-- Consistency Rule --');

test('day-3 spike (62.5%) triggers warning', () => {
  const r = evaluateConsistency({ dailyPnl: [1000, -500, 2500, 400, 600] });
  assert.equal(r.bestDay, 2500);
  assert.equal(r.totalProfit, 4000);
  assert.ok(approx(r.consistencyPct, 0.625), `expected 0.625 got ${r.consistencyPct}`);
  assert.equal(r.status, 'warning');
  assert.equal(r.threshold, 0.4);
});

test('even profits (25%) stay safe', () => {
  const r = evaluateConsistency({ dailyPnl: [500, 500, 500, 500] });
  assert.equal(r.bestDay, 500);
  assert.equal(r.totalProfit, 2000);
  assert.equal(r.consistencyPct, 0.25);
  assert.equal(r.status, 'safe');
});

test('exact threshold (40%) is safe (boundary inclusive)', () => {
  const r = evaluateConsistency({ dailyPnl: [400, 300, 300] });
  assert.equal(r.bestDay, 400);
  assert.equal(r.totalProfit, 1000);
  assert.equal(r.consistencyPct, 0.4);
  assert.equal(r.status, 'safe');
});

test('custom threshold (30%) flips a 40% case to warning', () => {
  const r = evaluateConsistency({ dailyPnl: [400, 300, 300], thresholdPct: 0.3 });
  assert.equal(r.status, 'warning');
  assert.equal(r.threshold, 0.3);
});

test('net loss returns no_profit, no NaN', () => {
  const r = evaluateConsistency({ dailyPnl: [-200, -300, 100] });
  assert.equal(r.totalProfit, -400);
  assert.equal(r.consistencyPct, 0);
  assert.equal(r.status, 'no_profit');
});

test('empty input returns no_profit', () => {
  const r = evaluateConsistency({ dailyPnl: [] });
  assert.equal(r.bestDay, 0);
  assert.equal(r.totalProfit, 0);
  assert.equal(r.consistencyPct, 0);
  assert.equal(r.status, 'no_profit');
});

// ─────────────────────────────────────────────────────────────────────────
// Trade Stats
// ─────────────────────────────────────────────────────────────────────────

console.log('\n-- Trade Stats --');

const sampleTrades: TradeRecord[] = [
  { pnl: 200, result: 'win' },
  { pnl: 250, result: 'win' },
  { pnl: 150, result: 'win' },
  { pnl: 200, result: 'win' },
  { pnl: 180, result: 'win' },
  { pnl: 220, result: 'win' },
  { pnl: -100, result: 'loss' },
  { pnl: -120, result: 'loss' },
  { pnl: -80, result: 'loss' },
  { pnl: -100, result: 'loss' },
];

test('6W/4L computes win rate 60%, R:R 2.0', () => {
  const r = computeTradeStats(sampleTrades);
  assert.equal(r.wins, 6);
  assert.equal(r.losses, 4);
  assert.equal(r.breakevens, 0);
  assert.equal(r.totalTrades, 10);
  assert.equal(r.winRatePct, 60);
  assert.equal(r.avgWin, 200);
  assert.equal(r.avgLoss, 100);
  assert.equal(r.riskReward, 2);
  assert.equal(r.netPnl, 800);
});

test('breakevens excluded from win rate denominator', () => {
  const r = computeTradeStats([
    { pnl: 100, result: 'win' },
    { pnl: -50, result: 'loss' },
    { pnl: 0, result: 'breakeven' },
    { pnl: 0, result: 'breakeven' },
  ]);
  assert.equal(r.breakevens, 2);
  assert.equal(r.winRatePct, 50);
  assert.equal(r.totalTrades, 4);
});

test('empty trades returns zeros, no NaN', () => {
  const r = computeTradeStats([]);
  assert.equal(r.wins, 0);
  assert.equal(r.losses, 0);
  assert.equal(r.winRatePct, 0);
  assert.equal(r.avgWin, 0);
  assert.equal(r.avgLoss, 0);
  assert.equal(r.riskReward, 0);
  assert.equal(r.netPnl, 0);
  assert.ok(!Number.isNaN(r.riskReward));
});

test('all-wins gives R:R = 0 (no losses to ratio against)', () => {
  const r = computeTradeStats([
    { pnl: 100, result: 'win' },
    { pnl: 200, result: 'win' },
  ]);
  assert.equal(r.winRatePct, 100);
  assert.equal(r.riskReward, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// Drawdown Status
// ─────────────────────────────────────────────────────────────────────────

console.log('\n-- Drawdown Status --');

test('static: equity above floor -> active', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 51_000,
    currentEquity: 49_500,
    drawdownLimit: 2_000,
    drawdownType: 'static',
    targetProfit: 3_000,
  });
  assert.equal(r.floor, 48_000);
  assert.equal(r.distanceToFloor, 1_500);
  assert.equal(r.pnl, -500);
  assert.equal(r.status, 'active');
});

test('static: equity at floor -> violated', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 50_000,
    currentEquity: 48_000,
    drawdownLimit: 2_000,
    drawdownType: 'static',
    targetProfit: 3_000,
  });
  assert.equal(r.breached, true);
  assert.equal(r.status, 'violated');
});

test('trailing: peak rises, floor follows below cap', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 51_500,
    currentEquity: 50_200,
    drawdownLimit: 2_000,
    drawdownType: 'trailing',
    targetProfit: 3_000,
  });
  // peak - dd = 49500, which is < accountSize, so floor uses 49500
  assert.equal(r.floor, 49_500);
  assert.equal(r.status, 'active');
});

test('trailing: floor caps at accountSize once peak >= size + limit', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 53_000,
    currentEquity: 51_000,
    drawdownLimit: 2_000,
    drawdownType: 'trailing',
    targetProfit: 3_000,
  });
  // peak - dd = 51000, but cap pulls it back to 50000
  assert.equal(r.floor, 50_000);
  assert.equal(r.status, 'active');
});

test('trailing: equity dips below trailing floor -> violated', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 52_000,
    currentEquity: 49_500,
    drawdownLimit: 2_000,
    drawdownType: 'trailing',
    targetProfit: 3_000,
  });
  // peak - dd = 50000, capped at 50000, equity 49500 <= floor -> violated
  assert.equal(r.floor, 50_000);
  assert.equal(r.status, 'violated');
});

test('hit target -> passed', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 53_500,
    currentEquity: 53_500,
    drawdownLimit: 2_000,
    drawdownType: 'trailing',
    targetProfit: 3_000,
  });
  assert.equal(r.reachedTarget, true);
  assert.equal(r.status, 'passed');
  assert.equal(r.pnl, 3_500);
});

test('breached takes precedence over reachedTarget', () => {
  const r = evaluateDrawdown({
    accountSize: 50_000,
    peakBalance: 60_000,
    currentEquity: 50_000,
    drawdownLimit: 2_000,
    drawdownType: 'trailing',
    targetProfit: 3_000,
  });
  // floor = min(58000, 50000) = 50000, equity == floor -> violated despite pnl 0
  assert.equal(r.floor, 50_000);
  assert.equal(r.breached, true);
  assert.equal(r.status, 'violated');
});

// ─────────────────────────────────────────────────────────────────────────
// Sample run (matches the user's "console.log the detailed results" spec)
// ─────────────────────────────────────────────────────────────────────────

const sampleConsistency = evaluateConsistency({ dailyPnl: [1000, -500, 2500, 400, 600] });
const sampleStats = computeTradeStats(sampleTrades);
const sampleDD: DrawdownInput = {
  accountSize: 50_000,
  peakBalance: 52_000,
  currentEquity: 51_200,
  drawdownLimit: 2_000,
  drawdownType: 'trailing',
  targetProfit: 3_000,
};
const sampleDDResult = evaluateDrawdown(sampleDD);

console.log('\n=== Sample Run (mock data) ===');
console.log('\n[1] Consistency, dailyPnl=[1000, -500, 2500, 400, 600]');
console.log(sampleConsistency);
console.log('\n[2] Trade Stats, 10 trades (6W / 4L)');
console.log(sampleStats);
console.log('\n[3] Drawdown, 50k acct, peak 52k, equity 51.2k, trailing 2k limit');
console.log(sampleDDResult);

// ─────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────

console.log(`\n=== Summary ===`);
console.log(`  ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
