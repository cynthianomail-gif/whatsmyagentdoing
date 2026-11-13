'use strict';

// The planning board on the daily report (src/board.js): the board's own rules,
// its person filter, where it is kept, and /api/board.
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { boardDay, cellState, people, weekEnd, readConfig, writeConfig, createBoard } = require('../src/board');
const { createServer } = require('../src/server');

const TODAY = '2026-11-13';   // a Friday
const URL = 'https://script.google.com/macros/s/AKfyTEST_id-1/exec?format=office&key=abc';
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-board-')), 'board.json');

// A board with one platform: what the feed gives.
function feed(games, more) {
  return {
    ok: true, today: TODAY, generatedAt: '2026-11-13 17:21',
    platforms: {
      A: {
        label: 'H5',
        roles: [{ key: 'kickoff', label: '開案組' }, { key: 'pm', label: 'PM' }],
        milestoneDefs: [
          { label: '企劃書', depts: ['開案組'], planning: true },
          { label: '美術交檔', depts: ['美術'], planning: true },
          { label: '不是企劃的', depts: ['開案組'], planning: false },
          { label: '體感文件', depts: ['開案組'], planning: true, virtual: true },
          { label: 'FX 檢核點', depts: [], planning: true },
        ],
        games,
      },
    },
    ...more,
  };
}
const cell = (due, actual = '', status = '') => [due, actual, status, false, due];

test('done, not made, under way, overdue and soon are told the way the board tells them', () => {
  assert.equal(cellState('2026-11-01', '', '已完成', TODAY), 'done');
  assert.equal(cellState('2026-11-01', '2026-11-02', '', TODAY), 'done');        // a finish date and no word: done
  assert.equal(cellState('2026-11-01', '', ' 不製作 ', TODAY), 'na');
  assert.equal(cellState('2026-12-30', '', '製作中', TODAY), 'doing');
  assert.equal(cellState('2026-11-15', '', '製作中', TODAY), 'soon');           // under way, but due within the week
  assert.equal(cellState('2026-11-12', '', '', TODAY), 'over');
  assert.equal(cellState(TODAY, '', '', TODAY), 'soon');
  assert.equal(cellState('2026-11-20', '', '', TODAY), 'soon');                 // today + 7
  assert.equal(cellState('2026-11-21', '', '', TODAY), 'up');
  assert.equal(cellState('', '', '', TODAY), 'none');
  assert.deepEqual(people('初儀君👑、王小明 / M\n(外包)陳一, 3'), ['初儀君', '王小明', '陳一']);
  assert.equal(weekEnd('2026-11-13'), '2026-11-15');
  assert.equal(weekEnd('2026-11-15'), '2026-11-15');
  assert.equal(weekEnd('2026-11-16'), '2026-11-22');
});

test('the day: due today, later this week, and overdue, in the board\'s default view', () => {
  const games = [
    { name: '甲', kickoff: '初儀君👑', dept: { 美術: { owner: '王小明' } }, m: [cell(TODAY), cell('2026-11-15'), cell(TODAY), cell(TODAY), cell('2026-11-10')] },
    { name: '乙', kickoff: '李四', excl: 'archived', m: [cell(TODAY)] },
    { name: '丙', kickoff: '李四', m: [cell('2026-11-16'), cell('2026-11-12', '', '已完成'), cell(''), cell(''), cell('2026-10-01', '', '不製作')] },
  ];
  const d = boardDay(feed(games));
  assert.equal(d.day, TODAY);
  assert.equal(d.weekEnd, '2026-11-15');
  assert.deepEqual(d.counts, { today: 1, week: 1, over: 1 });
  assert.deepEqual(d.items.today.map((x) => [x.game, x.what, x.owners.join('、'), x.plat]), [['甲', '企劃書', '初儀君', 'H5']]);
  assert.deepEqual(d.items.week.map((x) => [x.game, x.what, x.owners.join('、')]), [['甲', '美術交檔', '王小明']]);
  assert.deepEqual(d.items.over.map((x) => [x.game, x.what, x.due, x.state]), [['甲', 'FX 檢核點', '2026-11-10', 'over']]);
  // next week, set-aside games, items not for planning, the 體感 column, done and not-made are not today's business
});

test('with a person, only the games they are on, and of those their items and nobody\'s', () => {
  const games = [
    { name: '甲', kickoff: '初儀君👑、王小明', dept: { 美術: { owner: '王小明' } }, m: [cell(TODAY), cell(TODAY), null, null, cell(TODAY)] },
    { name: '乙', kickoff: '李四', m: [cell(TODAY), null, null, null, cell(TODAY)] },
    { name: '丙', pm: '張三', dept: { 美術: { owner: '初儀君' } }, m: [cell(TODAY), cell('2026-11-14')] },
  ];
  const d = boardDay(feed(games), { person: '初儀君' });
  assert.equal(d.person, '初儀君');
  // 甲's 美術交檔 is 王小明's; 乙 is not hers; 丙's 企劃書 has no one named (開案組 empty) — the board keeps those
  assert.deepEqual(d.items.today.map((x) => `${x.game}・${x.what}`), ['丙・企劃書', '甲・企劃書', '甲・FX 檢核點']);
  assert.deepEqual(d.items.week.map((x) => `${x.game}・${x.what}`), ['丙・美術交檔']);
  assert.equal(d.counts.today, 3);
  assert.equal(boardDay(feed(games)).counts.today, 6);   // everyone: 甲 ×3, 乙 ×2, 丙 ×1
});

test('a long list keeps the newest overdue first, and says how many there are in all', () => {
  const games = Array.from({ length: 50 }, (_, i) => ({ name: 'g' + String(i).padStart(2, '0'), kickoff: 'x', m: [cell(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`)] }));
  const d = boardDay(feed(games));
  assert.equal(d.counts.over, 50);
  assert.equal(d.items.over.length, 40);
  assert.ok(d.items.over[0].due >= d.items.over[39].due);
});

test('what the board says when it has nothing to give is an error, not an empty day', () => {
  assert.throws(() => boardDay({ ok: false, msg: 'bad key' }), /bad key/);
  assert.throws(() => boardDay({ ok: true, today: 'soon', platforms: {} }), /no date/);
  assert.throws(() => boardDay(null), /no data/);
});

test('where the board is is kept, checked, and taken away again', () => {
  const file = tmp();
  assert.equal(readConfig(file), null);
  assert.throws(() => writeConfig({ person: '初儀君' }, file), /board address/);             // a person needs a board
  assert.throws(() => writeConfig({ url: 'https://example.com/exec?format=office' }, file), /board address/);
  assert.throws(() => writeConfig({ url: URL.replace('format=office', 'format=x') }, file), /board address/);
  assert.deepEqual(writeConfig({ url: URL, person: '初儀君' }, file), { url: URL, person: '初儀君' });
  assert.deepEqual(readConfig(file), { url: URL, person: '初儀君' });
  assert.deepEqual(writeConfig({ url: URL.replace('abc', 'def') }, file), { url: URL.replace('abc', 'def'), person: '初儀君' });  // the person stays
  assert.deepEqual(writeConfig({ person: '' }, file).person, '');
  assert.throws(() => writeConfig({ person: 'a\nb' }, file), /one line/);
  assert.equal(writeConfig({ url: 'off' }, file), null);
  assert.equal(fs.existsSync(file), false);
});

test('the board is looked at now and then, and a failure keeps what was seen before', async () => {
  const file = tmp();
  writeConfig({ url: URL, person: '初儀君' }, file);
  let answer = { status: 200, body: feed([{ name: '甲', kickoff: '初儀君', m: [cell(TODAY)] }]) }, calls = 0, clock = 1000;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, URL);
    assert.equal(init.redirect, 'follow');
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
  };
  const b = createBoard({ file, fetchImpl, now: () => clock, every: 60000 });
  const s1 = await b.get();
  assert.deepEqual([s1.configured, s1.ok, s1.error, s1.day.counts.today, s1.day.person], [true, true, '', 1, '初儀君']);
  assert.equal(s1.link, URL.split('?')[0]);           // the board to open, without the key
  assert.doesNotMatch(JSON.stringify(s1), /key=abc/);
  await b.get();
  assert.equal(calls, 1);                            // asked again soon after: the last look will do
  clock += 61000;
  answer = { status: 500, body: {} };
  const s2 = await b.get();
  assert.equal(calls, 2);
  assert.deepEqual([s2.ok, s2.error, s2.day.counts.today], [false, 'the board answered 500', 1]);   // what was seen stays, with the error
  answer = { status: 200, body: { ok: false, msg: 'bad key' } };
  const s3 = await b.refresh();
  assert.deepEqual([s3.ok, s3.error], [false, 'bad key']);
  writeConfig({ url: 'off' }, file);
  assert.deepEqual(await b.get(), { configured: false, ok: false, error: 'bad key', checkedAt: clock, link: null, day: null });
});

test('/api/board gives the day, and nothing at all in private mode', async (t) => {
  const watcher = { sessions: () => [], on() {} };
  const board = { get: async () => ({ configured: true, ok: true, error: '', day: { counts: { today: 2 } } }), refresh: async () => ({ configured: true, ok: true, refreshed: true }) };
  const serve = (opts, extra) => new Promise((resolve) => {
    const server = createServer(watcher, opts, extra);
    server.listen(0, '127.0.0.1', () => { t.after(() => server.close()); resolve(server.address().port); });
  });
  const ask = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => resolve(JSON.parse(s)));
  }).on('error', reject));
  const open = await serve({ privacy: false }, { board });
  assert.equal((await ask(open, '/api/board')).day.counts.today, 2);
  assert.equal((await ask(open, '/api/board?refresh=1')).refreshed, true);
  const hidden = await serve({ privacy: true }, { board });
  assert.deepEqual(await ask(hidden, '/api/board'), { configured: false, private: true });
  const none = await serve({ privacy: false }, {});
  assert.deepEqual(await ask(none, '/api/board'), { configured: false });
});
