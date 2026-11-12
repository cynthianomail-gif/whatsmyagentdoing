'use strict';

// The notes pinned to the office's notice board.
//
// A short list the user writes themselves: things to do, things to remember.
// It is kept in one file, ~/.whatsmyagentdoing/notes.json, so every scene and
// every browser shows the same board. Nothing here comes from the agents'
// logs, and nothing leaves this machine.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.whatsmyagentdoing', 'notes.json');
const MAX_NOTES = 12;
const MAX_TEXT = 300;
const COLORS = 4;       // the page has this many paper colours
const ID = /^[a-z0-9]{1,24}$/i;

const newId = () => Math.random().toString(36).slice(2, 10) || 'n';

// Whatever comes in, only this shape is kept.
function clean(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const n of list) {
    if (out.length >= MAX_NOTES) break;
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue;
    let id = typeof n.id === 'string' && ID.test(n.id) ? n.id : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    // line breaks stay, other control characters go
    const text = (typeof n.text === 'string' ? n.text : '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
      .slice(0, MAX_TEXT);
    const color = Number.isInteger(n.color) && n.color >= 0 && n.color < COLORS ? n.color : 0;
    const at = Number.isFinite(n.at) && n.at > 0 ? Math.floor(n.at) : now;
    out.push({ id, text, color, done: n.done === true, at });
  }
  return out;
}

// `file: null` keeps the notes in memory only (a demo has nothing worth keeping).
function createNotes({ file = FILE, now = Date.now } = {}) {
  let notes = [];
  if (file) {
    try { notes = clean(JSON.parse(fs.readFileSync(file, 'utf8')).notes, now()); }
    catch { notes = []; }
  }

  const list = () => notes.map((n) => ({ ...n }));

  // Replace the whole board. Throws when the file cannot be written; the
  // notes in memory are the new ones either way.
  function set(next) {
    notes = clean(next, now());
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ notes }, null, 1));
      fs.renameSync(tmp, file);
    }
    return list();
  }

  return { list, set };
}

module.exports = { createNotes, clean, MAX_NOTES, MAX_TEXT };
