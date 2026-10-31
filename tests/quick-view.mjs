// The Windows quick view follows the macOS panel's rules (desktop/QuickDashboard.swift, DashboardModel.swift).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const q = require('../agent/onetop/dist/quick.js');

assert.equal(q.shortNumber(2e8), '200M');
assert.equal(q.shortNumber(7.5e6), '7.5M');
assert.equal(q.shortNumber(7e6), '7M');
assert.equal(q.shortNumber(1234), '1.2k');
assert.equal(q.shortNumber(.3), '0');
assert.equal(q.shortNumber(null), '—');
assert.equal(q.pct1(0), '0%');
assert.equal(q.pct1(.04), '<0.1%');
assert.equal(q.pct1(4.12), '4.1%');
assert.equal(q.pct1(21), '21%');
assert.equal(q.niceMaximum(3.2e6), 5e6);
assert.equal(q.niceMaximum(0), 1);

assert.equal(q.shortModel({ kind: 'Claude', model: 'claude-opus-5-5' }), 'opus-5-5');
assert.equal(q.shortModel({ kind: 'Codex', model: 'gpt-6-astra' }), 'GPT-6-astra');
assert.equal(q.shortModel({ kind: 'GLM', model: 'glm-5.3[1m]' }), 'glm-5.3');
assert.equal(q.shortModel({ kind: 'Antigravity' }), 'Agy CLI');

// Working groups first, then the selected period's tokens, then id.
const w = n => ({ windows: { '1h': [n, 0, 0, 0] } });
const rows = [{ id: 'a', status: 'idle', usage: w(900) }, { id: 'b', status: 'working', usage: w(10) },
  { id: 'c', status: 'idle', children_working: 1, usage: w(5) }, { id: 'd', status: 'idle' }, { id: 'e', status: 'waiting', usage: w(901) }];
assert.deepEqual(q.orderSessions(rows, '1h').map(s => s.id), ['b', 'c', 'e', 'a', 'd']);

const orca = { control_key: 'k', orca_terminal: { title: 'T' }, kind: 'Claude' };
assert.ok(q.allows({ ...orca, status: 'working' }, 'pause'));
assert.ok(!q.allows({ ...orca, status: 'working', input_verified: false }, 'pause'));
assert.ok(q.allows({ ...orca, status: 'idle', display_status: 'paused' }, 'resume'));
assert.ok(q.allows({ ...orca, status: 'idle' }, 'terminate'));
assert.ok(!q.allows({ ...orca, kind: 'Aside', status: 'idle' }, 'terminate'));
assert.ok(q.allows({ kind: 'Aside', control_key: 'k', status: 'working' }, 'pause'));
assert.ok(!q.allows({ ...orca, control_key: '' }, 'focus'));
assert.ok(q.allows({ control_key: 'k', location: { app_path: 'C:/x' } }, 'focus'));

// Up to four models, or three and the rest folded into one slice.
const m = (kind, model, n) => ({ kind, model, tokens: [1, 0, 0, 0], usage: { windows: { '1h': [n, 0, 0, 0] } } });
const five = [m('Claude', 'claude-opus-5-5', 50), m('Codex', 'gpt-6-astra', 30), m('Claude', 'claude-sonnet-5-5', 10), m('GLM', 'glm-5.3', 6), m('Codex', 'gpt-6.1-sol', 4)];
const usage = q.modelSlices(five, '1h', 120);
assert.equal(usage.total, 120);
assert.deepEqual(usage.slices.map(s => s.name || 'rest'), ['opus-5-5', 'GPT-6-astra', 'sonnet-5-5', 'rest']);
assert.deepEqual(usage.slices.map(s => s.shade), [1, 1, .68, 1]);
assert.equal(usage.slices[3].others, 2);
assert.ok(usage.slices[3].endedToo);
assert.equal(q.modelSlices(five.slice(0, 4), '1h', 96).slices.length, 4);

// Weekly estimates.
const estimate = { account_id: 'acct', basis: 'calibrated_token_equivalent', used_pp: 2, calibration: { tokens: 1e6, used_pp: 1, seconds: 600 } };
assert.equal(q.burnPerHour(estimate, 100), 100 * (1 / 1e6) * 3600);
assert.equal(q.burnPerHour({ ...estimate, calibration: { ...estimate.calibration, seconds: 60 } }, 100), null);
assert.ok(q.permitsBurnRate(estimate, { id: 'acct', stale: false }, 1000));
assert.ok(!q.permitsBurnRate(estimate, { id: 'acct', stale: true }, 1000));
assert.ok(!q.permitsBurnRate(estimate, { id: 'other' }, 1000));
const historical = { ...estimate, calibration: { ...estimate.calibration, source: 'historical_provider_calibration', kind: 'Claude', reset: 5000, valid_until: 4000, to: 900 } };
assert.ok(q.permitsBurnRate(historical, { id: 'acct', kind: 'Claude', windows: [{ label: '주간', reset: 5030 }] }, 1000));
assert.ok(!q.permitsBurnRate(historical, { id: 'acct', kind: 'Claude', windows: [{ label: '주간', reset: 9000 }] }, 1000));
assert.equal(q.weeklyBurnPerHour({ usage: { rate: 100, weekly_account: 'acct', weekly_estimate: { '1h': estimate } } }, '1h'), q.burnPerHour(estimate, 100));
assert.equal(q.weeklyBurnPerHour({ usage: { rate: 100, weekly_account: 'x', weekly_estimate: { '1h': estimate } } }, '1h'), null);
assert.equal(q.periodBurn({ used_pp: 1, observed_seconds: 1800 }), 2);
assert.equal(q.periodBurn({ used_pp: 1, observed_seconds: 60 }), null);
assert.deepEqual(q.weeklyPoints({ usage_points: [[50, 1], [90, 2], [120, 3], [120, 4], [200, 101], [300, 5]] }, 100, 250).map(p => p.t), [90, 120]);
assert.deepEqual(q.weeklyPoints({ history: [[10, 1]] }, 100, 250), []);

// Radar bins: 1/5/15-minute buckets on the snapshot clock, tools in the canonical order.
const t = q.trend([{ t: 3590, kind: 'Codex', n: 120 }, { t: 3595, kind: 'Claude', fresh: 60 }, { t: 100, kind: 'Claude', n: 1 }], '1h', 3599);
assert.equal(t.bins.length, 60);
assert.deepEqual(t.series, ['Claude', 'Codex']);
assert.deepEqual(t.bins.at(-1).byKind, [['Claude', 3600], ['Codex', 7200]]);
assert.equal(q.trend([], '24h', 0).bins.length, 96);
assert.equal(q.trend(null, '5h', 0).reported, false);

// Several accounts of one tool are numbered by account name; a tool with one account is not.
assert.deepEqual(q.accountNumbers([{ id: 'b', kind: 'Claude', account_label: 'Zed@x' }, { id: 'a', kind: 'Claude', account_label: 'amy@x' }, { id: 'c', kind: 'Codex', account_label: 'c@x' }]), { a: 1, b: 2 });
// Agy pools and GLM (provider-quotas-contract v1.0.2): the Windows quick view picks like the Mac panel.
{
 const { readFileSync } = await import('node:fs');
 const rows = JSON.parse(readFileSync(new URL('./fixtures/provider-quotas_v1.0.2.json', import.meta.url), 'utf8')).account_quotas;
 const by = Object.fromEntries(rows.map(r => [r.id, r]));
 assert.equal(q.representative(by['glm:fixture-key']).label, '5H');
 assert.equal(q.representative(by['antigravity:pool-claude-gpt']).key, 'cg-weekly');
 assert.equal(q.burnAllowed(by['antigravity:pool-gemini']), false);
 assert.ok(q.burnAllowed(by['claude:fixture-a']));
 assert.deepEqual(q.pickTiles(rows).map(r => r.id), ['claude:fixture-a', 'codex:fixture-c', 'antigravity:pool-gemini', 'glm:fixture-key']);
 // Pools are named on their chip, so only the two Claude and two GLM rows are numbered.
 assert.deepEqual(q.accountNumbers(rows), { 'claude:fixture-a': 1, 'claude:fixture-b': 2, 'glm:fixture-down': 1, 'glm:fixture-key': 2 });
}
console.log('quick view ok');
