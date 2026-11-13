'use strict';

// The team's planning board (企劃時程統籌看板, a Google Apps Script page), as
// the day's report shows it: what falls due today and this week, and what is
// overdue.
//
// The board gives its data at <board url>?format=office&key=<key> (a small
// addition to its doGet). The address is kept in ~/.whatsmyagentdoing/board.json
// (`node bin/cli.js --board <url>`). The rules below are the board's own
// (cellState, ownersFor, flatItems in its index.html), so the office and the
// board agree on what is done, overdue or whose.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.whatsmyagentdoing');
const CONFIG = path.join(DIR, 'board.json');
const EVERY = 30 * 60 * 1000;     // look at the board this often
const SHOW = 40;                  // at most this many items in a group

// ---- the board's own words and rules
const DONE_W = ['已完成', '完成', '已上線', '已上架', '驗收完成', '企劃驗收完成', 'QC完成',
  '平台QC完成', '總部QC完成', '已回檔', 'TRUE', '領證', '已驗收'];
const NA_W = ['不製作', '無', '無需求', '不上架', '-', '－'];
const DOING_W = ['進行中', '製作中', '處理中', '調整中', '申請中', 'QC中', 'RD處理中'];
const DEPT2ROLE = { 開案組: 'kickoff', 視覺組: 'visual', 節奏組: 'pacing', PM: 'pm', PM組: 'pm' };
const NOT_PERSON = /^(?:[SMLＳＭＬ]|XS|XL|2XL|3XL|ＸＬ|ＸＳ)$/i;

const nz = (s) => (s == null ? '' : String(s)).replace(/\s+/g, '').trim();
const clean = (s) => (s == null ? '' : String(s)).replace(/[👑★☆*]/gu, '').replace(/\(.*?\)/g, '').replace(/（.*?）/g, '').trim();
const dnum = (d) => (d ? +String(d).replace(/-/g, '') : 0);
const DAY = /^\d{4}-\d\d-\d\d$/;
function addDays(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(y, m - 1, day + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
// the Sunday that ends the week (Monday to Sunday) a day is in
function weekEnd(d) {
  const [y, m, day] = d.split('-').map(Number);
  const wd = (new Date(y, m - 1, day).getDay() + 6) % 7;   // Monday 0 … Sunday 6
  return addDays(d, 6 - wd);
}

function people(s) {
  const raw = (s == null ? '' : String(s)).trim();
  if (!raw || raw === '-' || raw === '－') return [];
  return raw.split(/[\n、,，/]+/).map((x) => clean(x.trim()))
    .filter((c) => c && c !== '-' && c !== '－' && !NOT_PERSON.test(c) && !/^[0-9.,%-]+$/.test(c));
}

function cellState(due, actual, status, today) {
  const s = nz(status);
  if (NA_W.includes(s)) return 'na';
  if (DONE_W.includes(s)) return 'done';
  if (!s && actual) return 'done';
  const soon = addDays(today, 7);
  if (DOING_W.includes(s) && (!due || dnum(due) > dnum(soon))) return 'doing';
  if (!due) return 'none';
  if (dnum(due) < dnum(today)) return 'over';
  if (dnum(due) <= dnum(soon)) return 'soon';
  return 'up';
}

function ownersFor(g, def) {
  const out = [];
  const add = (list) => { for (const p of list) if (!out.includes(p)) out.push(p); };
  for (const d of def.depts || []) {
    const r = DEPT2ROLE[d];
    if (r) add(people(g[r]));
    else if (g.dept && g.dept[d] && g.dept[d].owner) add(people(g.dept[d].owner));
  }
  if (!out.length) {
    const L = def.label || '';
    const guess = L.includes('2D') ? '2D' : L.includes('FX') ? 'FX' : L.includes('前端') ? '前端'
      : L.includes('後端') ? '後端' : (L.includes('音效') || L.includes('音樂')) ? '音效' : '';
    if (guess && g.dept && g.dept[guess] && g.dept[guess].owner) return people(g.dept[guess].owner);
  }
  return out;
}

// Whether a person is on a game at all (the board's personHit).
function personHit(g, roles, name) {
  for (const r of roles || []) if (people(g[r.key]).includes(name)) return true;
  for (const k of Object.keys(g.dept || {})) if (people(g.dept[k] && g.dept[k].owner).includes(name)) return true;
  return false;
}

// The board's default view of both platforms (綜合): games set aside (封存,
// 不上架, 入庫…) left out, planning items only, done and not-made hidden.
// With a person, as the board's 人員 filter: only the games they are on, and
// of those only their items and the items nobody is named for.
function boardDay(feed, { person = '' } = {}) {
  if (!feed || feed.ok !== true || !feed.platforms) throw new Error((feed && feed.msg) || 'the board gave no data');
  const today = DAY.test(feed.today || '') ? feed.today : null;
  if (!today) throw new Error('the board gave no date');
  const end = weekEnd(today);
  const groups = { today: [], week: [], over: [] };
  for (const plat of Object.keys(feed.platforms).sort()) {
    const pf = feed.platforms[plat] || {};
    const defs = Array.isArray(pf.milestoneDefs) ? pf.milestoneDefs : [];
    for (const g of Array.isArray(pf.games) ? pf.games : []) {
      if (!g || g.excl) continue;
      if (person && !personHit(g, pf.roles, person)) continue;
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i] || {};
        if (def.virtual || !def.planning) continue;
        const cell = Array.isArray(g.m) ? g.m[i] : null;
        if (!cell || !DAY.test(cell[0] || '')) continue;
        const due = cell[0];
        const state = cellState(due, cell[1], cell[2], today);
        if (state === 'done' || state === 'na') continue;
        const owners = ownersFor(g, def);
        if (person && owners.length && !owners.includes(person)) continue;
        const item = { game: String(g.name || g.code || '?'), plat: pf.label || plat, what: String(def.label || ''), due, state, owners };
        if (due < today) groups.over.push(item);
        else if (due === today) groups.today.push(item);
        else if (due <= end) groups.week.push(item);
      }
    }
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.game.localeCompare(b.game)));
  const counts = { today: groups.today.length, week: groups.week.length, over: groups.over.length };
  // the oldest overdue items are the least likely to matter today: the newest are kept
  groups.over = groups.over.slice(-SHOW).reverse();
  groups.today = groups.today.slice(0, SHOW);
  groups.week = groups.week.slice(0, SHOW);
  return { day: today, weekEnd: end, person, generatedAt: String(feed.generatedAt || ''), counts, items: groups };
}

// ---- where the board is, and what it said last
const URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec\?(?:.*&)?format=office(?:&|$)/;
const PERSON_OK = (s) => typeof s === 'string' && s.length <= 40 && !/[\n\r]/.test(s);
function readConfig(file = CONFIG) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!c || typeof c.url !== 'string' || !URL_OK.test(c.url)) return null;
    return { url: c.url, person: PERSON_OK(c.person) ? c.person.trim() : '' };
  } catch { return null; }
}
// url: the board's office address, or '' / 'off' to stop looking; person: whose items ('' for all)
function writeConfig({ url, person }, file = CONFIG) {
  const was = readConfig(file);
  if (url === '' || url === 'off') { try { fs.unlinkSync(file); } catch { /* not there */ } return null; }
  const next = { url: url || (was && was.url), person: person != null ? String(person).trim() : (was ? was.person : '') };
  if (!next.url || !URL_OK.test(next.url)) throw new Error('expected the board address ending in /exec?format=office&key=…');
  if (!PERSON_OK(next.person)) throw new Error('a person is a name, on one line');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 1));
  return next;
}

// Looks at the board now and then; `state()` is what the report shows.
function createBoard({ file = CONFIG, fetchImpl = globalThis.fetch, now = Date.now, every = EVERY } = {}) {
  let last = null, error = '', at = 0, busy = null, timer = null;
  async function refresh() {
    const cfg = readConfig(file);
    if (!cfg) { last = null; error = ''; return state(); }
    if (busy) return busy;
    busy = (async () => {
      const ctl = new AbortController();
      const stop = setTimeout(() => ctl.abort(), 30000);
      try {
        const res = await fetchImpl(cfg.url, { redirect: 'follow', signal: ctl.signal });
        if (!res.ok) throw new Error('the board answered ' + res.status);
        last = boardDay(await res.json(), { person: cfg.person });
        error = '';
      } catch (e) {
        error = e.name === 'AbortError' ? 'the board did not answer' : String(e.message || e);
      } finally {
        clearTimeout(stop);
        at = now();
        busy = null;
      }
      return state();
    })();
    return busy;
  }
  function state() {
    const configured = !!readConfig(file);
    return { configured, ok: !!last && !error, error, checkedAt: at || null, day: configured ? last : null };
  }
  function start() {
    refresh();
    timer = setInterval(refresh, every);
    if (timer.unref) timer.unref();
    return api;
  }
  function stop() { clearInterval(timer); }
  // what the report asks: the last look, or a new one when that is old
  async function get() {
    if (readConfig(file) && (!at || now() - at > every)) await refresh();
    return state();
  }
  const api = { refresh, state, get, start, stop };
  return api;
}

module.exports = { boardDay, cellState, ownersFor, people, weekEnd, readConfig, writeConfig, createBoard, CONFIG };
