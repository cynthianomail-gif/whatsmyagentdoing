'use strict';

// Jumping from a person in the office to that conversation in the Claude
// desktop app.
//
// The app opens a conversation from `claude://code/continue?session=local_...`,
// but nothing on disk ties its `local_` session id to the CLI transcript the
// office reads: the transcript's own sessionId is its filename, and the app
// keeps its session list out of reach. So the ids are matched instead, through
// a small table the user regenerates from inside the desktop app.
//
// Matching is on the working folder, then on which conversation was last
// active closest to this one — several conversations often share a folder.
// A match that is not close in time is no match at all: the office would
// rather fall back than open the wrong conversation.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAP_FILE = path.join(os.homedir(), '.whatsmyagentdoing', 'desktop-sessions.json');
const CLOSE_ENOUGH_MS = 15 * 60_000;
const ID_RE = /^local_[A-Za-z0-9-]{1,64}$/;

// Windows paths reach us in both slashes and either case.
const normCwd = (c) => String(c || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

let cache = { mtimeMs: -1, byCwd: new Map() };

function load() {
  let st;
  try {
    st = fs.statSync(MAP_FILE);
  } catch {
    // No table yet: every session simply has no link.
    if (cache.mtimeMs !== -1) cache = { mtimeMs: -1, byCwd: new Map() };
    return cache;
  }
  if (st.mtimeMs === cache.mtimeMs) return cache;

  const byCwd = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    for (const s of Array.isArray(raw && raw.sessions) ? raw.sessions : []) {
      if (!ID_RE.test(String(s && s.id))) continue;
      const key = normCwd(s.cwd);
      if (!key) continue;
      const at = Date.parse(s.lastActivityAt) || 0;
      if (!byCwd.has(key)) byCwd.set(key, []);
      byCwd.get(key).push({ id: s.id, at });
    }
  } catch {
    // A half-written or malformed table behaves like no table at all.
  }
  cache = { mtimeMs: st.mtimeMs, byCwd };
  return cache;
}

function linkFor(cwd, lastEventAt) {
  const rows = load().byCwd.get(normCwd(cwd));
  if (!rows || !rows.length) return null;

  // One conversation in that folder: it is the one, whatever the clock says.
  // This matters for the session being worked in right now — its activity
  // keeps moving while the table stays as it was written, so a time test
  // would lose exactly the person most likely to be clicked.
  let best = rows[0];
  if (rows.length > 1) {
    const at = Number(lastEventAt) || 0;
    let bestGap = Infinity;
    for (const r of rows) {
      const gap = Math.abs(r.at - at);
      if (gap < bestGap) { bestGap = gap; best = r; }
    }
    // Several conversations share the folder and none is clearly this one:
    // better no jump than a jump into the wrong conversation.
    if (bestGap > CLOSE_ENOUGH_MS) return null;
  }
  return `claude://code/continue?session=${encodeURIComponent(best.id)}&source=url_external`;
}

module.exports = { linkFor, MAP_FILE };
