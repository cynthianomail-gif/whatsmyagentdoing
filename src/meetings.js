'use strict';

// Today's meetings, as notes on the notice board.
//
// The office cannot sign in to Teams or Outlook. An agent that can (Claude
// with its Microsoft 365 connector) reads the day's meetings and hands them
// over in a file: `node bin/cli.js --add-meetings meetings.json` (see
// SKILL.md). Each meeting becomes a note that reminds the user a little
// before it starts. A meeting handed over again updates its note instead of
// adding another; a cancelled one takes its note down.

const crypto = require('crypto');
const { MAX_NOTES, MAX_TEXT } = require('./notes');

const LEAD = 10 * 60 * 1000;   // remind this long before a meeting starts
const COLOR = 2;               // meetings go on blue paper
const WHEN = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/;

const newId = () => Math.random().toString(36).slice(2, 10) || 'n';
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

// A time as Outlook gives it: a wall-clock string and the zone it is in,
// either as two fields or as { dateTime, timeZone }. UTC is read as UTC;
// any other zone is taken to be this computer's own (the mailbox and the
// computer are in the same place).
function when(v, zone) {
  if (v && typeof v === 'object') { zone = v.timeZone; v = v.dateTime; }
  if (typeof v !== 'string') return NaN;
  const m = WHEN.exec(v.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const utc = /Z$/i.test(v.trim()) || /^(utc|gmt|z|etc\/utc)$/i.test(String(zone || '').trim());
  return utc ? Date.UTC(y, mo - 1, d, h, mi, s || 0) : new Date(y, mo - 1, d, h, mi, s || 0).getTime();
}

// The same meeting always gets the same mark, and nothing of its id shows.
const markOf = (m, start) => 'teams:' + crypto.createHash('sha1')
  .update(String(m.id || m.iCalUId || (m.subject + '|' + start)))
  .digest('hex').slice(0, 16);

function textOf(m, start, end) {
  const subject = String(m.subject || '').replace(/\s+/g, ' ').trim() || '(no title)';
  let loc = m.location;
  if (loc && typeof loc === 'object') loc = loc.displayName;
  loc = String(loc || '').replace(/\s+/g, ' ').trim();
  return (`📅 ${hhmm(start)}–${hhmm(end)} ${subject}` + (loc ? `\n📍 ${loc}` : '')).slice(0, MAX_TEXT);
}

// The notes with the meetings in them. `list` is not changed.
function mergeMeetings(list, meetings, { now = Date.now(), lead = LEAD, max = MAX_NOTES } = {}) {
  const notes = (Array.isArray(list) ? list : []).map((n) => ({ ...n }));
  const r = { added: 0, updated: 0, removed: 0, skipped: { cancelled: 0, allDay: 0, over: 0, bad: 0, full: 0 } };
  const items = (Array.isArray(meetings) ? meetings : [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({ m, start: when(m.start, m.timeZone), end: when(m.end, m.timeZone) }))
    .sort((a, b) => (a.start || 0) - (b.start || 0));
  for (const { m, start, end } of items) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) { r.skipped.bad += 1; continue; }
    const src = markOf(m, start);
    const at = notes.findIndex((n) => n.src === src);
    if (m.isCancelled === true) {
      if (at >= 0) { notes.splice(at, 1); r.removed += 1; } else r.skipped.cancelled += 1;
      continue;
    }
    if (m.isAllDay === true) { r.skipped.allDay += 1; continue; }
    if (end <= now) { r.skipped.over += 1; continue; }
    const text = textOf(m, start, end);
    const remind = start - lead;
    const begun = start <= now;      // already on: nobody needs telling
    if (at >= 0) {
      const n = notes[at];
      if (n.text === text && n.remind === remind) continue;
      n.text = text;
      if (n.remind !== remind) { n.remind = remind; n.reminded = begun; }
      r.updated += 1;
    } else if (notes.length >= max) {
      r.skipped.full += 1;
    } else {
      let id = newId();
      while (notes.some((n) => n.id === id)) id = newId();
      notes.push({ id, text, color: COLOR, done: false, at: now, remind, reminded: begun, src });
      r.added += 1;
    }
  }
  return { notes, ...r };
}

// What the agent hands over: a list, or { meetings: [...] }, or Graph's { value: [...] }.
function readMeetings(raw) {
  const data = JSON.parse(String(raw).replace(/^﻿/, ''));
  const list = Array.isArray(data) ? data : data && (data.meetings || data.value || data.events);
  if (!Array.isArray(list)) throw new Error('expected a list of meetings');
  return list;
}

function summary(r) {
  const s = r.skipped;
  const parts = [`added ${r.added}`, `updated ${r.updated}`];
  if (r.removed) parts.push(`removed ${r.removed} (cancelled)`);
  const why = [['over', 'already over'], ['allDay', 'all-day'], ['cancelled', 'cancelled'], ['bad', 'unreadable time'], ['full', 'board full (12 notes)']]
    .filter(([k]) => s[k]).map(([k, t]) => `${s[k]} ${t}`);
  return `Meetings: ${parts.join(', ')}${why.length ? `; skipped ${why.join(', ')}` : ''}.`;
}

module.exports = { mergeMeetings, readMeetings, summary, when, LEAD };
