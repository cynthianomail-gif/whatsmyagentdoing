// The notes on the board: a few lines of the user's own, kept by the server
// (src/notes.js). The office page and the notes window (notes.html) both use
// this, and the windows of one browser tell each other as soon as one changes.
(() => {
  'use strict';

  const COLORS = ['#ffe066', '#ff9ec0', '#8fd3ff', '#b5e48c'];
  const MAX = 12;
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  // Where a notes window was left, so it opens there the next time.
  const PLACE = 'wmad.noteWin.';
  const between = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
  const fits = (p) => !!p && between(p.w, 120, 2400) && between(p.h, 100, 2000) && between(p.x, -8000, 8000) && between(p.y, -8000, 8000);
  function placeOf(name) {
    try {
      const p = JSON.parse(localStorage.getItem(PLACE + name));
      if (fits(p)) return p;
    } catch { /* no place on record */ }
    return null;
  }
  // A notes window calls this: it writes down where it is whenever that changes.
  // (A minimised window reports a place far off the screen, which is not kept.)
  function keepPlace() {
    const name = window.name;
    if (!/^wmad-notes?(-|$)/.test(name)) return;
    let last = '';
    const put = () => {
      const p = { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight };
      const now = JSON.stringify(p);
      if (now === last || !fits(p)) return;
      last = now;
      try { localStorage.setItem(PLACE + name, now); } catch { /* fine without */ }
    };
    setInterval(put, 1500);
    window.addEventListener('resize', put);
    window.addEventListener('pagehide', put);
  }

  class NoteBook {
    // text(): the words to use (I18N rep.notes).
    // changed(): the list is different now.
    // render(focusId): draw the notes again, if they are on show.
    // opened(id): a window was opened, for one note or (no id) for all of them.
    // canPop: whether a note offers to open in a window of its own.
    constructor({ text, changed, render, opened, canPop = true }) {
      this.text = text;
      this.changed = changed || (() => {});
      this.render = render || (() => {});
      this.opened = opened || (() => {});
      this.canPop = canPop;
      this.list = [];
      this.loaded = false;
      this.private = false;
      this.dirty = false;
      this.timer = 0;
      this.trash = null;
      this.status = '';
      this.bad = false;
      this.heardAt = 0;
      this.pinned = null;
      try {
        this.chan = new BroadcastChannel('whatsmyagentdoing-notes');
        this.chan.onmessage = (e) => this.heard(e.data);
      } catch { this.chan = null; }
      // Another browser may have changed the notes: look again on coming back,
      // unless a window of this browser has just said what they are.
      window.addEventListener('focus', () => {
        if (Date.now() - this.heardAt < 3000) return;
        this.load().then((differs) => { if (differs) this.render(); });
      });
      window.addEventListener('blur', () => { this.flush(); });
      window.addEventListener('pagehide', () => { this.flush(); });
    }

    get todo() { return this.list.filter((n) => !n.done); }
    colour(n) { return COLORS[n.color] || COLORS[0]; }

    post(message) {
      try { if (this.chan) this.chan.postMessage(message); } catch { /* the other windows catch up when they are looked at */ }
    }

    // What another window of this browser says. Its list is the newest there
    // is: this window told it of every change here the moment it was made.
    heard(data) {
      if (!data || this.private) return;
      if (data.hello) { if (this.dirty) this.post({ notes: this.list }); return; }
      if (!Array.isArray(data.notes)) return;
      this.list = data.notes;
      this.loaded = true;
      this.heardAt = Date.now();
      this.changed();
      this.render();
    }

    // Read the notes from the server. True when they are not what was here.
    async load() {
      if (this.dirty) return false;   // what is on the page is newer
      const first = !this.loaded, at = this.heardAt;
      const was = first ? null : JSON.stringify(this.list);
      try {
        const r = await fetch('/api/notes').then((x) => x.json());
        if (this.dirty || this.heardAt !== at) return false;
        this.list = Array.isArray(r.notes) ? r.notes : [];
        this.private = !!r.private;
        this.loaded = true;
      } catch { /* keep what is here */ }
      // a window with a change it has not saved yet answers with its list
      if (first && this.loaded) this.post({ hello: true });
      this.changed();
      return this.loaded && JSON.stringify(this.list) !== was;
    }

    say(text, bad) {
      this.status = text || '';
      this.bad = !!bad;
      const el = document.getElementById('noteStatus');
      if (el) { el.textContent = this.status; el.className = this.bad ? 'bad' : ''; }
    }

    // Every change is saved a moment later, and at once when the window is left.
    save() {
      this.dirty = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 500);
      this.post({ notes: this.list });
      this.changed();
    }

    async flush() {
      clearTimeout(this.timer);
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const res = await fetch('/api/notes', {
          method: 'PUT', keepalive: true,
          headers: { 'content-type': 'application/json', 'x-whatsmyagentdoing': 'notes' },
          body: JSON.stringify({ notes: this.list }),
        });
        if (!res.ok) throw new Error(String(res.status));
        if (!this.dirty) this.say(this.text().saved);
      } catch { this.dirty = true; this.say(this.text().saveFail, true); }
    }

    card(n) {
      const N = this.text();
      const dots = COLORS.map((c, i) => `<button type="button" data-n="color" data-c="${i}" class="${i === n.color ? 'on' : ''}" style="background:${c}" title="${esc(N.color)}" aria-label="${esc(N.color)} ${i + 1}"></button>`).join('');
      const pop = this.canPop ? `<button type="button" class="pop" data-n="pop" title="${esc(N.pop)}" aria-label="${esc(N.pop)}">↗</button>` : '';
      return `<div class="note${n.done ? ' done' : ''}" data-id="${esc(n.id)}" style="--paper:${this.colour(n)}">
      <textarea maxlength="300" placeholder="${esc(N.hint)}" aria-label="${esc(N.hint)}">${esc(n.text)}</textarea>
      <div class="bar"><label><input type="checkbox" data-n="done"${n.done ? ' checked' : ''}>${esc(N.done)}</label><span class="dots">${dots}</span>${pop}<button type="button" class="del" data-n="del" title="${esc(N.del)}" aria-label="${esc(N.del)}">✕</button></div>
    </div>`;
    }

    // The line under the notes: whether it saved, the way back from a delete.
    foot(count = true) {
      const N = this.text();
      const full = count && this.list.length >= MAX;
      return `<div class="notes-foot"><span id="noteStatus" class="${this.bad ? 'bad' : ''}">${esc(this.status)}</span>${this.trash ? `<span>${esc(N.deleted)}</span><button type="button" data-n="undo">${esc(N.undo)}</button>` : ''}${full ? `<span>${esc(N.full(MAX))}</span>` : ''}</div>`;
    }

    // Why there are no notes to show, when there are none to show.
    unseen() {
      const N = this.text();
      return this.private ? `<div class="sub">${esc(N.private)}</div>` : !this.loaded ? `<div class="sub">${esc(N.loadFail)}</div>` : '';
    }

    // All the notes, and the one to add.
    body() {
      const N = this.text();
      const room = this.list.length < MAX;
      return this.unseen() || `<div class="notes">${this.list.map((n) => this.card(n)).join('')}${room ? `<button type="button" class="note add" data-n="add">＋ ${esc(N.add)}</button>` : ''}</div>
    ${this.foot()}`;
    }

    // A window of its own, for one note or for all of them, that can sit
    // anywhere on the desktop. It opens where it was last left.
    open(id) {
      this.flush();
      const name = id ? 'wmad-note-' + id : 'wmad-notes';
      const at = placeOf(name) || (id ? { w: 260, h: 240 } : { w: 380, h: 560 });
      // (a bar the browser adds can take some of the height: never open smaller than a note needs)
      const spec = ['popup=1', 'width=' + Math.max(at.w, 200), 'height=' + Math.max(at.h, 160)];
      if (at.x != null) spec.push('left=' + at.x, 'top=' + at.y);
      let win = null;
      try { win = window.open('/notes' + (id ? '?id=' + encodeURIComponent(id) : ''), name, spec.join(',')); } catch { /* blocked */ }
      if (!win) { this.say(this.text().popFail, true); return null; }
      try { win.focus(); } catch { /* it is open all the same */ }
      this.opened(id);
      return win;
    }

    // Whether this page can put the notes in a window that stays on top of
    // every other one (Document Picture-in-Picture: Chrome and Edge).
    get canPin() {
      return window.top === window && typeof (window.documentPictureInPicture || {}).requestWindow === 'function';
    }

    // All the notes in a small window that stays on top of everything, as a
    // sticky note does. Asked for again, the window is put away. It holds the
    // notes page itself (/notes?pin=1), which goes on saving while this page
    // is in the background. The browser keeps one such window at a time.
    async pin() {
      if (this.pinned) {
        const old = this.pinned;
        this.pinned = null;
        try { old.close(); } catch { /* it is gone already */ }
        this.render();
        return null;
      }
      this.flush();
      let win = null;
      try { win = await window.documentPictureInPicture.requestWindow({ width: 300, height: 420 }); } catch { /* not in this browser */ }
      if (!win) { this.say(this.text().pinFail, true); return null; }
      if (win.closed) return null;
      this.pinned = win;
      win.addEventListener('pagehide', () => {
        if (this.pinned !== win) return;
        this.pinned = null;
        this.render();
      }, { once: true });
      const d = win.document;
      d.title = this.text().tab;
      const style = d.createElement('style');
      style.textContent = 'html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}';
      d.head.append(style);
      const frame = d.createElement('iframe');
      frame.title = this.text().tab;
      frame.src = new URL('/notes?pin=1', location.href).href;
      d.body.append(frame);
      this.opened();
      return win;
    }

    input(e) {
      const card = e.target.closest && e.target.closest('.note[data-id]');
      const n = card && e.target.tagName === 'TEXTAREA' && this.list.find((x) => x.id === card.dataset.id);
      if (n) { n.text = e.target.value; this.save(); }
    }

    click(e) {
      const el = e.target.closest('[data-n]');
      if (!el) return;
      const act = el.dataset.n;
      const card = el.closest('.note[data-id]');
      const i = card ? this.list.findIndex((x) => x.id === card.dataset.id) : -1;
      const n = this.list[i];
      if (act === 'add') {
        if (this.list.length >= MAX) return;
        const id = Math.random().toString(36).slice(2, 10) || 'n';
        const last = this.list[this.list.length - 1];
        this.list.push({ id, text: '', color: last ? (last.color + 1) % COLORS.length : 0, done: false, at: Date.now() });
        this.save();
        this.render(id);
      } else if (act === 'undo') {
        const t = this.trash;
        this.trash = null;
        if (t && this.list.length < MAX) this.list.splice(Math.min(t.i, this.list.length), 0, t.note);
        this.save();
        this.render();
      } else if (act === 'popall') {
        this.open();
      } else if (act === 'pin') {
        this.pin();
      } else if (!n) {
        return;
      } else if (act === 'pop') {
        this.open(n.id);
      } else if (act === 'done') {
        n.done = el.checked;
        card.classList.toggle('done', n.done);
        this.save();
      } else if (act === 'color') {
        n.color = Number(el.dataset.c) || 0;
        card.style.setProperty('--paper', this.colour(n));
        for (const b of card.querySelectorAll('[data-n=color]')) b.classList.toggle('on', b === el);
        this.save();
      } else if (act === 'del') {
        this.trash = { note: n, i };
        this.list.splice(i, 1);
        this.save();
        this.render();
      }
    }
  }

  NoteBook.COLORS = COLORS;
  NoteBook.MAX = MAX;
  NoteBook.esc = esc;
  NoteBook.keepPlace = keepPlace;
  window.NoteBook = NoteBook;
})();
