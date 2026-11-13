'use strict';

// Today's meetings as notes (src/meetings.js), and handing them to a running
// office with `--add-meetings`.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { test } = require('node:test');
const { mergeMeetings, readMeetings, summary, when, LEAD } = require('../src/meetings');
const { createNotes, MAX_NOTES } = require('../src/notes');
const { createServer } = require('../src/server');

const at = (h, m = 0) => new Date(2026, 10, 13, h, m).getTime();   // this computer's own clock
const iso = (h, m = 0) => `2026-11-13T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.0000000`;
const meeting = (id, subject, h1, h2, more) => ({ id, subject, start: { dateTime: iso(h1), timeZone: 'Taipei Standard Time' }, end: { dateTime: iso(h2), timeZone: 'Taipei Standard Time' }, ...more });

test('a time is read the way Outlook gives it', () => {
  assert.equal(when({ dateTime: '2026-11-13T10:30:00.0000000', timeZone: 'Taipei Standard Time' }), at(10, 30));
  assert.equal(when('2026-11-13T10:30:00', 'Taipei Standard Time'), at(10, 30));
  assert.equal(when({ dateTime: '2026-11-13T02:30:00.0000000', timeZone: 'UTC' }), Date.UTC(2026, 10, 13, 2, 30));
  assert.equal(when('2026-11-13T02:30:00Z'), Date.UTC(2026, 10, 13, 2, 30));
  assert.ok(Number.isNaN(when('tomorrow')));
  assert.ok(Number.isNaN(when(null)));
  assert.ok(Number.isNaN(when({ dateTime: 5 })));
});

test('each meeting becomes a blue note that reminds ten minutes before', () => {
  const r = mergeMeetings([{ id: 'mine', text: 'my own', color: 0, done: false, at: 1 }], [
    meeting('B', 'Design review', 14, 15, { location: { displayName: 'Room 3' } }),
    meeting('A', '  Stand-up\n', 10, 11),
  ], { now: at(8) });
  assert.deepEqual([r.added, r.updated, r.removed], [2, 0, 0]);
  assert.equal(r.notes.length, 3);
  assert.equal(r.notes[0].text, 'my own');                    // the user's own notes stay first, untouched
  const [, a, b] = r.notes;                                   // in the order of the day
  assert.equal(a.text, '📅 10:00–11:00 Stand-up');
  assert.equal(b.text, '📅 14:00–15:00 Design review\n📍 Room 3');
  assert.deepEqual([a.color, a.done, a.remind, a.reminded], [2, false, at(10) - LEAD, false]);
  assert.match(a.src, /^teams:[0-9a-f]{16}$/);
  assert.notEqual(a.src, b.src);
  assert.doesNotMatch(JSON.stringify(r.notes), /"A"|"B"/);   // nothing of Outlook's ids is kept
});

test('the same day handed over again changes notes instead of adding more', () => {
  const first = mergeMeetings([], [meeting('A', 'Stand-up', 10, 11), meeting('B', 'Review', 14, 15)], { now: at(8) });
  const before = first.notes.map((n) => ({ ...n }));
  first.notes[0].color = 1;                                   // the user repainted it, and
  first.notes[0].reminded = true;                             // its reminder already went off

  const same = mergeMeetings(first.notes, [meeting('A', 'Stand-up', 10, 11), meeting('B', 'Review', 14, 15)], { now: at(9) });
  assert.deepEqual([same.added, same.updated, same.removed], [0, 0, 0]);
  assert.equal(same.notes[0].reminded, true);                 // not reminded twice

  const moved = mergeMeetings(first.notes, [meeting('A', 'Stand-up', 10, 11), meeting('B', 'Review (moved)', 16, 17), meeting('C', 'New one', 17, 18)], { now: at(9) });
  assert.deepEqual([moved.added, moved.updated], [1, 1]);
  const b = moved.notes.find((n) => n.src === before[1].src);
  assert.equal(b.id, before[1].id);
  assert.equal(b.text, '📅 16:00–17:00 Review (moved)');
  assert.deepEqual([b.remind, b.reminded], [at(16) - LEAD, false]);   // a new time is a new reminder
  assert.equal(moved.notes[0].color, 1);                      // what the user did to a note stays

  const off = mergeMeetings(first.notes, [meeting('A', 'Stand-up', 10, 11, { isCancelled: true })], { now: at(9) });
  assert.equal(off.removed, 1);
  assert.equal(off.notes.length, 1);
  assert.equal(off.notes[0].src, before[1].src);
});

test('what is over, all day, cancelled, unreadable or past the board\'s room is left out', () => {
  const full = Array.from({ length: MAX_NOTES - 1 }, (_, i) => ({ id: 'n' + i, text: '', color: 0, done: false, at: 1 }));
  const r = mergeMeetings(full, [
    meeting('over', 'Done already', 7, 8),
    meeting('on', 'Going on now', 8, 10),
    meeting('day', 'Holiday', 0, 23, { isAllDay: true }),
    meeting('gone', 'Called off', 15, 16, { isCancelled: true }),
    { id: 'bad', subject: 'No time', start: 'soon', end: 'later' },
    meeting('late', 'No room', 17, 18),
    null, 'text',
  ], { now: at(9) });
  assert.deepEqual(r.skipped, { cancelled: 1, allDay: 1, over: 1, bad: 1, full: 1 });
  assert.equal(r.added, 1);
  const on = r.notes[r.notes.length - 1];
  assert.equal(on.text, '📅 08:00–10:00 Going on now');
  assert.equal(on.reminded, true);                            // it has begun: no reminder for it
  assert.equal(summary(r), 'Meetings: added 1, updated 0; skipped 1 already over, 1 all-day, 1 cancelled, 1 unreadable time, 1 board full (12 notes).');
  // what goes to the server is kept whole by it
  assert.deepEqual(createNotes({ file: null, now: () => at(9) }).set(r.notes), r.notes);
});

test('the meetings can come as a list or inside an object, and nothing else', () => {
  assert.equal(readMeetings('[{"id":"a"}]').length, 1);
  assert.equal(readMeetings('﻿{"meetings":[{"id":"a"},{"id":"b"}]}').length, 2);
  assert.equal(readMeetings('{"value":[{"id":"a"}]}').length, 1);
  assert.throws(() => readMeetings('{"x":1}'), /list of meetings/);
  assert.throws(() => readMeetings('not json'));
});

test('--add-meetings puts them on the board of the office that is running', async (t) => {
  const notes = createNotes({ file: null });
  notes.set([{ id: 'mine', text: 'my own', color: 0, done: false, at: 1 }]);
  const server = createServer({ sessions: () => [], on() {} }, { privacy: false }, { notes });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-meet-'));
  const file = path.join(dir, 'meetings.json');
  const soon = new Date(Date.now() + 3 * 3600e3), later = new Date(soon.getTime() + 3600e3);
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
  fs.writeFileSync(file, JSON.stringify({ meetings: [{ id: 'x', subject: '週會', start: { dateTime: local(soon), timeZone: 'Taipei Standard Time' }, end: { dateTime: local(later), timeZone: 'Taipei Standard Time' } }] }));

  const cli = path.join(__dirname, '..', 'bin', 'cli.js');
  const run = () => new Promise((resolve) => execFile(process.execPath, [cli, '--add-meetings', file, '--port', String(port)], (err, out, errOut) => resolve({ code: err ? err.code : 0, out, errOut })));
  const one = await run();
  assert.equal(one.code, 0, one.errOut);
  assert.match(one.out, /Meetings: added 1, updated 0\. \(on the board at http:\/\/localhost:\d+\)/);
  const board = notes.list();
  assert.equal(board.length, 2);
  assert.equal(board[0].text, 'my own');
  assert.match(board[1].text, /^📅 \d\d:\d\d–\d\d:\d\d 週會$/);
  assert.equal(board[1].remind, soon.setSeconds(0, 0) - LEAD);
  // again: nothing new
  const two = await run();
  assert.match(two.out, /added 0, updated 0/);
  assert.equal(notes.list().length, 2);
});
