'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { createReports } = require('../src/reports');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-reports-'));
const row = (key, turns, tokens, more = {}) => ({
  key, agent: 'claude', subagent: false, title: 'title of ' + key, project: 'proj',
  today: { turns, tokens }, context: { used: 1000, window: 200000 }, status: 'thinking', stuck: 0, ...more,
});
const snap = (day, sessions) => ({ summary: { day }, sessions });

test('a day is kept, read back, and listed', () => {
  const dir = tmp();
  const r = createReports({ dir });
  r.note(snap('2026-11-12', [row('claude:a', 3, 500), row('claude:b', 1, 200, { subagent: true }), { key: 'claude:idle', agent: 'claude', today: null }]));
  r.save();
  assert.ok(fs.existsSync(path.join(dir, '2026-11-12.json')));

  const again = createReports({ dir });
  const got = again.get('2026-11-12');
  assert.equal(got.turns, 4);          // subagents count toward the totals
  assert.equal(got.tokens, 700);
  assert.equal(got.cats, 1);           // but are not cats of their own
  assert.equal(got.sessions.length, 2);
  assert.deepEqual(again.days().map((d) => d.day), ['2026-11-12']);
});

test('counts never go down, and what happened in the day sticks', () => {
  const r = createReports({ dir: tmp() });
  r.note(snap('2026-11-12', [row('claude:a', 5, 900, { status: 'done', stuck: 12 })]));
  r.note(snap('2026-11-12', [row('claude:a', 2, 100, { status: 'idle', stuck: 0, title: null })]));
  const s = r.get('2026-11-12').sessions[0];
  assert.deepEqual(s.today, { turns: 5, tokens: 900 });
  assert.equal(s.done, true);
  assert.equal(s.stuck, 12);
  assert.equal(s.title, 'title of claude:a');
});

test('a new day starts a new file and leaves the old one alone', () => {
  const dir = tmp();
  const r = createReports({ dir });
  r.note(snap('2026-11-11', [row('claude:a', 5, 900)]));
  r.note(snap('2026-11-12', [row('claude:a', 1, 50)]));
  r.save();
  assert.deepEqual(r.days().map((d) => [d.day, d.turns]), [['2026-11-11', 5], ['2026-11-12', 1]]);
  assert.equal(r.get('2026-11-11').turns, 5);
  // picked up again after a restart, the earlier count is still the floor
  const later = createReports({ dir });
  later.note(snap('2026-11-12', [row('claude:a', 0, 0)]));
  assert.equal(later.get('2026-11-12').turns, 1);
});

test('private mode leaves titles out; odd days and keys are refused', () => {
  const r = createReports({ dir: tmp() });
  r.note(snap('2026-11-12', [row('claude:a', 1, 1), row('__proto__', 2, 2)]));
  assert.equal(r.get('2026-11-12', { privacy: true }).sessions[0].title, null);
  assert.equal(r.get('2026-11-12').sessions.length, 2);
  assert.equal(r.get('../../etc/passwd'), null);
  assert.equal(r.get('2026-11-13'), null);
  r.note(snap('not a day', [row('claude:z', 1, 1)]));
  assert.deepEqual(r.days().map((d) => d.day), ['2026-11-12']);
});
