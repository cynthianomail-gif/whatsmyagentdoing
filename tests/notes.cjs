'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { createNotes, MAX_NOTES, MAX_TEXT } = require('../src/notes');
const { createServer } = require('../src/server');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wmad-notes-')), 'deep', 'notes.json');

test('notes are kept, read back, and survive a restart', () => {
  const file = tmp();
  const n = createNotes({ file });
  assert.deepEqual(n.list(), []);
  const saved = n.set([{ id: 'a1', text: '買牛奶\n第二行', color: 2, done: false, at: 5 }, { id: 'b2', text: 'done one', color: 1, done: true, at: 6 }]);
  assert.equal(saved.length, 2);
  assert.ok(fs.existsSync(file));
  const again = createNotes({ file }).list();
  assert.deepEqual(again, [{ id: 'a1', text: '買牛奶\n第二行', color: 2, done: false, at: 5 }, { id: 'b2', text: 'done one', color: 1, done: true, at: 6 }]);
  // what is handed out is a copy
  again[0].text = 'changed';
  assert.equal(createNotes({ file }).list()[0].text, '買牛奶\n第二行');
});

test('odd input is tidied, never trusted', () => {
  const n = createNotes({ file: null, now: () => 777 });
  const many = Array.from({ length: MAX_NOTES + 5 }, (_, i) => ({ id: 'n' + i, text: 't' + i }));
  assert.equal(n.set(many).length, MAX_NOTES);
  const got = n.set([
    { id: '../x', text: 'x'.repeat(MAX_TEXT + 50), color: 99, done: 'yes', at: -1 },
    { id: 'same', text: 'a\u0000b\tc\r\nd' }, { id: 'same', text: 5 },
    null, 'string', [1, 2], { __proto__: { text: 'p' } },
  ]);
  assert.equal(got.length, 4);
  assert.match(got[0].id, /^[a-z0-9]+$/i);
  assert.equal(got[0].text.length, MAX_TEXT);
  assert.deepEqual([got[0].color, got[0].done, got[0].at], [0, false, 777]);
  assert.equal(got[1].text, 'abc\nd');
  assert.equal(got[2].text, '');
  assert.notEqual(got[1].id, got[2].id);
  assert.deepEqual(n.set('nope'), []);
  assert.deepEqual(n.set({ notes: [] }), []);
});

test('a file that is not notes starts an empty board', () => {
  const file = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(createNotes({ file }).list(), []);
});

// ---- over HTTP
const watcher = { sessions: () => [], on() {} };
function serve(t, opts, extra) {
  const server = createServer(watcher, opts, extra);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    t.after(() => server.close());
    resolve(server.address().port);
  }));
}
function call(port, method, headers, body, at = '/api/notes') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: at, method, headers: { host: 'localhost', ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* no body */ } resolve({ status: res.statusCode, json, text, type: res.headers['content-type'] }); });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const OURS = { 'content-type': 'application/json', 'x-whatsmyagentdoing': 'notes' };

test('the board is read and written over HTTP, by this page only', async (t) => {
  const notes = createNotes({ file: null });
  const port = await serve(t, { privacy: false }, { notes });
  assert.deepEqual((await call(port, 'GET', {})).json, { notes: [] });

  const put = await call(port, 'PUT', OURS, JSON.stringify({ notes: [{ id: 'a', text: 'hello', color: 3 }] }));
  assert.equal(put.status, 200);
  assert.equal(put.json.notes[0].text, 'hello');
  assert.equal((await call(port, 'GET', {})).json.notes[0].color, 3);

  // without the header a page elsewhere cannot send, nothing is written
  assert.equal((await call(port, 'PUT', { 'content-type': 'application/json' }, JSON.stringify({ notes: [] }))).status, 403);
  assert.equal((await call(port, 'PUT', OURS, 'not json')).status, 400);
  assert.equal((await call(port, 'PUT', OURS, JSON.stringify({ notes: 'x'.repeat(70000) }))).status, 413);
  assert.equal(notes.list().length, 1);
});

test('private mode shows no notes and takes none', async (t) => {
  const notes = createNotes({ file: null });
  notes.set([{ id: 'a', text: 'secret' }]);
  const port = await serve(t, { privacy: true }, { notes });
  assert.deepEqual((await call(port, 'GET', {})).json, { notes: [], private: true });
  assert.equal((await call(port, 'PUT', OURS, JSON.stringify({ notes: [] }))).status, 403);
  assert.equal(notes.list()[0].text, 'secret');
});

test('the notes window and the script it shares with the office are served', async (t) => {
  const port = await serve(t, { privacy: false }, { notes: createNotes({ file: null }) });
  const page = await call(port, 'GET', {}, undefined, '/notes?id=abc');
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.match(page.text, /<script src="\/notes\.js"><\/script>/);
  const js = await call(port, 'GET', {}, undefined, '/notes.js');
  assert.equal(js.status, 200);
  assert.match(js.type, /^text\/javascript/);
  assert.match(js.text, /window\.NoteBook = NoteBook/);
  // the office page loads the same script
  assert.match((await call(port, 'GET', {}, undefined, '/')).text, /<script src="\/notes\.js"><\/script>/);
});
