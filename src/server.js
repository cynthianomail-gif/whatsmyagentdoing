'use strict';

const fs = require('fs');
const http = require('http');
const { guessFromPrompts } = require('./lang');
const desktop = require('./desktop');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/office.js': ['office.js', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/popout.js': ['popout.js', 'text/javascript; charset=utf-8'],
};
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MOUNTS = { '/assets/': path.join(__dirname, '..', 'assets') };
const updater = require('./update');
const { ompResumeCommand } = require('./omp');
const { dayKey } = require('./parsers');
const { DAY: REPORT_DAY } = require('./reports');

function serveFile(res, root, rel) {
  const file = path.normalize(path.join(root, rel));
  const type = TYPES[path.extname(file)];
  if (!type || !file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  // no-cache: an updated clone must show up on reload
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
const ACTIVE = new Set(['thinking', 'tool', 'typing']);

// Logs only record finished blocks, so a few states need a clock to resolve:
// a reply with no follow-up is a finished turn, and an "active" session that
// has gone silent for a long time was most likely closed mid-turn.
function view(s, now, { privacy }) {
  const quiet = now - (s.lastEventAt || s.mtime || now);
  let status = s.status;
  if (status === 'typing' && !s.explicitLifecycle && quiet > 45_000) status = 'done';
  if (status === 'typing' && s.explicitLifecycle && quiet > 15 * 60_000) status = 'idle';
  if (status === 'thinking' && s.source !== 'magpie' && quiet > 15 * 60_000) status = 'idle';
  if (status === 'tool' && quiet > 45 * 60_000) status = 'idle';
  if ((status === 'waiting' || status === 'error') && quiet > 2 * 3600_000) status = 'idle';
  // Still "active" but silent for a while: likely stuck (a hung tool, a lost prompt).
  const stuckAfter = status === 'tool' ? 10 * 60_000 : status === 'thinking' ? 8 * 60_000 : Infinity;
  const stuck = quiet > stuckAfter ? Math.floor(quiet / 60_000) : 0;

  const out = {
    key: `${s.agent}:${s.id}`,
    agent: s.agent,
    ...(s.source === 'magpie' ? { source: s.source, agentName: s.agentName } : {}),
    id: s.id,
    sessionId: s.sessionId || null,
    parentId: s.parentId,
    subagent: s.subagent,
    cwd: s.cwd,
    project: s.cwd ? `${s.agent === 'copilot' ? 'workspace-' : ''}${path.basename(s.cwd)}` : null,
    title: s.title,
    model: s.model,
    status,
    stuck,
    context: s.context ? { used: s.context, window: s.contextWindow || null } : null,
    today: s.daily && s.daily.day === dayKey(now) ? { turns: s.daily.turns, tokens: s.daily.tokens } : null,
    activity: status === 'tool' || status === 'waiting' ? s.activity : null,
    prompt: s.prompt,
    reply: s.reply,
    error: s.error,
    turnStartedAt: s.turnStartedAt,
    lastEventAt: s.lastEventAt || s.mtime,
    startedAt: s.startedAt,
  };
  // Clicking a person jumps to that conversation in the Claude desktop app.
  // Only whole Claude Code sessions on this machine have one; a subagent is
  // not a window of its own, and the other clients are not the desktop app.
  if (s.agent === 'claude' && !s.subagent && s.source !== 'magpie') {
    out.deepLink = desktop.linkFor(s.cwd, out.lastEventAt, s.title, s.startedAt);
  }
  if (s.agent === 'omp' && s.source !== 'magpie') {
    out.ompProfile = s.ompProfile || null;
    // OMP subagents can't be resumed on their own.
    out.resumeCommand = s.subagent || !s.file ? null : ompResumeCommand(s);
  }
  if (privacy) {
    out.prompt = out.reply = out.title = null;
    if (out.activity) out.activity = out.activity.split(/[:\s]/)[0];
  }
  return out;
}

// The language the user writes their prompts in (recent sessions first);
// the page uses it as the default UI language.
function promptLanguage(raw) {
  const recent = raw
    .filter((s) => !s.subagent && s.prompt && !s.prompt.startsWith('/'))
    .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0))
    .slice(0, 60)
    .map((s) => s.prompt);
  return guessFromPrompts(recent);
}

// Today's totals across every session seen today, main sessions and subagents alike.
function summary(sessions, now) {
  // Folder names are keys here, so no prototype: a project called __proto__ stays a project.
  const out = { day: dayKey(now), turns: 0, tokens: 0, agents: 0, byAgent: Object.create(null), projects: Object.create(null) };
  for (const s of sessions) {
    if (!s.today) continue;
    out.agents += 1;
    out.turns += s.today.turns;
    out.tokens += s.today.tokens;
    const a = (out.byAgent[s.agent] ||= { sessions: 0, turns: 0, tokens: 0 });
    a.sessions += 1; a.turns += s.today.turns; a.tokens += s.today.tokens;
    if (s.project) out.projects[s.project] = (out.projects[s.project] || 0) + s.today.turns;
  }
  return out;
}

function snapshot(watcher, opts) {
  const now = Date.now();
  const raw = watcher.sessions();
  const sessions = raw.map((s) => view(s, now, opts));
  sessions.sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
  return { now, lang: opts.demo ? null : promptLanguage(raw), sessions, summary: summary(sessions, now) };
}

function createServer(watcher, opts, { onShutdown, onRestart, reports, notes } = {}) {
  const clients = new Set();
  let last = '';

  const push = (force) => {
    let body;
    try {
      const snap = snapshot(watcher, opts);
      // each day's report is kept as the day goes (see reports.js)
      if (reports) reports.note(snap);
      body = JSON.stringify(snap);
    } catch (e) { console.error('snapshot failed:', e.message); return; }
    // Compare without the timestamp so idle ticks don't spam clients.
    const sig = body.replace(/^\{"now":\d+,/, '{');
    if (!force && sig === last) return;
    last = sig;
    for (const res of clients) res.write(`data: ${body}\n\n`);
  };
  watcher.on('change', () => push(false));
  // Status can flip with no new log lines (see view()), so re-check on a clock.
  setInterval(() => push(false), 5000).unref();
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000).unref();

  const server = http.createServer((req, res) => {
    // Refuse anything not addressed to loopback (blocks DNS-rebinding pages
    // from reading your prompts through this server).
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
    } else if (Object.keys(MOUNTS).some((m) => url.pathname.startsWith(m))) {
      const m = Object.keys(MOUNTS).find((k) => url.pathname.startsWith(k));
      let rel;
      try { rel = decodeURIComponent(url.pathname.slice(m.length)); }
      catch { res.writeHead(400).end(); return; }
      serveFile(res, MOUNTS[m], rel);
    } else if (url.pathname === '/api/transcript') {
      // --private hides prompts and replies everywhere, so it hides the conversation too.
      const key = url.searchParams.get('key') || '';
      const messages = opts.privacy || key.length > 600 ? null : watcher.transcript?.(key);
      res.writeHead(messages ? 200 : opts.privacy ? 403 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(messages ? { messages } : { messages: [], private: !!opts.privacy }));
    } else if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot(watcher, opts)));
    } else if (url.pathname === '/api/shutdown' && req.method === 'POST') {
      // Only our CLI sends this header; a web page can't add a custom header
      // to a cross-site request without a CORS preflight, which we never allow.
      if (req.headers['x-whatsmyagentdoing'] !== 'stop' || !onShutdown) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      for (const c of clients) c.end();
      if (reports) reports.save();
      setTimeout(onShutdown, 50);
    } else if (url.pathname === '/api/version') {
      updater.checkLatest().finally(() => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(updater.info()));
      });
    } else if (url.pathname === '/api/update' && req.method === 'POST') {
      // Same guard as shutdown: web pages can't send this header cross-site.
      if (req.headers['x-whatsmyagentdoing'] !== 'update') { res.writeHead(403).end(); return; }
      updater.update().then(
        (version) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, version }));
          for (const c of clients) c.end();
          if (onRestart) setTimeout(onRestart, 100);
        },
        (e) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); },
      );
    } else if (url.pathname === '/api/reports') {
      // the days there is a report for, oldest first
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ today: dayKey(Date.now()), days: reports ? reports.days() : [] }));
    } else if (url.pathname === '/api/report') {
      const day = url.searchParams.get('day') || '';
      const report = reports && REPORT_DAY.test(day) ? reports.get(day, { privacy: opts.privacy }) : null;
      res.writeHead(report ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(report || { day, sessions: [] }));
    } else if (url.pathname === '/api/notes' && req.method === 'GET') {
      // the notes on the notice board; what the user wrote is theirs, so --private shows none
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(opts.privacy ? { notes: [], private: true } : { notes: notes ? notes.list() : [] }));
    } else if (url.pathname === '/api/notes' && req.method === 'PUT') {
      // Same guard as shutdown: web pages can't send this header cross-site.
      if (req.headers['x-whatsmyagentdoing'] !== 'notes' || !notes || opts.privacy) { res.writeHead(403).end(); return; }
      const chunks = [];
      let size = 0, over = false;
      req.on('data', (c) => {
        if (over) return;
        size += c.length;
        if (size > 65536) { over = true; res.writeHead(413).end(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (over) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { res.writeHead(400).end(); return; }
        try {
          const kept = notes.set(body && body.notes);
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ notes: kept }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
    } else if (url.pathname === '/api/ping') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ app: 'whatsmyagentdoing' }));
    } else if (url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot(watcher, opts))}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404).end();
    }
  });
  return server;
}

module.exports = { createServer, snapshot };
