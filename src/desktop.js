'use strict';

// Jumping from a person in the office to that conversation in the Claude
// desktop app.
//
// The app opens a conversation from the link it hands out itself,
// `claude://claude.ai/epitaxy/local_...`. Nothing on disk ties that `local_`
// id to the CLI transcript the office reads: the transcript's own sessionId
// is its filename, and the app keeps its session list out of reach. So the
// two are matched, through a small table the user regenerates from inside
// the desktop app.
//
// What is matched on, strongest first:
//   1. when it began. The app creates a conversation and its transcript in
//      the same breath; in every case looked at the two start times were
//      within three seconds. This does not drift, so it still holds for a
//      conversation that has been going all day.
//   2. its title, which the app writes into the transcript.
//   3. when it was last active, for tables written before the first two
//      were recorded.
// A conversation that cannot be told apart from another gets no link. The
// office would rather not jump than open the wrong conversation.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAP_FILE = path.join(os.homedir(), '.whatsmyagentdoing', 'desktop-sessions.json');
const CLOSE_ENOUGH_MS = 15 * 60_000;
const BORN_TOGETHER_MS = 60_000;
const ID_RE = /^local_[A-Za-z0-9-]{1,64}$/;

// Windows paths reach us in both slashes and either case.
const normCwd = (c) => String(c || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const normTitle = (t) => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase();

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
      if (!byCwd.has(key)) byCwd.set(key, []);
      byCwd.get(key).push({
        id: s.id,
        at: Date.parse(s.lastActivityAt) || 0,
        born: Date.parse(s.createdAt) || 0,
        title: normTitle(s.title),
      });
    }
  } catch {
    // A half-written or malformed table behaves like no table at all.
  }
  cache = { mtimeMs: st.mtimeMs, byCwd };
  return cache;
}

// The id of the desktop conversation this transcript belongs to, or null.
function match(cwd, lastEventAt, title, startedAt) {
  const rows = load().byCwd.get(normCwd(cwd));
  if (!rows || !rows.length) return null;
  const at = Number(lastEventAt) || 0;
  const born = Number(startedAt) || 0;
  const name = normTitle(title);

  // 1. Began together.
  let pool = rows;
  if (born) {
    const twins = rows.filter((r) => r.born && Math.abs(r.born - born) <= BORN_TOGETHER_MS);
    if (twins.length === 1) return twins[0].id;
    // A row that began at some other moment is some other conversation,
    // however alike it looks: a new conversation in a folder that had one
    // would otherwise be sent to the old one.
    pool = rows.filter((r) => !r.born || Math.abs(r.born - born) <= BORN_TOGETHER_MS);
    if (!pool.length) return null;
  }

  // 2. Same title.
  if (name) {
    const same = pool.filter((r) => r.title === name);
    if (same.length === 1) return same[0].id;
    if (same.length > 1) pool = same;
  }

  // 3. Last active at the same time.
  let best = null;
  let gap = Infinity;
  for (const r of pool) {
    const g = Math.abs(r.at - at);
    if (g < gap) { gap = g; best = r; }
  }
  if (best && gap <= CLOSE_ENOUGH_MS) return best.id;

  // The only conversation in the folder, and nothing says it is a different
  // one: no start time to compare, and no title on one side or the other.
  if (rows.length === 1 && pool.length === 1 && !pool[0].born && (!name || !pool[0].title)) return pool[0].id;
  return null;
}

function linkFor(cwd, lastEventAt, title, startedAt) {
  const id = match(cwd, lastEventAt, title, startedAt);
  return id ? `claude://claude.ai/epitaxy/${id}` : null;
}

module.exports = { linkFor, match, MAP_FILE };
