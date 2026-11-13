'use strict';

// public/notes.js, the notes shared by the office page and the notes window,
// run here in made-up windows: each has its own script, they share one
// channel and one server.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('node:test');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'notes.js'), 'utf8');
const TEXT = { saved: 'saved', saveFail: 'save failed', popFail: 'blocked', color: 'colour', hint: 'hint', done: 'done', del: 'delete', pop: 'pop', tab: 'notes', pinFail: 'no pin', remind: 'remind', remindOk: 'ok', remindClear: 'clear', add: 'add', deleted: 'deleted', undo: 'undo', private: 'private', loadFail: 'load failed', full: (n) => 'full ' + n };
const plain = (x) => JSON.parse(JSON.stringify(x));

function world(notes) {
  const chans = [];
  const server = { notes: plain(notes || []), gate: null, puts: 0 };
  class Chan {
    constructor() { chans.push(this); }
    postMessage(m) {
      const copy = JSON.stringify(m);
      for (const c of chans) if (c !== this && c.onmessage) c.onmessage({ data: JSON.parse(copy) });
    }
  }
  // One window: its own copy of the script, its own NoteBook.
  function open(extra) {
    const on = {};
    const kept = new Map();
    const opened = [];
    const win = {
      name: '',
      addEventListener: (k, f) => { (on[k] = on[k] || []).push(f); },
      open: (...a) => { opened.push(a); return win.blocked ? null : { focus() {} }; },
    };
    win.top = win;
    const ctx = {
      window: win,
      location: { href: 'http://localhost:4545/' },
      URL,
      BroadcastChannel: Chan,
      document: { getElementById: () => null, querySelector: () => null },
      localStorage: { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { kept.set(k, String(v)); } },
      setTimeout, clearTimeout, setInterval, encodeURIComponent,
      fetch: async (url, init) => {
        if (init && init.method === 'PUT') {
          server.puts += 1;
          server.notes = JSON.parse(init.body).notes;
          return { ok: true };
        }
        const seen = JSON.stringify({ notes: server.notes });
        if (server.gate) await server.gate;
        return { json: async () => JSON.parse(seen) };
      },
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    const log = { changed: 0, rendered: 0 };
    const book = new win.NoteBook({ text: () => TEXT, changed: () => { log.changed += 1; }, render: () => { log.rendered += 1; }, ...extra });
    return { book, log, win, kept, opened, fire: (k) => (on[k] || []).forEach((f) => f()) };
  }
  return { server, open };
}

test('a change in one window shows in the others at once, and is saved once', async () => {
  const w = world([{ id: 'a', text: 'milk', color: 0, done: false, at: 1 }]);
  const one = w.open(), two = w.open();
  await one.book.load();
  await two.book.load();
  two.log.rendered = 0;

  one.book.list[0].text = 'milk and eggs';
  one.book.save();
  assert.equal(two.book.list[0].text, 'milk and eggs');
  assert.equal(two.log.rendered, 1);
  assert.equal(two.book.dirty, false);
  await one.book.flush();
  assert.equal(w.server.notes[0].text, 'milk and eggs');
  assert.equal(w.server.puts, 1);

  // and back the other way, on top of what the first window wrote
  two.book.list.push({ id: 'b', text: 'second', color: 1, done: false, at: 2 });
  two.book.save();
  assert.deepEqual(plain(one.book.list).map((n) => n.text), ['milk and eggs', 'second']);
  await two.book.flush();
  assert.deepEqual(w.server.notes.map((n) => n.text), ['milk and eggs', 'second']);
});

test('a window that opens while another has not saved yet still gets the change', async () => {
  const w = world([{ id: 'a', text: 'old', color: 0, done: false, at: 1 }]);
  const one = w.open();
  await one.book.load();
  one.book.list[0].text = 'typed a moment ago';
  one.book.save();                    // not sent to the server yet
  assert.equal(w.server.notes[0].text, 'old');

  const late = w.open();
  await late.book.load();             // the server still says "old"…
  assert.equal(late.book.list[0].text, 'typed a moment ago');   // …the first window said otherwise
  await one.book.flush();
});

test('a slow answer from the server does not undo what a window said meanwhile', async () => {
  const w = world([{ id: 'a', text: 'old', color: 0, done: false, at: 1 }]);
  const one = w.open(), two = w.open();
  await one.book.load();
  await two.book.load();

  let release;
  w.server.gate = new Promise((r) => { release = r; });
  const looking = two.book.load();    // asks the server, which still has "old"
  one.book.list[0].text = 'new';
  one.book.save();
  assert.equal(two.book.list[0].text, 'new');
  release();
  assert.equal(await looking, false);
  assert.equal(two.book.list[0].text, 'new');
  w.server.gate = null;
  await one.book.flush();
});

test('coming back to a window reads the notes again, unless a window has just spoken', async () => {
  const w = world([{ id: 'a', text: 'old', color: 0, done: false, at: 1 }]);
  const one = w.open();
  await one.book.load();
  one.log.rendered = 0;
  // another browser wrote to the server; no channel reaches this one
  w.server.notes = [{ id: 'a', text: 'from the other browser', color: 0, done: false, at: 1 }];
  one.fire('focus');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(one.book.list[0].text, 'from the other browser');
  assert.equal(one.log.rendered, 1);
  // nothing new: nothing is drawn again (a redraw would take the caret away)
  one.fire('focus');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(one.log.rendered, 1);

  // a window of this browser has just said what the notes are: the server is not asked
  const two = w.open();
  await two.book.load();
  two.book.list[0].text = 'said by a window';
  two.book.save();
  w.server.notes = [{ id: 'a', text: 'stale', color: 0, done: false, at: 1 }];
  one.fire('focus');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(one.book.list[0].text, 'said by a window');
  await two.book.flush();
});

test('leaving a window saves at once', async () => {
  const w = world([]);
  const one = w.open();
  await one.book.load();
  one.book.list.push({ id: 'a', text: 'x', color: 0, done: false, at: 1 });
  one.book.save();
  one.fire('blur');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.server.notes.length, 1);
  assert.equal(one.book.dirty, false);
});

test('a note opens in a window named after it, where that window was last left', async () => {
  const w = world([{ id: 'abc', text: 'x', color: 0, done: false, at: 1 }]);
  const said = [];
  const one = w.open({ opened: (id) => { said.push(id || 'all'); } });
  await one.book.load();

  assert.ok(one.book.open('abc'));
  assert.equal(one.opened[0][0], '/notes?id=abc');
  assert.equal(one.opened[0][1], 'wmad-note-abc');
  assert.equal(one.opened[0][2], 'popup=1,width=260,height=240');

  one.kept.set('wmad.noteWin.wmad-notes', JSON.stringify({ x: 1500, y: 80, w: 400, h: 600 }));
  assert.ok(one.book.open());
  assert.deepEqual(one.opened[1], ['/notes', 'wmad-notes', 'popup=1,width=400,height=600,left=1500,top=80']);
  assert.deepEqual(said, ['abc', 'all']);

  // a place that makes no sense (a minimised window reports one) is not used
  one.kept.set('wmad.noteWin.wmad-notes', JSON.stringify({ x: -32000, y: -32000, w: 160, h: 28 }));
  one.book.open();
  assert.equal(one.opened[2][2], 'popup=1,width=380,height=560');
  // and a window is never opened smaller than a note needs
  one.kept.set('wmad.noteWin.wmad-notes', JSON.stringify({ x: 10, y: 20, w: 130, h: 110 }));
  one.book.open();
  assert.equal(one.opened[3][2], 'popup=1,width=200,height=160,left=10,top=20');

  // the browser refused: say so, and tell nobody a window opened
  one.win.blocked = true;
  assert.equal(one.book.open('abc'), null);
  assert.equal(one.book.status, 'blocked');
  assert.equal(one.book.bad, true);
  assert.equal(said.length, 4);
});

test('the notes go into a window that stays on top, and come out of it again', async () => {
  const w = world([{ id: 'a', text: 'x', color: 0, done: false, at: 1 }]);
  const said = [];
  const one = w.open({ opened: (id) => { said.push(id || 'all'); } });
  await one.book.load();
  assert.equal(one.book.canPin, false);   // a browser without such windows

  // a made-up window of that kind: what was put in it, and what it listens for
  const pip = () => {
    const on = {}, made = [];
    return {
      closed: false, on, made,
      document: { title: '', createElement: (tag) => { const e = { tag }; made.push(e); return e; }, head: { append() {} }, body: { append(e) { e.inBody = true; } } },
      addEventListener: (k, f) => { on[k] = f; },
      close() { this.closed = true; },
    };
  };
  const asked = [];
  let next = pip();
  one.win.documentPictureInPicture = { requestWindow: async (o) => { asked.push(o); if (!next) throw new Error('no window'); return next; } };
  assert.equal(one.book.canPin, true);

  one.log.rendered = 0;
  const first = await one.book.pin();
  assert.equal(first, next);
  assert.deepEqual(plain(asked), [{ width: 300, height: 420 }]);
  const frame = first.made.find((e) => e.tag === 'iframe');
  assert.equal(frame.src, 'http://localhost:4545/notes?pin=1');
  assert.equal(frame.inBody, true);
  assert.equal(first.document.title, 'notes');
  assert.equal(one.book.pinned, first);
  assert.deepEqual(said, ['all']);

  // the browser closed it: the user did, or another window of the kind took its place
  first.on.pagehide();
  assert.equal(one.book.pinned, null);
  assert.equal(one.log.rendered, 1);

  // asked for while it is open, it is put away
  next = pip();
  const second = await one.book.pin();
  assert.equal(one.book.pinned, second);
  assert.equal(await one.book.pin(), null);
  assert.equal(second.closed, true);
  assert.equal(one.book.pinned, null);
  second.on.pagehide();                   // the window going says nothing more
  assert.equal(one.book.pinned, null);

  // a browser that has the call but no window to give
  next = null;
  assert.equal(await one.book.pin(), null);
  assert.equal(one.book.status, 'no pin');
  assert.equal(one.book.bad, true);
  assert.equal(said.length, 2);

  // and a page inside another (the office in its own floating window) never offers it
  const inner = w.open();
  inner.win.documentPictureInPicture = one.win.documentPictureInPicture;
  inner.win.top = {};
  assert.equal(inner.book.canPin, false);
});

// A click or a keystroke on a note, as the page hands it to the NoteBook.
function on(book, id, act, extra = {}) {
  const classes = new Set();
  const card = { dataset: { id }, classList: { remove: (c) => classes.delete(c), toggle() {} }, style: { setProperty() {} }, querySelectorAll: () => [] };
  const el = { dataset: { n: act }, closest: (sel) => (sel === '[data-n]' ? el : sel.startsWith('.note') ? card : null), ...extra };
  return { target: el };
}

test('a note is given a time to remind, and the time is taken off again', async () => {
  const w = world([{ id: 'a', text: 'call the studio', color: 0, done: false, at: 1 }]);
  const one = w.open(), two = w.open();
  await one.book.load();
  await two.book.load();

  // no reminder yet: a clock on the bar; asking for it opens the line with the time
  assert.match(one.book.card(one.book.list[0]), /class="clock" data-n="when"/);
  assert.doesNotMatch(one.book.card(one.book.list[0]), /data-n="remind"/);
  one.book.click(on(one.book, 'a', 'when'));
  assert.equal(one.book.editing, 'a');
  assert.match(one.book.card(one.book.list[0]), /type="datetime-local" data-n="remind" value=""/);
  assert.doesNotMatch(one.book.card(one.book.list[0]), /data-n="noremind"/);

  // a time is picked: kept, told to the other window, saved
  one.book.input(on(one.book, 'a', 'remind', { tagName: 'INPUT', value: '2026-11-13T14:30' }));
  const ms = new Date(2026, 10, 13, 14, 30).getTime();
  assert.equal(one.book.list[0].remind, ms);
  assert.equal(two.book.list[0].remind, ms);
  assert.match(one.book.card(one.book.list[0]), /value="2026-11-13T14:30"/);
  await one.book.flush();
  assert.equal(w.server.notes[0].remind, ms);

  // the line closes and shows the time; no clock on the bar any more
  one.book.click(on(one.book, 'a', 'when'));
  assert.equal(one.book.editing, null);
  const card = one.book.card(one.book.list[0]);
  assert.match(card, /data-n="when" title="remind">⏰ (14:30|11\/13 14:30)</);
  assert.doesNotMatch(card, /class="clock"/);

  // a time that went off and is given again is a new reminder
  one.book.list[0].reminded = true;
  one.book.input(on(one.book, 'a', 'remind', { tagName: 'INPUT', value: '2026-11-13T16:00' }));
  assert.equal(one.book.list[0].reminded, undefined);
  // and cleared, there is none
  one.book.click(on(one.book, 'a', 'noremind'));
  assert.equal(one.book.list[0].remind, undefined);
  assert.equal(two.book.list[0].remind, undefined);
  assert.equal(one.book.editing, null);
});

test('a note whose time has come is handed out once, and shows until it is done', async () => {
  const t0 = new Date(2026, 10, 13, 9, 0).getTime();
  const w = world([
    { id: 'a', text: 'early', color: 0, done: false, at: 1, remind: t0 - 60e3 },
    { id: 'b', text: 'later', color: 0, done: false, at: 2, remind: t0 + 3600e3 },
    { id: 'c', text: 'done anyway', color: 0, done: true, at: 3, remind: t0 - 60e3 },
    { id: 'd', text: 'no time', color: 0, done: false, at: 4 },
  ]);
  const office = w.open(), pinned = w.open();
  assert.equal(office.book.takeDue(t0).length, 0);    // nothing read yet: nothing to say
  await office.book.load();
  await pinned.book.load();

  const due = office.book.takeDue(t0);
  assert.deepEqual(plain(due).map((n) => n.id), ['a']);
  assert.equal(pinned.book.list[0].reminded, true);   // the other window knows, and will not say it again
  assert.equal(pinned.book.takeDue(t0).length, 0);
  assert.equal(office.book.takeDue(t0 + 1000).length, 0);
  assert.match(office.book.card(office.book.list[0]), /class="note due"/);
  assert.deepEqual(plain(office.book.alarms).map((n) => n.id), ['a']);
  await office.book.flush();
  assert.equal(w.server.notes[0].reminded, true);

  assert.deepEqual(plain(office.book.takeDue(t0 + 3600e3)).map((n) => n.id), ['b']);
  office.book.list[0].done = true;
  assert.deepEqual(plain(office.book.alarms).map((n) => n.id), ['b']);
  assert.doesNotMatch(office.book.card(office.book.list[0]), /due/);
  await office.book.flush();
});

test('a reminder that asks for the window on top never puts it away', async () => {
  const w = world([]);
  const one = w.open();
  const kept = { closed: false, close() { this.closed = true; } };
  one.book.pinned = kept;
  assert.equal(await one.book.pin(true), kept);
  assert.equal(kept.closed, false);
  // and a refusal it did not click for is not news
  one.book.pinned = null;
  one.win.documentPictureInPicture = { requestWindow: async () => { throw new Error('needs a click'); } };
  assert.equal(await one.book.pin(true), null);
  assert.equal(one.book.status, '');
});

test('the card offers the window only where it is wanted, and never trusts the text', async () => {
  const w = world([{ id: 'a', text: '<b>&"x', color: 2, done: true, at: 1 }]);
  const office = w.open(), sheet = w.open({ canPop: false });
  await office.book.load();
  await sheet.book.load();
  assert.match(office.book.card(office.book.list[0]), /data-n="pop"/);
  assert.doesNotMatch(sheet.book.card(sheet.book.list[0]), /data-n="pop"/);
  assert.match(office.book.card(office.book.list[0]), /&lt;b&gt;&amp;&quot;x<\/textarea>/);
  assert.match(office.book.body(), /class="note done"/);
  assert.equal(office.book.unseen(), '');
});
