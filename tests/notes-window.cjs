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
const TEXT = { saved: 'saved', saveFail: 'save failed', popFail: 'blocked', color: 'colour', hint: 'hint', done: 'done', del: 'delete', pop: 'pop', add: 'add', deleted: 'deleted', undo: 'undo', private: 'private', loadFail: 'load failed', full: (n) => 'full ' + n };
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
    const ctx = {
      window: win,
      BroadcastChannel: Chan,
      document: { getElementById: () => null },
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
