'use strict';

// The day's report, kept day by day so an earlier one can be read again.
//
// The page builds its report from what the server knows right now, and that
// is gone at midnight. So the server keeps a small record of each day as it
// goes, one file per day in ~/.whatsmyagentdoing/reports, holding only what
// the report shows: a title, a folder name and the day's counts per session.
// No prompts, no replies.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.whatsmyagentdoing', 'reports');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SAVE_EVERY = 15_000;

function totals(rec) {
  let turns = 0, tokens = 0, cats = 0;
  for (const s of Object.values(rec.sessions)) {
    turns += s.turns; tokens += s.tokens;
    if (!s.subagent && (s.turns || s.tokens)) cats += 1;
  }
  return { day: rec.day, turns, tokens, cats };
}

function createReports({ dir = DIR, now = Date.now } = {}) {
  let rec = null;        // the day being written
  let dirty = false;
  let savedAt = 0;
  let index = null;      // day -> totals, for every day on disk

  const fileFor = (day) => path.join(dir, day + '.json');

  function read(day) {
    if (!DAY.test(day)) return null;
    try {
      const r = JSON.parse(fs.readFileSync(fileFor(day), 'utf8'));
      if (!r || r.day !== day || !r.sessions || typeof r.sessions !== 'object') return null;
      // no prototype: a session's key is a key here
      return { day, sessions: Object.assign(Object.create(null), r.sessions) };
    } catch { return null; }
  }

  function save() {
    if (!rec || !dirty) return;
    dirty = false;
    savedAt = now();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = fileFor(rec.day) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ day: rec.day, sessions: rec.sessions }));
      fs.renameSync(tmp, fileFor(rec.day));
    } catch (e) { console.error('report not saved:', e.message); }
  }

  // Take in a snapshot (the one sent to the page). Counts only ever go up
  // within a day: a restart re-reads the logs, and a very large log is only
  // partly read, so a smaller number later is not news.
  function note(snap) {
    const day = snap && snap.summary && snap.summary.day;
    if (!DAY.test(day || '')) return;
    if (!rec || rec.day !== day) {
      save();
      rec = read(day) || { day, sessions: Object.create(null) };
    }
    for (const s of snap.sessions) {
      if (!s.today || typeof s.key !== 'string') continue;
      const was = rec.sessions[s.key];
      const next = {
        agent: s.agent,
        subagent: !!s.subagent,
        title: s.title || (was && was.title) || null,
        project: s.project || (was && was.project) || null,
        turns: Math.max(s.today.turns || 0, was ? was.turns : 0),
        tokens: Math.max(s.today.tokens || 0, was ? was.tokens : 0),
        used: s.context ? s.context.used : was ? was.used : 0,
        window: s.context ? s.context.window : was ? was.window : null,
        // finished a turn at some point in the day, and the longest it sat stuck
        done: s.status === 'done' || !!(was && was.done),
        stuck: Math.max(s.stuck || 0, was ? was.stuck : 0),
      };
      if (!was || Object.keys(next).some((k) => next[k] !== was[k])) {
        rec.sessions[s.key] = next;
        dirty = true;
      }
    }
    if (dirty && now() - savedAt >= SAVE_EVERY) save();
    if (index && dirty) index.set(day, totals(rec));
  }

  // One day, in the shape the page's report is built from.
  function get(day, { privacy } = {}) {
    const r = rec && rec.day === day ? rec : read(day);
    if (!r) return null;
    return {
      ...totals(r),
      sessions: Object.entries(r.sessions).map(([key, s]) => ({
        key, agent: s.agent, subagent: s.subagent,
        title: privacy ? null : s.title, project: s.project,
        today: { turns: s.turns, tokens: s.tokens },
        context: s.used ? { used: s.used, window: s.window } : null,
        done: s.done, stuck: s.stuck,
      })),
    };
  }

  // Every day there is a report for, oldest first.
  function days() {
    if (!index) {
      index = new Map();
      let names = [];
      try { names = fs.readdirSync(dir); } catch { /* none yet */ }
      for (const n of names) {
        const day = n.endsWith('.json') ? n.slice(0, -5) : '';
        const r = read(day);
        if (r) index.set(day, totals(r));
      }
    }
    if (rec) index.set(rec.day, totals(rec));
    return [...index.values()].filter((d) => d.turns || d.tokens).sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  return { note, get, days, save };
}

module.exports = { createReports, DAY };
