// Isometric office: agents that are working sit at cubicle desks; a few that
// are off duty wander between the pantry, lounge, meeting room and ping-pong
// table. Plain canvas 2D with local provider logos, no dependencies.
(() => {
  'use strict';

  const TW = 64; // tile width px
  const TH = 32; // tile height px; one z unit is TH px too
  const WALL_H = 2.4;
  const WORKING = new Set(['thinking', 'tool', 'typing', 'waiting', 'error']);
  const MAX_WANDERERS = 7;
  const SPEED = 2.1; // tiles / second

  // The office is staffed by cats. One breed per session, picked from its key,
  // so a conversation is always the same cat. At this size what reads is the
  // coat, the ears and the face, so that is what the breeds differ in.
  const BREEDS = [
    { id: 'orange',  fur: '#e8913f', dark: '#bd6a1c', belly: '#f8ddba', ear: '#f0a8a8', eye: '#4e8f45', whisk: 'rgba(40,30,20,.55)', stripes: true },
    { id: 'tuxedo',  fur: '#30303a', dark: '#17171d', belly: '#f3f3ef', ear: '#9c7676', eye: '#d8b63c', whisk: 'rgba(255,255,255,.8)' },
    { id: 'calico',  fur: '#f5f0e7', dark: '#cfc5b4', belly: '#ffffff', ear: '#f0b8b8', eye: '#d8b63c', whisk: 'rgba(40,30,20,.5)', patches: true },
    { id: 'black',   fur: '#27272d', dark: '#131317', belly: '#35353d', ear: '#7a5c5c', eye: '#dcbb3e', whisk: 'rgba(255,255,255,.8)' },
    { id: 'white',   fur: '#f4f2eb', dark: '#d6d2c6', belly: '#ffffff', ear: '#f3b9b9', eye: '#6fa8d6', whisk: 'rgba(40,30,20,.5)' },
    { id: 'russian', fur: '#8d97a3', dark: '#67717e', belly: '#b3bcc6', ear: '#b08e8e', eye: '#74c078', whisk: 'rgba(255,255,255,.75)' },
    { id: 'siamese', fur: '#e9dec8', dark: '#4a3a33', belly: '#f7f0e2', ear: '#4a3a33', eye: '#6fa8d6', whisk: 'rgba(40,30,20,.5)', mask: true },
    { id: 'ragdoll', fur: '#f0e7d9', dark: '#6b5a52', belly: '#fbf7ef', ear: '#6b5a52', eye: '#5b8fd0', whisk: 'rgba(40,30,20,.45)', mask: true },
  ];

  // ---- Pixel sprites ----------------------------------------------------
  // A cat is drawn one pixel at a time into a small offscreen canvas and then
  // blitted with smoothing off, so the pixels stay hard at any zoom. Each look
  // is built once and cached: 500 pixels per cat per frame per session would
  // cost real time, and a cat only has a handful of looks.
  // One art pixel is ART world units, so a 64x32 floor tile is a 32x16
  // pixel diamond - the classic isometric tile. The camera only ever zooms
  // to a whole number of screen pixels per art pixel, which is what keeps
  // every sprite and every edge on one grid.
  const ART = 2;
  // Colours are snapped to a coarse ramp. A limited palette is half of what
  // makes a scene read as pixel art; without it the same wall arrives in six
  // nearly identical browns.
  const QUANT = 12;
  const quantCache = new Map();
  function quant(col) {
    if (typeof col !== 'string' || col.indexOf('gradient') > -1) return col;
    let hit = quantCache.get(col);
    if (hit) return hit;
    let r, g, b, a = 1;
    if (col[0] === '#') {
      const h = col.length === 4
        ? col[1] + col[1] + col[2] + col[2] + col[3] + col[3]
        : col.slice(1, 7);
      const n = parseInt(h, 16);
      r = n >> 16; g = (n >> 8) & 255; b = n & 255;
      if (col.length === 9) a = parseInt(col.slice(7, 9), 16) / 255;
    } else {
      const m = col.match(/-?[\d.]+/g);
      if (!m || m.length < 3) return col;
      r = +m[0]; g = +m[1]; b = +m[2];
      if (m.length > 3) a = +m[3];
    }
    const q = (v) => Math.min(255, Math.round(v / QUANT) * QUANT);
    hit = a < 1 ? `rgba(${q(r)},${q(g)},${q(b)},${a})` : `rgb(${q(r)},${q(g)},${q(b)})`;
    quantCache.set(col, hit);
    return hit;
  }
  // 19x21 art pixels with a one-pixel margin for the outline: 38x42 world
  // units, about the height the drawn figure used to stand. PXC is the
  // column the cat is centred on.
  const PXW = 19, PXH = 21, PXC = 9;
  const PX_T = 0, PX_INK = 1, PX_FUR = 2, PX_DARK = 3, PX_BELLY = 4, PX_PINK = 5, PX_EYE = 6, PX_HI = 7, PX_IRIS = 8, PX_GINGER = 9, PX_SOOT = 10;
  const INK_HEX = '#241f1c';
  const spriteCache = new Map();

  const pxGrid = () => Array.from({ length: PXH }, () => new Uint8Array(PXW));
  const pxPut = (g, x, y, v) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < PXW && y >= 0 && y < PXH) g[y][x] = v;
  };
  // Tested per cell rather than stroked, so the edge is a hard pixel staircase
  // instead of an anti-aliased smudge.
  function pxEllipse(g, cx, cy, rx, ry, v) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.02) pxPut(g, x, y, v);
      }
  }
  function pxTri(g, ax, ay, bx, by, cx, cy, v) {
    const s = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    for (let y = Math.floor(Math.min(ay, by, cy)); y <= Math.ceil(Math.max(ay, by, cy)); y++)
      for (let x = Math.floor(Math.min(ax, bx, cx)); x <= Math.ceil(Math.max(ax, bx, cx)); x++) {
        const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay);
        if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) pxPut(g, x, y, v);
      }
  }
  // Every empty cell touching the body becomes outline. One clean ring around
  // the silhouette is what makes it read as pixel art rather than as blocks.
  function pxOutline(g) {
    const out = g.map((r) => Uint8Array.from(r));
    for (let y = 0; y < PXH; y++) for (let x = 0; x < PXW; x++) {
      if (g[y][x] !== PX_T) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < PXW && ny >= 0 && ny < PXH && g[ny][nx] !== PX_T && g[ny][nx] !== PX_INK) { out[y][x] = PX_INK; break; }
      }
    }
    return out;
  }

  function catGrid(br, seated, front, eyes) {
    const g = pxGrid();
    const hcx = PXC, hcy = 8.2, hrx = 5.6, hry = 4.8;
    const bcy = seated ? 15.2 : 15.0, brx = seated ? 4.8 : 4.0, bry = seated ? 4.0 : 4.4;
    const earFur = br.mask ? PX_DARK : PX_FUR;
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
    const darkFace = !!br.mask || lum(br.fur) < 90;
    // Ears first, head over them: the roots vanish into the head, and the tips
    // have to clear the head's ellipse or they end up as two bumps.
    pxTri(g, hcx - 5.4, hcy - 1.6, hcx - 4.2, hcy - 7.6, hcx - 1.6, hcy - 3.0, earFur);
    pxTri(g, hcx + 5.4, hcy - 1.6, hcx + 4.2, hcy - 7.6, hcx + 1.6, hcy - 3.0, earFur);
    pxEllipse(g, hcx, bcy, brx, bry, PX_FUR);
    pxEllipse(g, hcx, bcy + 0.8, brx - 2.0, bry - 1.3, PX_BELLY);
    for (const sx of [-1, 1]) pxEllipse(g, hcx + sx * 2.3, bcy + bry - 0.5, 1.4, 1.0, PX_BELLY);
    if (br.patches) pxEllipse(g, hcx + 3, bcy - 1, 1.6, 1.6, PX_SOOT);
    pxEllipse(g, hcx, hcy, hrx, hry, PX_FUR);
    if (front) {
      pxPut(g, hcx - 4, hcy - 4.4, PX_PINK); pxPut(g, hcx - 4, hcy - 5.4, PX_PINK);
      pxPut(g, hcx + 4, hcy - 4.4, PX_PINK); pxPut(g, hcx + 4, hcy - 5.4, PX_PINK);
    }
    if (br.stripes) for (const dx of [-2, 0, 2]) for (let k = 0; k < 2; k++) pxPut(g, hcx + dx, 4 + k, PX_DARK);
    if (br.patches) {
      // Kept high and to the sides: a patch over an eye reads as an eyepatch.
      pxEllipse(g, hcx - 4, hcy - 3, 1.6, 1.4, PX_GINGER);
      pxEllipse(g, hcx + 4, hcy - 3, 1.4, 1.2, PX_SOOT);
    }
    if (br.mask && front) pxEllipse(g, hcx, hcy + 1.4, 3.2, 2.6, PX_DARK);

    if (front) {
      const ey = 8;
      for (const ex of [hcx - 3, hcx + 2]) {
        if (eyes === 'shut') {
          pxPut(g, ex, ey + 1, PX_EYE); pxPut(g, ex + 1, ey + 1, PX_EYE);
          continue;
        }
        // A pale face gets a tall dark eye with one highlight and a fleck of
        // iris. A dark face gets the eye in the iris colour instead, since a
        // dark eye on dark fur simply disappears. An iris band across the
        // middle was tried first and made every cat look half-asleep.
        const lit = darkFace ? PX_IRIS : PX_EYE;
        pxPut(g, ex, ey - 1, PX_HI); pxPut(g, ex + 1, ey - 1, lit);
        pxPut(g, ex, ey, lit); pxPut(g, ex + 1, ey, lit);
        pxPut(g, ex, ey + 1, lit); pxPut(g, ex + 1, ey + 1, darkFace ? PX_EYE : PX_IRIS);
        if (eyes === 'wide') { pxPut(g, ex, ey - 2, lit); pxPut(g, ex + 1, ey - 2, lit); }
      }
      pxPut(g, hcx, ey + 3, PX_PINK);
      pxPut(g, hcx - 1, ey + 4, PX_INK); pxPut(g, hcx + 1, ey + 4, PX_INK);
      // Blush in pink, never in the shade colour: dark cheeks read as dirt on
      // a pale cat.
      pxPut(g, hcx - 4, ey + 3, PX_PINK); pxPut(g, hcx + 4, ey + 3, PX_PINK);
    }
    return pxOutline(g);
  }

  function catSprite(br, seated, front, eyes) {
    const key = `${br.id}|${seated ? 's' : 'u'}|${front ? 'f' : 'b'}|${eyes}`;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = PXW; cv.height = PXH;
    const c = cv.getContext('2d');
    const g = catGrid(br, seated, front, eyes);
    for (let y = 0; y < PXH; y++) for (let x = 0; x < PXW; x++) {
      const v = g[y][x];
      if (v === PX_T) continue;
      c.fillStyle = v === PX_INK ? INK_HEX : v === PX_EYE ? '#21212b' : v === PX_HI ? '#ffffff'
        : v === PX_FUR ? br.fur : v === PX_DARK ? br.dark : v === PX_BELLY ? br.belly
        : v === PX_PINK ? br.ear : v === PX_GINGER ? '#e8913f' : v === PX_SOOT ? '#3a3a45' : br.eye;
      c.fillRect(x, y, 1, 1);
    }
    spriteCache.set(key, cv);
    return cv;
  }

  const SKIN = ['#f3cfb0', '#e5b38f', '#c98d66', '#9a6646', '#6e4630', '#f7dcc7'];
  const HAIR = ['#2a2019', '#4b3020', '#8a4b2a', '#c99a5b', '#1c1c1c', '#8c8c8c', '#a33a2c', '#3d3550'];
  const SHIRT = {
    claude: ['#c96442', '#d9825f', '#b4553a', '#e09a72'],
    codex: ['#10a37f', '#2bb38f', '#0d8a6b', '#4cc3a0'],
    gemini: ['#4f7cf0', '#6b8ff5', '#3d66d6', '#8aa6f8'],
    copilot: ['#8f5cf5', '#a06af7', '#7a47d5', '#c5a4ff'],
    omp: ['#a96926', '#c78942', '#8d531e', '#dca45c'],
    pi: ['#4f8eb3', '#6ba5c7', '#3d7596', '#9cc7df'],
    antigravity: ['#0ea5e9', '#38bdf8', '#0284c7', '#7dd3fc'],
    opencode: ['#2f6fd0', '#4a86e0', '#2559b0', '#7aa5ee'],
    hermes: ['#b4622d', '#d07c44', '#96501f', '#e2a374'],
  };
  // Official product icons, shared by both renderers and the page UI (OMP: a neutral monogram).
  // Load once per page from the same origin so video capture stays readable.
  // Initials remain a fallback if an image cannot be loaded.
  const AGENT_BADGES = {
    claude: { label: 'Claude', short: 'Cl', color: '#c96442', logo: '/assets/agents/claude.png' },
    codex: { label: 'Codex', short: 'Cx', color: '#10a37f', logo: '/assets/agents/codex.png' },
    gemini: { label: 'Gemini', short: 'G', color: '#4f7cf0', logo: '/assets/agents/gemini.png' },
    copilot: { label: 'Copilot', short: 'Co', color: '#8f5cf5', logo: '/assets/agents/copilot.svg', mono: true },
    kimi: { label: 'Kimi Code', short: 'Ki', logo: '/assets/agents/kimi.svg', mono: true },
    dsh: { label: 'DSH', short: 'Ds', logo: '/assets/agents/dsh.svg' },
    grok: { label: 'Grok Build', short: 'Gr', logo: '/assets/agents/grok.svg', mono: true },
    omp: { label: 'OMP', short: 'OMP', color: '#a96926', logo: '/assets/agents/omp.svg' },
    pi: { label: 'Pi', short: 'Pi', color: '#4f8eb3', logo: '/assets/agents/pi.svg' },
    antigravity: { label: 'Antigravity', short: 'Ag', color: '#0ea5e9', logo: '/assets/agents/antigravity.png' },
    opencode: { label: 'OpenCode', short: 'Oc', color: '#2f6fd0', logo: '/assets/agents/opencode.svg', mono: true },
    hermes: { label: 'Hermes', short: 'He', color: '#b4622d', logo: '/assets/agents/hermes.svg', mono: true },
  };
  for (const badge of Object.values(AGENT_BADGES)) {
    badge.image = new Image();
    badge.image.src = badge.logo;
  }
  const PANTS = ['#34405a', '#2c2c34', '#4a3f35', '#3b4a3f'];
  const PANEL = ['#7d93c4', '#d98b6a', '#7fb08a', '#c9a24c'];

  const STATUS_COLOR = {
    thinking: '#8b6be6', tool: '#3b8ee0', typing: '#22a874', waiting: '#e09412',
    done: '#5f9a4c', error: '#de4b40', interrupted: '#9b9a94', idle: '#9b9a94',
  };

  const ACT_EMOJI = {
    coffee: '☕', water: '💧', fridge: '🍎', sink: '🫧', stool: '💬', couch: '💬', beanbag: '🎧',
    window: '☁️', read: '📖', whiteboard: '✏️', meeting: '💬', arcade: '🎮', pingpong: '🏓', plant: '🌱',
    vending: '🥤', foosball: '⚽', phone: '📞',
  };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const pick = (arr, h, salt) => arr[(Math.imul(h ^ Math.imul(salt, 2654435761), 2246822519) >>> 0) % arr.length];
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function palette() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return dark ? {
      dark: true,
      wood1: '#4a3f35', wood2: '#453a31', woodLine: 'rgba(0,0,0,.22)',
      tileA: '#3d4044', tileB: '#35383c', carpet: '#33404d', carpetLine: 'rgba(255,255,255,.04)',
      wallL: '#4a4640', wallR: '#3f3b36', wallTop: '#5a554e', trim: '#2b2926',
      deskTop: '#8a6a4c', deskL: '#6e533b', deskR: '#5c4431',
      monitor: '#18181a', screenOff: '#26282c', chair: '#2d2d32',
      rug: '#47544f', rugEdge: '#3a4541', couch: '#5b6b8c', couchD: '#4a587a',
      counter: '#d9d4c9', counterL: '#a9a397', counterR: '#958f84', metal: '#8d939a',
      glass: 'rgba(160,200,230,.10)', glassEdge: 'rgba(190,220,240,.35)', mat: '#2f4a3a',
      text: '#ecebe6', tagBg: 'rgba(20,20,19,.78)', bubble: '#f4f3ee', bubbleInk: '#1c1c1a',
      plant: '#4f8a52', pot: '#9a5b3c', shadow: 'rgba(0,0,0,.28)', book: ['#c96442', '#3b8ee0', '#5f9a4c', '#c9a24c', '#8b6be6'],
    } : {
      dark: false,
      wood1: '#e6d3b6', wood2: '#dfcaab', woodLine: 'rgba(120,90,50,.12)',
      tileA: '#f4f4f1', tileB: '#e6e7e3', carpet: '#c9d3dc', carpetLine: 'rgba(0,0,0,.035)',
      wallL: '#f4efe6', wallR: '#e8e1d4', wallTop: '#fbf8f2', trim: '#cfc5b3',
      deskTop: '#c89f72', deskL: '#a8825a', deskR: '#946f4b',
      monitor: '#2a2a2e', screenOff: '#3a3d44', chair: '#4a4a52',
      rug: '#c4d4cb', rugEdge: '#a9bcb1', couch: '#7d93c4', couchD: '#6a80b0',
      counter: '#fbfaf7', counterL: '#d9d4c9', counterR: '#c9c3b6', metal: '#b5bcc4',
      glass: 'rgba(170,210,235,.16)', glassEdge: 'rgba(120,160,190,.55)', mat: '#bfd8c4',
      text: '#1c1c1a', tagBg: 'rgba(255,255,255,.9)', bubble: '#ffffff', bubbleInk: '#1c1c1a',
      plant: '#5a9b5d', pot: '#b86f4b', shadow: 'rgba(60,40,20,.18)', book: ['#c96442', '#3b8ee0', '#5f9a4c', '#c9a24c', '#8b6be6'],
    };
  }

  function skyColor(d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60;
    if (h >= 7 && h < 17) return { sky: '#a9d4f2', night: false };
    if (h >= 5 && h < 7) return { sky: '#f3c9a8', night: false };
    if (h >= 17 && h < 19) return { sky: '#f0a679', night: false };
    return { sky: '#1d2747', night: true };
  }

  // ---------------------------------------------------------------- A* grid

  class Grid {
    constructor(W, D, res = 4) {
      this.res = res;
      this.cw = Math.ceil(W * res);
      this.ch = Math.ceil(D * res);
      this.cost = new Uint8Array(this.cw * this.ch);
    }
    block(x, y, w, d, pad = 0.12) {
      const R = this.res;
      const i0 = clamp(Math.floor((x - pad) * R), 0, this.cw - 1);
      const i1 = clamp(Math.ceil((x + w + pad) * R) - 1, 0, this.cw - 1);
      const j0 = clamp(Math.floor((y - pad) * R), 0, this.ch - 1);
      const j1 = clamp(Math.ceil((y + d + pad) * R) - 1, 0, this.ch - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cost[j * this.cw + i] = 1;
    }
    blocked(x, y) {
      const i = Math.floor(x * this.res), j = Math.floor(y * this.res);
      if (i < 0 || j < 0 || i >= this.cw || j >= this.ch) return true;
      return !!this.cost[j * this.cw + i];
    }
    path(ax, ay, bx, by) {
      const R = this.res, cw = this.cw, ch = this.ch;
      const si = clamp(Math.floor(ax * R), 0, cw - 1), sj = clamp(Math.floor(ay * R), 0, ch - 1);
      const gi = clamp(Math.floor(bx * R), 0, cw - 1), gj = clamp(Math.floor(by * R), 0, ch - 1);
      const N = cw * ch;
      const g = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = [];
      const push = (f, n) => {
        heap.push([f, n]);
        let k = heap.length - 1;
        while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
      };
      const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let k = 0;
          for (;;) {
            const l = 2 * k + 1, r = l + 1;
            let m = k;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === k) break;
            [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
          }
        }
        return top;
      };
      const hfn = (i, j) => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
      // Blocked cells are expensive, not impossible, so a path always exists
      // (someone standing right against furniture can still step away).
      const stepCost = (n) => (this.cost[n] ? 25 : 1);
      const start = sj * cw + si, goal = gj * cw + gi;
      g[start] = 0;
      push(hfn(si, sj), start);
      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
      while (heap.length) {
        const [, n] = pop();
        if (n === goal) break;
        if (closed[n]) continue;
        closed[n] = 1;
        const i = n % cw, j = (n / cw) | 0;
        for (const [di, dj, c] of dirs) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cw || nj >= ch) continue;
          if (di && dj && (this.cost[j * cw + ni] || this.cost[nj * cw + i])) continue;
          const nn = nj * cw + ni;
          const ng = g[n] + c * stepCost(nn);
          if (ng < g[nn]) { g[nn] = ng; came[nn] = n; push(ng + hfn(ni, nj), nn); }
        }
      }
      const cells = [];
      for (let n = goal; n !== -1 && n !== start; n = came[n]) cells.push(n);
      cells.reverse();
      const pts = [];
      let lastDir = null;
      for (let k = 0; k < cells.length; k++) {
        const n = cells[k];
        const dir = n - (k ? cells[k - 1] : start);
        const pt = { x: ((n % cw) + 0.5) / R, y: (((n / cw) | 0) + 0.5) / R };
        if (dir === lastDir && pts.length) pts[pts.length - 1] = pt;
        else pts.push(pt);
        lastDir = dir;
      }
      if (pts.length) pts[pts.length - 1] = { x: bx, y: by };
      else pts.push({ x: bx, y: by });
      return pts;
    }
  }

  // ---------------------------------------------------------------- office

  class Office {
    constructor(root, { onHover, label, onFrame, showAgent = true, compact = false } = {}) {
      this.root = root;
      this.onHover = onHover || (() => {});
      this.label = label || ((s) => s.project || s.agent);
      this.onFrame = onFrame;
      this.showAgent = showAgent;
      this.compact = compact;
      this.offDutyLabel = 'went home';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'office-canvas';
      root.appendChild(this.canvas);
      this.vctx = this.canvas.getContext('2d');
      this.ctx = this.vctx;
      this.people = new Map();
      this.deskOf = new Map();
      this.offDuty = 0;
      this.first = true;
      this.visible = true;
      this.hit = [];
      this.hoverKey = null;
      this.t = performance.now();
      this.pal = palette();
      this.plan = this.buildPlan(0);
      this.cat = { x: this.plan.W - 3, y: this.plan.D - 2, path: [], until: 0, face: 1 };
      this.theme = matchMedia('(prefers-color-scheme: dark)');
      this.onTheme = () => (this.pal = palette());
      this.theme.addEventListener('change', this.onTheme);

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(root);
      this.canvas.addEventListener('mousemove', (e) => this.pointer(e));
      this.canvas.addEventListener('click', (e) => this.pointer(e, true));
      this.canvas.addEventListener('mouseleave', () => { this.hoverKey = null; this.onHover(null); });
      this.resize();
      this.last = performance.now();
      // Resolves true once a few frames have been drawn with data in place,
      // false if the renderer gave up (3D load failure).
      this.ready = new Promise((ok) => (this.markReady = ok));
      this.framesShown = 0;
      const loop = (t) => { if (this.dead) return; this.frame(t); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }

    destroy() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      this.ro.disconnect();
      this.theme.removeEventListener('change', this.onTheme);
      this.canvas.remove();
    }

    // ------------------------------------------------------------ floor plan

    buildPlan(nWorking) {
      const pal = this.pal;
      const pods = Math.max(2, Math.ceil((nWorking + 2) / 4));
      const podCols = pods <= 4 ? 2 : 3;
      const podRows = Math.ceil(pods / podCols);
      const OW = 1.3 + (podCols - 1) * 4.2 + 3.9; // open office width
      const OD = podRows * 4.7 + 0.8;             // open office depth (pods)
      const D = Math.max(OD + 3.6, 14.5);
      const RW = 7.2;                              // right column width
      const W = OW + RW;
      const MR = 5.2;                              // meeting room depth
      const PY = 9.9;                              // pantry / lounge boundary
      const grid = new Grid(W, D);
      const items = [];
      const pois = [];
      const desks = [];
      const add = (depth, draw) => items.push({ depth, draw });
      // Semantic list of what is where, for renderers that don't use the 2D
      // draw closures (the 3D view).
      const props = [];
      const prop = (t, o) => props.push({ t, ...o });
      const solid = (x, y, w, d, pad) => grid.block(x, y, w, d, pad);
      const poi = (x, y, act, face, opt = {}) => pois.push({ x, y, act, face, sit: 0, ...opt });

      // Long boxes are split into ~1 tile pieces so depth sorting against
      // people stays right along their length. `extra(x0, x1)` draws things on
      // the front face of each piece (books on a shelf, etc).
      const longBox = (x, y, z, w, d, h, top, left, right, opts = {}) => {
        const n = Math.max(1, Math.ceil(Math.max(w, d) / 0.9));
        for (let k = 0; k < n; k++) {
          const sx = w >= d ? x + (w / n) * k : x, sy = w >= d ? y : y + (d / n) * k;
          const sw = w >= d ? w / n : w, sd = w >= d ? d : d / n;
          add(sx + sw / 2 + sy + sd / 2 + (opts.bias || 0), () => {
            this.box(sx, sy, z, sw, sd, h, top, left, right);
            if (opts.extra) opts.extra(sx, sx + sw);
          });
        }
      };

      // ---- cubicle pods: 4 desks back to back with a divider
      for (let p = 0; p < pods; p++) {
        const c = p % podCols, r = Math.floor(p / podCols);
        const px = 1.3 + c * 4.2, py = 2.0 + r * 4.7;
        const panel = PANEL[p % PANEL.length];
        for (let k = 0; k < 2; k++) {
          const x = px + k * 1.5;
          desks.push({ x, y: py, side: 'n', seat: { x: x + 0.7, y: py - 0.45 } });
          desks.push({ x, y: py + 0.92, side: 's', seat: { x: x + 0.7, y: py + 0.92 + 1.25 } });
          solid(x, py, 1.4, 0.8, 0.08);
          solid(x, py + 0.92, 1.4, 0.8, 0.08);
        }
        longBox(px - 0.1, py + 0.82, 0, 3.15, 0.08, 1.15, this.shade(panel, 25), panel, this.shade(panel, -15), { bias: 0.05 });
        prop('panel', { x: px - 0.1, y: py + 0.82, w: 3.15, d: 0.08, h: 1.15, color: panel });
        prop('panel', { x: px - 0.18, y: py - 0.05, w: 0.08, d: 1.82, h: 1.15, color: panel });
        add(px - 0.1 + py + 0.86, () => this.box(px - 0.18, py - 0.05, 0, 0.08, 1.82, 1.15, this.shade(panel, 25), panel, this.shade(panel, -15)));
        solid(px - 0.18, py + 0.8, 3.25, 0.12, 0.05);
      }

      // ---- open office extras
      const rx = OW - 1.15;
      add(rx + 0.35 + 0.5, () => this.serverRack(rx, 0.2));
      prop('rack', { x: rx, y: 0.2 });
      prop('printer', { x: OW - 2.3, y: 0.25 });
      solid(rx, 0.2, 0.7, 0.6);
      add(OW - 2.3 + 0.3 + 0.5, () => this.printer(OW - 2.3, 0.25));
      solid(OW - 2.3, 0.25, 0.75, 0.55);
      for (const [x, y] of [[0.45, 0.45], [0.45, OD - 0.2]]) { add(x + y, () => this.plant(x, y)); prop('plant', { x, y }); solid(x - 0.2, y - 0.2, 0.4, 0.4); }
      const windows = [];
      for (let x = 1.0; x < OW - 2.6; x += 2.4) {
        windows.push(x);
        poi(x + 0.75, 0.75, 'window', 'back');
      }
      poi(0.95, OD - 0.2, 'plant', 'back');

      // ---- ping-pong corner
      const tx = 2.4, ty = OD + 1.0;
      add(tx + 1.3 + ty + 0.7, () => this.pingpong(tx, ty));
      prop('pingpong', { x: tx, y: ty });
      solid(tx, ty, 2.6, 1.4, 0.05);
      poi(tx - 0.55, ty + 0.7, 'pingpong', 'side', { pair: 'pp' });
      poi(tx + 3.15, ty + 0.7, 'pingpong', 'side', { pair: 'pp' });
      const pp = { x0: tx - 0.2, x1: tx + 2.8, y: ty + 0.7 };

      // ---- front corner: vending machines, foosball, phone booth
      const fy = OD + 3.7;
      if (D - fy >= 3.4) {
        add(0.5 + fy + 0.4, () => this.vending(0.12, fy, '#c0392b'));
        prop('vending', { x: 0.12, y: fy, color: '#c0392b' });
        prop('vending', { x: 0.12, y: fy + 0.8, color: '#2f6fb0' });
        add(0.5 + fy + 1.2, () => this.vending(0.12, fy + 0.8, '#2f6fb0'));
        solid(0.1, fy, 0.75, 1.55);
        poi(1.3, fy + 0.4, 'vending', 'back');
        poi(1.3, fy + 1.2, 'vending', 'back');
      }
      if (D - fy >= 2.2) {
        const fx = 3.0, fby = fy + 0.4;
        add(fx + 0.8 + fby + 0.4, () => this.foosball(fx, fby));
        prop('foosball', { x: fx, y: fby });
        solid(fx, fby, 1.6, 0.8, 0.05);
        poi(fx - 0.45, fby + 0.4, 'foosball', 'side', { pair: 'fb' });
        poi(fx + 2.05, fby + 0.4, 'foosball', 'side', { pair: 'fb' });
        const bx = OW - 2.0, by = fy;
        this.booth(add, bx, by);
        prop('booth', { x: bx, y: by });
        solid(bx - 0.05, by - 0.05, 1.4, 0.1, 0.03);
        solid(bx - 0.05, by - 0.05, 0.1, 1.4, 0.03);
        solid(bx + 1.25, by - 0.05, 0.1, 1.4, 0.03);
        solid(bx + 0.85, by + 1.25, 0.5, 0.1, 0.03);
        poi(bx + 0.65, by + 0.6, 'phone', 'front', { sit: 0.45 });
        add(OW - 0.45 + D - 0.6, () => this.plant(OW - 0.45, D - 0.6));
        prop('plant', { x: OW - 0.45, y: D - 0.6 });
      }

      // ---- meeting room behind glass, door at y 3.6–4.6
      const mx = OW;
      for (const [y, d] of [[0, 1], [1, 1], [2, 1], [3, 0.6], [4.6, MR - 4.6]]) this.glassX(add, mx, y, d);
      for (let x = mx; x < W - 0.01; x += 1) this.glassY(add, x, MR, Math.min(1, W - x));
      prop('glass', { x: mx, y: 0, w: 0, d: 3.6 });
      prop('glass', { x: mx, y: 4.6, w: 0, d: MR - 4.6 });
      prop('glass', { x: mx, y: MR, w: RW, d: 0 });
      solid(mx - 0.05, 0, 0.1, 3.6, 0.05);
      solid(mx - 0.05, 4.6, 0.1, MR - 4.6, 0.05);
      solid(mx, MR - 0.05, RW, 0.1, 0.05);
      const mtx = mx + 1.6, mty = 1.7;
      add(mtx + 1.5 + mty + 0.7, () => this.meetingTable(mtx, mty));
      prop('meetingTable', { x: mtx, y: mty, w: 3.0, d: 1.4 });
      solid(mtx, mty, 3.0, 1.4);
      for (let k = 0; k < 3; k++) {
        const cx = mtx + 0.5 + k * 1.0;
        add(cx + mty - 0.45, () => this.stool(cx, mty - 0.4, 0.4, '#555c66'));
        add(cx + mty + 1.78, () => this.stool(cx, mty + 1.8, 0.4, '#555c66'));
        poi(cx, mty - 0.4, 'meeting', 'front', { sit: 0.42 });
        prop('chair', { x: cx, y: mty - 0.4, face: 'front' });
        prop('chair', { x: cx, y: mty + 1.8, face: 'back' });
        poi(cx, mty + 1.8, 'meeting', 'back', { sit: 0.42 });
      }
      poi(mx + 3.6, 0.65, 'whiteboard', 'back');
      add(W - 0.45 + 0.45, () => this.plant(W - 0.45, 0.45));
      prop('plant', { x: W - 0.45, y: 0.45 });
      solid(W - 0.65, 0.25, 0.4, 0.4);

      // ---- pantry
      const cy = MR + 0.3;
      longBox(mx + 1.0, cy, 0, RW - 2.3, 0.7, 0.9, pal.counter, pal.counterL, pal.counterR, { bias: -0.5 });
      solid(mx + 1.0, cy, RW - 2.3, 0.7);
      prop('counter', { x: mx + 1.0, y: cy, w: RW - 2.3, d: 0.7 });
      prop('coffee', { x: mx + 2.4, y: cy + 0.12 });
      prop('sink', { x: mx + 3.9, y: cy + 0.12 });
      prop('fridge', { x: W - 1.15, y: cy });
      prop('cooler', { x: mx + 0.35, y: cy + 0.05 });
      add(mx + 2.65 + cy + 0.35, () => this.coffeeMachine(mx + 2.4, cy + 0.12));
      add(mx + 4.15 + cy + 0.35, () => this.sink(mx + 3.9, cy + 0.12));
      add(W - 0.75 + cy + 0.4, () => this.fridge(W - 1.15, cy));
      solid(W - 1.15, cy, 0.85, 0.75);
      add(mx + 0.55 + cy + 0.25, () => this.waterCooler(mx + 0.35, cy + 0.05));
      solid(mx + 0.3, cy, 0.5, 0.5);
      poi(mx + 2.65, cy + 1.2, 'coffee', 'back');
      poi(mx + 4.15, cy + 1.2, 'sink', 'back');
      poi(W - 0.75, cy + 1.3, 'fridge', 'back');
      poi(mx + 0.6, cy + 0.95, 'water', 'back');
      const rtx = mx + 3.6, rty = MR + 2.9;
      add(rtx + rty, () => this.roundTable(rtx, rty));
      prop('roundTable', { x: rtx, y: rty });
      solid(rtx - 0.45, rty - 0.45, 0.9, 0.9);
      for (const [sx, sy, face] of [[rtx - 1.0, rty, 'front'], [rtx + 1.0, rty, 'front'], [rtx, rty + 1.0, 'back'], [rtx, rty - 0.95, 'front']]) {
        add(sx + sy - 0.02, () => this.stool(sx, sy, 0.45, '#c9a24c'));
        poi(sx, sy, 'stool', face, { sit: 0.47 });
        prop('barStool', { x: sx, y: sy });
      }

      // ---- lounge
      const lx = mx + 0.6, ly = PY + 0.4;
      const shelfX = mx + 3.4, shelfW = RW - 3.6;
      longBox(shelfX, PY - 0.25, 0, shelfW, 0.45, 1.45, this.shade(pal.deskTop, -5), pal.deskL, pal.deskR, {
        extra: (x0, x1) => this.books(x0, x1, PY + 0.2),
      });
      solid(shelfX, PY - 0.25, shelfW, 0.45);
      prop('shelf', { x: shelfX, y: PY - 0.25, w: shelfW, d: 0.45 });
      poi(mx + 4.6, PY + 0.75, 'read', 'back');
      poi(mx + 5.8, PY + 0.75, 'read', 'back');
      add(lx + ly + 0.6, () => this.couch(lx, ly + 0.6));
      prop('couch', { x: lx, y: ly + 0.6, w: 2.8, d: 0.8 });
      prop('coffeeTable', { x: lx + 0.6, y: ly + 2.0, w: 1.6, d: 0.7 });
      prop('beanbag', { x: lx + 0.4, y: ly + 3.6, color: '#c96442' });
      prop('beanbag', { x: lx + 2.6, y: ly + 3.6, color: '#7d93c4' });
      solid(lx, ly + 0.6, 2.8, 0.8);
      for (let k = 0; k < 3; k++) poi(lx + 0.5 + k * 0.9, ly + 1.2, 'couch', 'front', { sit: 0.36 });
      add(lx + 1.4 + ly + 2.35, () => this.coffeeTable(lx + 0.6, ly + 2.0));
      solid(lx + 0.6, ly + 2.0, 1.6, 0.7);
      add(lx + 0.4 + ly + 3.6, () => this.beanbag(lx + 0.4, ly + 3.6, '#c96442'));
      add(lx + 2.6 + ly + 3.6, () => this.beanbag(lx + 2.6, ly + 3.6, '#7d93c4'));
      poi(lx + 0.4, ly + 3.6, 'beanbag', 'front', { sit: 0.18 });
      poi(lx + 2.6, ly + 3.6, 'beanbag', 'front', { sit: 0.18 });
      const ax = W - 1.2, ay = ly + 1.0;
      add(ax + 0.35 + ay + 0.35, () => this.arcade(ax, ay));
      prop('arcade', { x: ax, y: ay });
      prop('plant', { x: W - 0.5, y: D - 0.5 });
      prop('lamp', { x: lx - 0.2, y: D - 0.6 });
      prop('rug', { x: OW + 0.3, y: PY + 0.6, w: 4.0, d: D - PY - 1.0 });
      solid(ax, ay, 0.7, 0.7);
      poi(ax + 0.35, ay + 1.15, 'arcade', 'back');
      add(W - 0.5 + D - 0.5, () => this.plant(W - 0.5, D - 0.5));
      add(lx - 0.2 + D - 0.6, () => this.floorLamp(lx - 0.2, D - 0.6));

      const posters = [
        { y: 2.2, color: '#c96442', text: 'SHIP IT' },
        { y: 4.6, color: '#10a37f', text: 'TESTS ✓' },
      ];
      return { W, D, OW, OD, MR, PY, RW, grid, items, props, pois, desks, windows, posters, pp, door: { x: 0.4, y: D - 1.2 } };
    }

    glassX(add, x, y, d) {
      add(x + y + d / 2 + 0.02, () => {
        const P = (a, b, c) => this.iso(a, b, c);
        this.poly([P(x, y, 0), P(x, y + d, 0), P(x, y + d, 0.22), P(x, y, 0.22)], this.pal.trim);
        this.poly([P(x, y, 0.22), P(x, y + d, 0.22), P(x, y + d, 2.1), P(x, y, 2.1)], this.pal.glass, this.pal.glassEdge);
      });
    }

    glassY(add, x, y, w) {
      add(x + w / 2 + y + 0.02, () => {
        const P = (a, b, c) => this.iso(a, b, c);
        this.poly([P(x, y, 0), P(x + w, y, 0), P(x + w, y, 0.22), P(x, y, 0.22)], this.pal.trim);
        this.poly([P(x, y, 0.22), P(x + w, y, 0.22), P(x + w, y, 2.1), P(x, y, 2.1)], this.pal.glass, this.pal.glassEdge);
      });
    }

    // ------------------------------------------------------------ sessions → people

    update(sessions) {
      const working = sessions.filter((s) => WORKING.has(s.status));
      const off = sessions
        .filter((s) => !WORKING.has(s.status))
        .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
      const wanderers = off.slice(0, MAX_WANDERERS);
      this.offDuty = off.length - wanderers.length;

      const cap = this.plan.desks.length;
      // Scene packs have a fixed floor plan; the built-in office grows with the team.
      if (!this.plan.fixed && (working.length > cap - 1 || (cap > 8 && working.length < cap * 0.35))) {
        this.plan = this.buildPlan(working.length);
        this.deskOf.clear();
        for (const p of this.people.values()) { p.poi = null; p.napDesk = null; p.desk = null; p.until = 0; }
      }

      const workKeys = new Set(working.map((s) => s.key));
      for (const k of [...this.deskOf.keys()]) if (!workKeys.has(k)) this.deskOf.delete(k);
      const used = new Set(this.deskOf.values());
      // Fill the desks that face us first so more faces and screens show.
      const desks = this.plan.desks;
      const order = desks.map((d, i) => i).sort((a, b) => (desks[a].side === 's') - (desks[b].side === 's') || a - b);
      for (const s of [...working].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))) {
        if (this.deskOf.has(s.key)) continue;
        const i = order.find((n) => !used.has(n));
        if (i == null) continue;
        this.deskOf.set(s.key, i);
        used.add(i);
      }
      const takenDesks = new Set([...this.deskOf.values()].map((i) => desks[i]));

      const shown = new Set();
      for (const s of [...working, ...wanderers]) {
        const isWorker = this.deskOf.has(s.key);
        if (!isWorker && WORKING.has(s.status)) continue; // no desk left
        shown.add(s.key);
        let p = this.people.get(s.key);
        if (!p) { p = this.newPerson(s); this.people.set(s.key, p); }
        p.s = s;
        p.leaving = false;
        if (isWorker) {
          this.release(p);
          const desk = desks[this.deskOf.get(s.key)];
          if (p.desk !== desk || p.mode !== 'work') { p.desk = desk; this.goTo(p, desk.seat); }
          p.mode = 'work';
        } else {
          if (p.mode !== 'wander') { p.mode = 'wander'; p.desk = null; p.poi = null; p.until = 0; }
          // Someone started working at the desk this one was napping on.
          if (p.napDesk && takenDesks.has(p.napDesk)) { this.release(p); p.path = []; }
        }
      }
      for (const [k, p] of this.people) {
        if (!shown.has(k) && !p.leaving) {
          p.leaving = true;
          p.mode = 'leave';
          this.release(p);
          p.desk = null;
          this.goTo(p, this.plan.door);
        }
      }
      this.first = false;
    }

    release(p) {
      if (p.poi) { p.poi.taken = null; p.poi = null; }
      if (p.napDesk) { p.napDesk.napper = null; p.napDesk = null; }
    }

    newPerson(s) {
      const h = hash(s.key);
      const door = this.plan.door;
      return {
        key: s.key, h, s,
        skin: pick(SKIN, h, 3), hair: pick(HAIR, h, 7), pants: pick(PANTS, h, 13),
        shirt: pick(SHIRT[s.agent] || SHIRT.claude, h, 11),
        breed: pick(BREEDS, h, 3),
        hairStyle: h % 4,
        phase: (h % 1000) / 1000 * Math.PI * 2,
        x: door.x, y: door.y,
        path: [], walkFace: 'front', until: 0, mode: null,
        // On the first snapshot everyone is placed directly, no stampede.
        placeOnArrive: this.first,
      };
    }

    goTo(p, target) {
      if (p.placeOnArrive) {
        p.x = target.x; p.y = target.y; p.path = []; p.placeOnArrive = false;
        return;
      }
      p.path = this.plan.grid.path(p.x, p.y, target.x, target.y);
    }

    wander(p, now) {
      if (p.path.length) return;
      if (p.poi && now < p.until) return;
      this.release(p);
      const plan = this.plan;
      const workingDesks = new Set([...this.deskOf.values()].map((i) => plan.desks[i]));
      const sleepy = p.s.status === 'idle';
      const weighted = [];
      for (const q of plan.pois) {
        if (q.taken) continue;
        let w = 1;
        if (q.pair) w = plan.pois.some((o) => o.pair === q.pair && o !== q && o.taken) ? 7 : 1.2;
        if (q.act === 'couch' || q.act === 'beanbag' || q.sleepy) w = sleepy ? 3 : 1.4;
        weighted.push([q, w]);
      }
      for (const d of plan.noNap ? [] : plan.desks) {
        if (workingDesks.has(d) || d.napper) continue;
        weighted.push([{ x: d.seat.x, y: d.seat.y, act: 'nap', face: d.side === 'n' ? 'front' : 'back', sit: 0.34, desk: d }, sleepy ? 3 : 0.25]);
      }
      if (!weighted.length) return;
      let r = Math.random() * weighted.reduce((a, [, w]) => a + w, 0);
      let choice = weighted[0][0];
      for (const [q, w] of weighted) { r -= w; if (r <= 0) { choice = q; break; } }
      if (choice.desk) { choice.desk.napper = p.key; p.napDesk = choice.desk; }
      choice.taken = p.key;
      p.poi = choice;
      p.until = Infinity; // set on arrival
      p.stay = (choice.act === 'nap' ? rand(25, 60) : choice.act === 'pingpong' ? rand(15, 30) : rand(8, 20)) * 1000;
      this.goTo(p, choice);
    }

    setVisible(v) { this.visible = v; if (v) this.resize(); }

    // Room on the right covered by an overlay (the agent panel). The canvas
    // keeps its size; the view eases over so the room stays centred in what
    // is still visible, instead of the canvas resizing under the slide.
    setInset(px, animate = true) {
      const now = performance.now();
      this.insetFrom = animate ? this.inset(now) : px;
      this.insetTo = px;
      this.insetT0 = animate ? now : -Infinity;
    }
    inset(now = performance.now()) {
      if (this.insetTo == null) return 0;
      const k = Math.min(1, (now - this.insetT0) / 340);
      const e = 1 - Math.pow(1 - k, 3); // ease out, like the panel's slide
      return this.insetFrom + (this.insetTo - this.insetFrom) * e;
    }
    insetMoving(now = performance.now()) { return this.insetTo != null && now - this.insetT0 < 360; }

    // ------------------------------------------------------------ camera / input

    resize() {
      const r = this.root.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cw = Math.max(this.compact ? 1 : 200, r.width);
      this.ch = Math.max(this.compact ? 1 : 240, r.height);
      this.canvas.width = Math.round(this.cw * dpr);
      this.canvas.height = Math.round(this.ch * dpr);
      this.canvas.style.width = this.cw + 'px';
      this.canvas.style.height = this.ch + 'px';
      this.dpr = dpr;
      if (!this.buf) this.buf = document.createElement('canvas');
      this.ctx = this.buf.getContext('2d');
    }

    fitCamera() {
      const { W, D } = this.plan;
      const left = this.iso(0, D, 0).x, right = this.iso(W, 0, 0).x;
      const top = this.iso(0, 0, WALL_H).y - 20, bottom = this.iso(W, D, 0).y + 10;
      const inset = this.inset();
      const vw = Math.max(120, this.cw - inset);
      const fit = Math.min(vw / (right - left + 30), this.ch / (bottom - top + 30), 2);
      // S screen pixels per art pixel, always whole. A zoom in between would
      // resample the art and smear it, which is exactly what went wrong when
      // the camera was free to squeeze a 21-pixel cat into five.
      const S = Math.max(1, Math.floor(fit * ART + 0.25));
      const zoom = S / ART;
      const snap = (v) => Math.round(v / S) * S;
      this.cam = {
        zoom, S,
        ox: snap(vw / 2 - ((left + right) / 2) * zoom),
        oy: snap(this.ch / 2 - ((top + bottom) / 2) * zoom),
      };
    }

    pointer(e, click) {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let found = null;
      for (let i = this.hit.length - 1; i >= 0; i--) {
        const h = this.hit[i];
        if (mx >= h.x0 && mx <= h.x1 && my >= h.y0 && my <= h.y1) { found = h; break; }
      }
      const key = found ? found.key : null;
      this.canvas.style.cursor = key ? 'pointer' : 'default';
      if (key !== this.hoverKey || click) {
        this.hoverKey = key;
        const p = key && this.people.get(key);
        this.onHover(p ? p.s : null, { x: e.clientX, y: e.clientY }, !!click);
      }
    }

    iso(x, y, z = 0) {
      return { x: (x - y) * TW / 2, y: (x + y) * TH / 2 - z * TH };
    }

    // ------------------------------------------------------------ primitives

    // Every shape in the room comes through here, so this is where the scene
    // becomes pixel art. Canvas fill() anti-aliases diagonals, and an
    // isometric room is nothing but diagonals, so the polygon is rasterised
    // by hand instead: corners land on whole pixels, each row is filled as
    // whole pixels, and edges are walked with Bresenham. Nothing is averaged,
    // which is the difference between pixel art and a downscaled picture.
    poly(pts, fill, stroke) {
      const c = this.ctx;
      const m = c.getTransform();
      const dev = pts.map((p) => ({
        x: Math.round(p.x * m.a + p.y * m.c + m.e),
        y: Math.round(p.x * m.b + p.y * m.d + m.f),
      }));
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (fill) { c.fillStyle = fill; this.scanFill(dev); }
      if (stroke) { c.fillStyle = stroke; this.edgeLine(dev); }
      c.restore();
    }

    // Even-odd scanline fill, one whole pixel row at a time.
    scanFill(pts) {
      const c = this.ctx;
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y; }
      for (let y = lo; y <= hi; y++) {
        const xs = [];
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[j], b = pts[i];
          if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
          }
        }
        if (!xs.length) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          // Rounded outward on purpose: neighbouring faces then overlap by a
          // pixel instead of leaving a dark seam between them.
          const x0 = Math.floor(xs[k]), x1 = Math.ceil(xs[k + 1]);
          if (x1 > x0) c.fillRect(x0, y, x1 - x0, 1);
        }
      }
    }

    // One-pixel outline, walked rather than stroked so it stays hard.
    edgeLine(pts) {
      const c = this.ctx;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        let { x: x0, y: y0 } = pts[j];
        const { x: x1, y: y1 } = pts[i];
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let guard = 0; guard < 4000; guard++) {
          c.fillRect(x0, y0, 1, 1);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      }
    }

    box(x, y, z, w, d, h, top, left, right) {
      const P = (a, b, cc) => this.iso(a, b, cc);
      this.poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], left);
      this.poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], right);
      this.poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], top);
      // Flat faces alone read as paper cut-outs. A lit line where the top
      // meets the two faces we can see, and a darker one where they meet
      // the floor, is the bevel that makes a block look like furniture.
      // Slivers are skipped: on a 2-pixel shelf the lines are all there is.
      if (h >= 0.1 && w + d >= 0.5) {
        const hiL = this.tint(left, 20), hiR = this.tint(right, 24);
        if (hiL !== left) this.seg(P(x, y + d, z + h), P(x + w, y + d, z + h), hiL);
        if (hiR !== right) this.seg(P(x + w, y, z + h), P(x + w, y + d, z + h), hiR);
        if (h >= 0.22) {
          const loL = this.tint(left, -24), loR = this.tint(right, -24);
          if (loL !== left) this.seg(P(x, y + d, z), P(x + w, y + d, z), loL);
          if (loR !== right) this.seg(P(x + w, y, z), P(x + w, y + d, z), loR);
        }
      }
    }

    shade(color, amt) {
      if (color[0] !== '#') return color;
      const n = parseInt(color.slice(1), 16);
      const f = (v) => clamp(Math.round(v + amt), 0, 255);
      return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
    }

    roundRect(x, y, w, h, r, fill, stroke) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
    }

    // Draw flat things on a wall: 'y0' = back wall (runs along x),
    // 'x0' = left wall (runs along y).
    onWall(dir, a, z, fn) {
      const c = this.ctx;
      const o = dir === 'y0' ? this.iso(a, 0, z) : this.iso(0, a, z);
      c.save();
      c.translate(o.x, o.y);
      c.transform(1, dir === 'y0' ? 0.5 : -0.5, 0, 1, 0, 0);
      fn(c);
      c.restore();
    }

    // ------------------------------------------------------------ room shell

    // -------------------------------------------------------- static room layer

    roomLayer() {
      const { W, D, OW, MR, PY } = this.plan;
      const key = [W, D, OW, MR, PY, this.pal.wood1, this.pal.wallL].join('|');
      if (this.bg && this.bgKey === key) return this.bg;
      const left = this.iso(0, D, 0).x - 8, right = this.iso(W, 0, 0).x + 8;
      const top = this.iso(0, 0, WALL_H).y - 12, bottom = this.iso(W, D, 0).y + 8;
      const ox = Math.floor(left / ART), oy = Math.floor(top / ART);
      const cv = this.bg || (this.bg = document.createElement('canvas'));
      cv.width = Math.ceil(right / ART) - ox;
      cv.height = Math.ceil(bottom / ART) - oy;
      const keep = this.ctx;
      const g = cv.getContext('2d');
      g.setTransform(1 / ART, 0, 0, 1 / ART, -ox, -oy);
      this.ctx = g;
      try { this.paintRoom(); } finally { this.ctx = keep; }
      this.bgAt = { x: ox * ART, y: oy * ART };
      this.bgKey = key;
      return cv;
    }

    // Lighten or darken any colour the palette can hand over, hex or rgb().
    tint(col, amt) {
      if (typeof col !== 'string') return col;
      // Asked for the same few colours on every box of every frame.
      const memo = this.tints || (this.tints = new Map());
      const key = col + '|' + amt;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const out = this.tintRaw(col, amt);
      memo.set(key, out);
      return out;
    }

    tintRaw(col, amt) {
      let r, g, b;
      if (col[0] === '#') {
        const n = parseInt(col.length === 4 ? col[1] + col[1] + col[2] + col[2] + col[3] + col[3] : col.slice(1, 7), 16);
        r = n >> 16; g = (n >> 8) & 255; b = n & 255;
      } else {
        const m = col.match(/[\d.]+/g);
        if (!m || m.length < 3 || m.length > 3) return col;
        r = +m[0]; g = +m[1]; b = +m[2];
      }
      const f = (v) => clamp(Math.round(v + amt), 0, 255);
      return `rgb(${f(r)},${f(g)},${f(b)})`;
    }

    // One hard line between two projected points, optionally nudged by whole
    // pixels. Along a floor axis this is the clean 2:1 isometric staircase.
    seg(a, b, col, dx = 0, dy = 0) {
      const c = this.ctx;
      const m = c.getTransform();
      const q = (p) => ({ x: Math.round(p.x * m.a + m.e) + dx, y: Math.round(p.y * m.d + m.f) + dy });
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = col;
      this.edgeLine([q(a), q(b)]);
      c.restore();
    }

    paintRoom() {
      const { W, D, OW, MR, PY, pp } = this.plan;
      const pal = this.pal;
      const c = this.ctx;
      const m = c.getTransform();
      const P = (x, y, z) => this.iso(x, y, z);
      const dot = (p, col, dx = 0, dy = 0) => {
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
        c.fillStyle = col;
        c.fillRect(Math.round(p.x * m.a + m.e) + dx, Math.round(p.y * m.d + m.f) + dy, 1, 1);
        c.restore();
      };
      const rng = (seed) => {
        let v = seed % 2147483647; if (v <= 0) v += 2147483646;
        return () => ((v = (v * 16807) % 2147483647) - 1) / 2147483646;
      };
      const STEP = ART / (TW / 2);     // one art pixel along a floor axis, in tiles

      // Wood: boards of uneven length and tone, each with its own grain, laid
      // in rows half a tile deep. The seed is the row, so the floor is the
      // same floor every time it is repainted.
      const planks = (x0, x1, y0, y1, salt) => {
        const tones = [pal.wood1, pal.wood2, this.tint(pal.wood1, pal.dark ? 6 : -8)];
        const seam = this.tint(pal.wood1, pal.dark ? -20 : -34);
        let row = 0;
        for (let y = y0; y < y1 - 1e-6; y += 0.5, row++) {
          const r = rng(row * 131 + salt);
          const yb = Math.min(y1, y + 0.5);
          let x = x0 - r() * 1.5;
          while (x < x1) {
            const len = 1.2 + r() * 1.7;
            const xa = Math.max(x0, x), xb = Math.min(x1, x + len);
            const base = tones[Math.floor(r() * 3)];
            const lt = this.tint(base, pal.dark ? 8 : 9), dk = this.tint(base, pal.dark ? -11 : -15);
            const picks = [r(), r(), r(), r(), r(), r(), r()];
            if (xb - xa > 0.05) {
              this.poly([P(xa, y), P(xb, y), P(xb, yb), P(xa, yb)], base);
              this.seg(P(xa, y), P(xb, y), lt, 0, 1);
              for (let k = 0; k < 2; k++) {
                let gy = y + 0.14 + picks[k] * 0.24;
                const g0 = xa + 0.1 + picks[k + 2] * 0.3, g1 = Math.min(xb - 0.1, g0 + 0.4 + picks[k + 4] * (len - 0.7));
                for (let gx = g0; gx < g1; gx += STEP) {
                  const w = r();
                  if (w < 0.1) gy += (w < 0.05 ? -1 : 1) * STEP;
                  gy = Math.max(y + 0.1, Math.min(yb - 0.08, gy));
                  if (w < 0.86) dot(P(gx, gy), dk);
                }
              }
              if (picks[6] < 0.28 && xb - xa > 0.8) {
                const k = P(xa + 0.3 + picks[0] * (xb - xa - 0.6), y + 0.25);
                dot(k, seam); dot(k, seam, 1, 0); dot(k, dk, -1, 0); dot(k, dk, 2, 0); dot(k, dk, 0, -1); dot(k, dk, 1, 1);
              }
              this.seg(P(xb, y), P(xb, yb), seam);
            }
            x += len;
          }
          this.seg(P(x0, yb), P(x1, yb), seam);
        }
      };

      planks(0, OW, 0, D, 17);

      // Carpet: a flat colour reads as plastic, so it gets a weave of flecks.
      this.poly([P(OW, 0), P(W, 0), P(W, MR), P(OW, MR)], pal.carpet);
      {
        const lt = this.tint(pal.carpet, 9), dk = this.tint(pal.carpet, -9);
        let i = 0;
        for (let y = STEP / 2; y < MR; y += STEP, i++) {
          let j = 0;
          for (let x = OW + STEP / 2; x < W; x += STEP, j++) {
            const k = (i * 7 + j * 13) % 17;
            if (k === 0) dot(P(x, y), lt); else if (k === 9) dot(P(x, y), dk);
          }
        }
      }

      // Pantry tiles, with grout and a lit edge on each.
      for (let i = 0; i < Math.ceil((W - OW) * 2); i++) {
        for (let j = 0; j < Math.ceil((PY - MR) * 2); j++) {
          const x = OW + i / 2, y = MR + j / 2;
          const x1 = Math.min(W, x + 0.5), y1 = Math.min(PY, y + 0.5);
          const base = (i + j) % 2 ? pal.tileA : pal.tileB;
          this.poly([P(x, y), P(x1, y), P(x1, y1), P(x, y1)], base);
          this.seg(P(x, y), P(x1, y), this.tint(base, 10), 0, 1);
          this.seg(P(x, y1), P(x1, y1), this.tint(pal.tileB, -16));
          this.seg(P(x1, y), P(x1, y1), this.tint(pal.tileB, -16));
        }
      }

      planks(OW, W, PY, D, 91);

      // Lounge rug: a border, an inner line, and a row of stitches.
      {
        const x0 = OW + 0.3, x1 = OW + 4.3, y0 = PY + 0.6, y1 = D - 0.4;
        this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], pal.rugEdge);
        this.poly([P(x0 + 0.14, y0 + 0.14), P(x1 - 0.14, y0 + 0.14), P(x1 - 0.14, y1 - 0.14), P(x0 + 0.14, y1 - 0.14)], pal.rug);
        this.poly([P(x0 + 0.3, y0 + 0.3), P(x1 - 0.3, y0 + 0.3), P(x1 - 0.3, y1 - 0.3), P(x0 + 0.3, y1 - 0.3)], null, this.tint(pal.rug, pal.dark ? 12 : -12));
        const st = this.tint(pal.rug, pal.dark ? 26 : 24);
        for (let x = x0 + 0.07; x < x1; x += STEP * 3) { dot(P(x, y0 + 0.07), st); dot(P(x, y1 - 0.07), st); }
        for (let y = y0 + 0.07; y < y1; y += STEP * 3) { dot(P(x0 + 0.07, y), st); dot(P(x1 - 0.07, y), st); }
      }
      this.poly([P(pp.x0 - 0.6, pp.y - 1.4), P(pp.x1 + 0.6, pp.y - 1.4), P(pp.x1 + 0.6, pp.y + 1.3), P(pp.x0 - 0.6, pp.y + 1.3)], pal.mat);
      this.poly([P(pp.x0 - 0.5, pp.y - 1.3), P(pp.x1 + 0.5, pp.y - 1.3), P(pp.x1 + 0.5, pp.y + 1.2), P(pp.x0 - 0.5, pp.y + 1.2)], null, this.tint(pal.mat, pal.dark ? 14 : -14));

      // Where floor meets wall the light does not reach: two soft bands.
      for (const [d0, d1, a] of [[0, 0.16, 0.2], [0.16, 0.38, 0.09]]) {
        this.poly([P(0, d0), P(W, d0), P(W, d1), P(0, d1)], `rgba(0,0,0,${a})`);
        this.poly([P(d0, 0.38), P(d1, 0.38), P(d1, D), P(d0, D)], `rgba(0,0,0,${a})`);
      }

      // Walls: panelled below a rail, a scatter of flecks above it.
      const wall = (along, len, base) => {
        const Q = (u, z) => (along === 'x' ? P(u, 0, z) : P(0, u, z));
        const wain = this.tint(base, pal.dark ? -8 : -14), rail = this.tint(base, pal.dark ? 15 : 9);
        const groove = this.tint(wain, pal.dark ? -10 : -14), lip = this.tint(wain, pal.dark ? 9 : 10);
        this.poly([Q(0, 0), Q(len, 0), Q(len, WALL_H), Q(0, WALL_H)], base);
        this.poly([Q(0, 0.12), Q(len, 0.12), Q(len, 0.78), Q(0, 0.78)], wain);
        for (let u = 0.14; u < len - 0.3; u += 1) {
          const u1 = Math.min(len - 0.12, u + 0.74);
          this.poly([Q(u, 0.24), Q(u1, 0.24), Q(u1, 0.66), Q(u, 0.66)], null, groove);
          this.seg(Q(u, 0.24), Q(u1, 0.24), lip, 0, -1);
        }
        this.poly([Q(0, 0.78), Q(len, 0.78), Q(len, 0.85), Q(0, 0.85)], rail);
        this.seg(Q(0, 0.78), Q(len, 0.78), groove);
        const fleck = this.tint(base, pal.dark ? 9 : -9);
        for (let u = 0.3, k = 0; u < len - 0.1; u += 0.5, k++) {
          for (let z = 1.08 + (k % 2) * 0.22; z < WALL_H - 0.12; z += 0.44) {
            const p = Q(u, z);
            dot(p, fleck); dot(p, fleck, 0, -1); dot(p, fleck, along === 'x' ? 1 : -1, 0);
          }
        }
      };
      wall('x', W, pal.wallL);
      wall('y', D, pal.wallR);
      this.poly([P(0, 0, WALL_H), P(W, 0, WALL_H), P(W, -0.15, WALL_H), P(-0.15, -0.15, WALL_H), P(-0.15, D, WALL_H), P(0, D, WALL_H)], pal.wallTop);
      this.poly([P(0, 0, 0), P(W, 0, 0), P(W, 0, 0.12), P(0, 0, 0.12)], pal.trim);
      this.poly([P(0, 0, 0), P(0, D, 0), P(0, D, 0.12), P(0, 0, 0.12)], pal.trim);
      this.seg(P(0, 0, 0.12), P(W, 0, 0.12), this.tint(pal.trim, pal.dark ? 18 : 16));
      this.seg(P(0, 0, 0.12), P(0, D, 0.12), this.tint(pal.trim, pal.dark ? 18 : 16));
    }


    drawRoom() {
      const { W, D, OW, MR, PY, pp } = this.plan;
      const pal = this.pal;
      const P = (x, y, z) => this.iso(x, y, z);
      const t = this.t / 1000;

      // Floors and walls do not change from frame to frame, so they are
      // painted once into a layer of art pixels and blitted. That is what
      // pays for grain on every plank and panelling on every wall.
      {
        const bg = this.roomLayer();
        const c = this.ctx;
        c.imageSmoothingEnabled = false;
        c.drawImage(bg, this.bgAt.x, this.bgAt.y, bg.width * ART, bg.height * ART);
      }

      // windows with the real sky outside
      const sky = skyColor();
      for (const x of this.plan.windows) {
        this.poly([P(x, 0, 0.85), P(x + 1.5, 0, 0.85), P(x + 1.5, 0, 2.0), P(x, 0, 2.0)], sky.sky);
        if (sky.night) {
          this.onWall('y0', x + 0.3, 1.75, (c) => { c.fillStyle = '#f4f1d0'; c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill(); });
          this.onWall('y0', x + 1.1, 1.55, (c) => { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(0, 0, 1.5, 1.5); });
        } else {
          const cx = x + 0.25 + ((t * 0.02 + x * 0.37) % 1) * 1.0;
          this.onWall('y0', cx, 1.65, (c) => {
            c.fillStyle = 'rgba(255,255,255,.85)';
            c.beginPath(); c.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2); c.ellipse(5, -2, 5, 3, 0, 0, Math.PI * 2); c.fill();
          });
        }
        this.poly([P(x + 0.74, 0, 0.85), P(x + 0.76, 0, 0.85), P(x + 0.76, 0, 2.0), P(x + 0.74, 0, 2.0)], pal.trim);
        this.poly([P(x, 0, 0.85), P(x + 1.5, 0, 0.85), P(x + 1.5, 0, 0.9), P(x, 0, 0.9)], pal.trim);
        this.poly([P(x, 0.05), P(x + 1.5, 0.05), P(x + 1.95, 1.2), P(x + 0.45, 1.2)], sky.night ? 'rgba(120,140,200,.06)' : 'rgba(255,250,230,.16)');
      }
      // meeting room whiteboard + sign
      const wx = OW + 2.4;
      this.poly([P(wx, 0, 0.8), P(wx + 2.6, 0, 0.8), P(wx + 2.6, 0, 1.95), P(wx, 0, 1.95)], '#fdfdfb', pal.trim);
      this.onWall('y0', wx + 0.25, 1.75, (c) => {
        c.lineWidth = 1.4;
        c.strokeStyle = '#3b8ee0';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(22, 0); c.moveTo(0, 7); c.lineTo(36, 7); c.stroke();
        c.strokeStyle = '#c96442';
        c.strokeRect(46, -2, 20, 12); c.strokeRect(80, 6, 20, 12);
        c.beginPath(); c.moveTo(66, 4); c.lineTo(80, 12); c.stroke();
        c.strokeStyle = '#5f9a4c';
        c.beginPath(); c.moveTo(0, 22); for (let i = 0; i < 8; i++) c.lineTo(i * 8, 22 - ((i * 37) % 13)); c.stroke();
      });
      this.onWall('y0', OW + 0.5, 2.2, (c) => {
        c.font = '700 9px ui-sans-serif, system-ui, sans-serif'; c.fillStyle = this.shade(pal.trim, -60); c.fillText('MEETING', 0, 0);
      });
      // left wall: posters, clock, door
      for (const ps of this.plan.posters) {
        this.poly([P(0, ps.y, 0.95), P(0, ps.y + 0.9, 0.95), P(0, ps.y + 0.9, 1.95), P(0, ps.y, 1.95)], ps.color);
        this.onWall('x0', ps.y + 0.45, 1.4, (c) => {
          c.font = '800 8px ui-sans-serif, system-ui, sans-serif'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(ps.text, 0, 0);
        });
      }
      this.onWall('x0', 1.0, 1.85, (c) => {
        c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fillStyle = pal.bubble; c.fill();
        c.lineWidth = 2; c.strokeStyle = pal.trim; c.stroke();
        const d = new Date();
        const hand = (ang, len, w) => { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.sin(ang) * len, -Math.cos(ang) * len); c.lineWidth = w; c.strokeStyle = pal.bubbleInk; c.stroke(); };
        hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 5.5, 2);
        hand((d.getMinutes() / 60) * Math.PI * 2, 8, 1.4);
      });
      const dy = this.plan.door.y;
      this.poly([P(0, dy - 0.6, 0), P(0, dy + 0.6, 0), P(0, dy + 0.6, 1.8), P(0, dy - 0.6, 1.8)], pal.trim);
      this.poly([P(0, dy - 0.52, 0), P(0, dy + 0.52, 0), P(0, dy + 0.52, 1.72), P(0, dy - 0.52, 1.72)], this.shade(pal.deskL, -10));
      this.onWall('x0', dy - 0.25, 0.85, (c) => { c.fillStyle = '#d8c48a'; c.beginPath(); c.arc(0, 0, 1.8, 0, Math.PI * 2); c.fill(); });
      this.poly([P(0.05, dy - 0.6), P(0.9, dy - 0.6), P(0.9, dy + 0.6), P(0.05, dy + 0.6)], pal.dark ? '#5a3b2e' : '#b9654a');
    }

    // ------------------------------------------------------------ furniture

    plant(x, y) {
      const pal = this.pal;
      this.box(x - 0.18, y - 0.18, 0, 0.36, 0.36, 0.3, this.shade(pal.pot, 10), pal.pot, this.shade(pal.pot, -15));
      const c = this.ctx;
      const b = this.iso(x, y, 0.3);
      const sway = Math.sin(this.t / 1400 + x) * 0.05;
      c.fillStyle = pal.plant;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        c.beginPath();
        c.ellipse(b.x + Math.cos(a) * 6, b.y - 13 + Math.sin(a) * 3, 5.5, 13, a / 3 + sway, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = this.shade(pal.plant, 22);
      c.beginPath(); c.ellipse(b.x, b.y - 20, 5, 10, sway, 0, Math.PI * 2); c.fill();
    }

    serverRack(x, y) {
      this.box(x, y, 0, 0.7, 0.6, 1.9, '#3a3d44', '#24262b', '#1b1d21');
      const c = this.ctx;
      const busy = this.deskOf.size;
      for (let r = 0; r < 7; r++) {
        for (let k = 0; k < 4; k++) {
          const on = Math.sin(this.t / (180 + r * 37 + k * 53) + r * k) > 0.2 && (r * 4 + k) < Math.max(4, busy * 3);
          const p = this.iso(x + 0.12 + k * 0.13, y + 0.6, 1.7 - r * 0.22);
          c.fillStyle = on ? (k % 3 === 0 ? '#ffb347' : '#5cf08a') : '#2f3a33';
          c.fillRect(p.x - 1, p.y - 1, 2.5, 2);
        }
      }
    }

    printer(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 0.75, 0.55, 0.55, pal.deskTop, pal.deskL, pal.deskR);
      this.box(x + 0.05, y + 0.05, 0.55, 0.65, 0.45, 0.28, '#e8e8e8', '#c8c8c8', '#b3b3b3');
      this.box(x + 0.15, y + 0.35, 0.83, 0.45, 0.15, 0.02, '#ffffff', '#eee', '#ddd');
    }

    pingpong(x, y) {
      for (const [lx, ly] of [[0.1, 0.1], [2.4, 0.1], [0.1, 1.2], [2.4, 1.2]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.7, '#333', '#333', '#222');
      this.box(x, y, 0.7, 2.6, 1.4, 0.06, '#2f7a52', '#245f40', '#1d4f35');
      const P = (a, b, c) => this.iso(a, b, c);
      this.poly([P(x + 0.04, y + 0.69, 0.765), P(x + 2.56, y + 0.69, 0.765), P(x + 2.56, y + 0.71, 0.765), P(x + 0.04, y + 0.71, 0.765)], '#ffffff');
      this.poly([P(x + 1.3, y - 0.05, 0.76), P(x + 1.3, y + 1.45, 0.76), P(x + 1.3, y + 1.45, 0.95), P(x + 1.3, y - 0.05, 0.95)], 'rgba(255,255,255,.55)', '#ddd');
    }

    meetingTable(x, y) {
      const pal = this.pal;
      this.box(x + 0.3, y + 0.5, 0, 0.12, 0.4, 0.7, pal.deskL, pal.deskL, pal.deskR);
      this.box(x + 2.6, y + 0.5, 0, 0.12, 0.4, 0.7, pal.deskL, pal.deskL, pal.deskR);
      this.box(x, y, 0.7, 3.0, 1.4, 0.08, this.shade(pal.deskTop, 12), pal.deskL, pal.deskR);
      this.box(x + 1.2, y + 0.45, 0.78, 0.5, 0.35, 0.03, '#2a2a2e', '#222', '#1a1a1a');
      this.box(x + 0.4, y + 0.3, 0.78, 0.2, 0.28, 0.02, '#fff', '#eee', '#ddd');
      this.box(x + 2.2, y + 0.8, 0.78, 0.12, 0.12, 0.12, '#f2f2f2', '#d0d0d0', '#bbb');
    }

    stool(x, y, h, color) {
      this.box(x - 0.04, y - 0.04, 0, 0.08, 0.08, h, '#555', '#444', '#333');
      this.box(x - 0.2, y - 0.2, h, 0.4, 0.4, 0.07, this.shade(color, 18), color, this.shade(color, -18));
    }

    roundTable(x, y) {
      const c = this.ctx;
      this.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.72, '#555', '#444', '#333');
      const p = this.iso(x, y, 0.75);
      c.fillStyle = this.shade(this.pal.deskTop, -15);
      c.beginPath(); c.ellipse(p.x, p.y + 3, 30, 15, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = this.shade(this.pal.deskTop, 15);
      c.beginPath(); c.ellipse(p.x, p.y, 30, 15, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(p.x + 8, p.y - 2, 5, 2.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e6b35c';
      c.beginPath(); c.arc(p.x + 8, p.y - 3, 2, 0, Math.PI * 2); c.fill();
    }

    coffeeMachine(x, y) {
      this.box(x, y, 0.9, 0.5, 0.45, 0.6, '#555b63', '#3a3f45', '#2e3237');
      this.box(x + 0.15, y + 0.42, 1.0, 0.2, 0.05, 0.15, '#222', '#111', '#111');
      const p = this.iso(x + 0.4, y + 0.45, 1.35);
      this.ctx.fillStyle = Math.sin(this.t / 400) > 0 ? '#ff6b4a' : '#7a3a2a';
      this.ctx.fillRect(p.x, p.y, 2.5, 2.5);
      this.box(x + 0.6, y + 0.1, 0.9, 0.14, 0.14, 0.14, '#fff', '#ddd', '#ccc');
    }

    sink(x, y) {
      this.box(x, y + 0.05, 0.9, 0.55, 0.4, 0.02, '#9aa3ad', '#7d858e', '#6c737b');
      this.box(x + 0.22, y + 0.02, 0.92, 0.06, 0.06, 0.3, this.pal.metal, this.pal.metal, '#888');
      this.box(x + 0.22, y + 0.02, 1.2, 0.06, 0.2, 0.04, this.pal.metal, this.pal.metal, '#888');
    }

    fridge(x, y) {
      this.box(x, y, 0, 0.85, 0.75, 1.95, '#eef1f4', '#cfd5db', '#bcc3ca');
      const P = (a, b, c) => this.iso(a, b, c);
      this.poly([P(x, y + 0.75, 1.25), P(x + 0.85, y + 0.75, 1.25), P(x + 0.85, y + 0.75, 1.27), P(x, y + 0.75, 1.27)], '#9aa3ad');
      this.poly([P(x + 0.7, y + 0.75, 1.4), P(x + 0.73, y + 0.75, 1.4), P(x + 0.73, y + 0.75, 1.75), P(x + 0.7, y + 0.75, 1.75)], '#888');
      for (const [mx, mz, col] of [[0.2, 1.6, '#c96442'], [0.4, 1.45, '#3b8ee0'], [0.3, 0.9, '#5f9a4c']]) {
        const p = P(x + mx, y + 0.75, mz);
        this.ctx.fillStyle = col; this.ctx.fillRect(p.x, p.y, 4, 4);
      }
    }

    waterCooler(x, y) {
      this.box(x, y, 0, 0.42, 0.42, 0.95, '#e8ecef', '#cfd5db', '#bcc3ca');
      const c = this.ctx;
      const p = this.iso(x + 0.21, y + 0.21, 0.95);
      c.fillStyle = 'rgba(120,180,240,.6)';
      c.beginPath(); c.ellipse(p.x, p.y - 9, 8, 11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(p.x - 4, p.y - 16, 2, 10);
      const k = (this.t / 1800) % 1;
      c.fillStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(p.x + 2, p.y - 2 - k * 16, 1.2, 0, Math.PI * 2); c.fill();
      const tap = this.iso(x + 0.21, y + 0.42, 0.65);
      c.fillStyle = '#3b8ee0'; c.fillRect(tap.x - 1.5, tap.y, 3, 3);
    }

    couch(x, y) {
      const pal = this.pal;
      this.box(x, y - 0.05, 0.32, 2.8, 0.25, 0.42, this.shade(pal.couch, 10), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x, y, 0, 2.8, 0.8, 0.32, pal.couch, pal.couchD, this.shade(pal.couchD, -12));
      this.box(x - 0.15, y - 0.05, 0, 0.18, 0.85, 0.52, this.shade(pal.couch, 6), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x + 2.8, y - 0.05, 0, 0.18, 0.85, 0.52, this.shade(pal.couch, 6), pal.couchD, this.shade(pal.couchD, -12));
      this.box(x + 2.15, y + 0.12, 0.32, 0.35, 0.16, 0.28, '#e9c46a', '#d4ae52', '#c19c43');
    }

    coffeeTable(x, y) {
      const pal = this.pal;
      this.box(x, y, 0, 1.6, 0.7, 0.3, this.shade(pal.deskTop, -10), pal.deskL, pal.deskR);
      this.box(x + 0.2, y + 0.15, 0.3, 0.35, 0.25, 0.06, '#c96442', '#a85336', '#8f462e');
      this.box(x + 1.1, y + 0.3, 0.3, 0.12, 0.12, 0.12, '#fff', '#ddd', '#ccc');
    }

    beanbag(x, y, color) {
      const c = this.ctx;
      const p = this.iso(x, y, 0);
      c.fillStyle = this.shade(color, -25);
      c.beginPath(); c.ellipse(p.x, p.y - 4, 20, 11, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = color;
      c.beginPath(); c.ellipse(p.x, p.y - 8, 18, 10, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = this.shade(color, 20);
      c.beginPath(); c.ellipse(p.x - 3, p.y - 14, 10, 6, -0.2, 0, Math.PI * 2); c.fill();
    }

    books(x0, x1, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const cols = this.pal.book;
      for (let shelf = 0; shelf < 3; shelf++) {
        const z = 0.12 + shelf * 0.45;
        let bx = x0 + 0.05;
        let i = Math.round(x0 * 7) + shelf * 5;
        while (bx < x1 - 0.1) {
          const bw = 0.07 + ((i * 13) % 5) * 0.015;
          const bh = 0.25 + ((i * 7) % 4) * 0.03;
          if (i % 7 !== 3) this.poly([P(bx, y, z), P(bx + bw, y, z), P(bx + bw, y, z + bh), P(bx, y, z + bh)], cols[i % cols.length]);
          bx += bw + 0.015;
          i++;
        }
        this.poly([P(x0, y, z - 0.02), P(x1, y, z - 0.02), P(x1, y, z), P(x0, y, z)], this.pal.deskR);
      }
    }

    arcade(x, y) {
      this.box(x, y, 0, 0.7, 0.7, 1.75, '#3a2a6a', '#2b1f52', '#221843');
      const P = (a, b, c) => this.iso(a, b, c);
      const hue = (this.t / 20) % 360;
      this.poly([P(x + 0.1, y + 0.7, 1.0), P(x + 0.6, y + 0.7, 1.0), P(x + 0.6, y + 0.7, 1.45), P(x + 0.1, y + 0.7, 1.45)], `hsl(${hue},70%,55%)`);
      const blip = this.iso(x + 0.25 + 0.2 * Math.sin(this.t / 300), y + 0.7, 1.2);
      this.ctx.fillStyle = '#fff'; this.ctx.fillRect(blip.x, blip.y, 3, 3);
      this.poly([P(x, y + 0.7, 1.55), P(x + 0.7, y + 0.7, 1.55), P(x + 0.7, y + 0.7, 1.72), P(x, y + 0.7, 1.72)], '#ffcf4a');
      this.box(x, y + 0.7, 0.8, 0.7, 0.2, 0.08, '#4a3a8a', '#3a2a6a', '#2b1f52');
      const j = this.iso(x + 0.25, y + 0.8, 0.88);
      this.ctx.fillStyle = '#e04a4a'; this.ctx.beginPath(); this.ctx.arc(j.x, j.y - 3, 2.5, 0, Math.PI * 2); this.ctx.fill();
    }

    floorLamp(x, y) {
      const c = this.ctx;
      const b = this.iso(x, y, 0), t = this.iso(x, y, 1.7);
      if (skyColor().night) {
        c.fillStyle = 'rgba(255,220,140,.14)';
        c.beginPath(); c.ellipse(b.x, b.y, 50, 25, 0, 0, Math.PI * 2); c.fill();
      }
      c.strokeStyle = '#333'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(t.x, t.y); c.stroke();
      c.fillStyle = '#333'; c.beginPath(); c.ellipse(b.x, b.y, 7, 3.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#f3e3b5';
      c.beginPath(); c.moveTo(t.x - 9, t.y + 4); c.lineTo(t.x + 9, t.y + 4); c.lineTo(t.x + 5, t.y - 8); c.lineTo(t.x - 5, t.y - 8); c.closePath(); c.fill();
    }

    vending(x, y, color) {
      this.box(x, y, 0, 0.7, 0.75, 1.85, this.shade(color, 15), this.shade(color, -10), color);
      const P = (a, b, c) => this.iso(a, b, c);
      const fx = x + 0.7;
      this.poly([P(fx, y + 0.08, 0.7), P(fx, y + 0.55, 0.7), P(fx, y + 0.55, 1.7), P(fx, y + 0.08, 1.7)], 'rgba(20,30,40,.75)');
      const cols = ['#f2d16b', '#5cf08a', '#ff8a65', '#81d4fa', '#ce93d8'];
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 3; k++) {
          const q = P(fx, y + 0.15 + k * 0.14, 1.55 - r * 0.23);
          this.ctx.fillStyle = cols[(r * 3 + k + Math.round(y)) % cols.length];
          this.ctx.fillRect(q.x - 1.5, q.y - 4, 3, 5);
        }
      }
      this.poly([P(fx, y + 0.1, 0.25), P(fx, y + 0.5, 0.25), P(fx, y + 0.5, 0.45), P(fx, y + 0.1, 0.45)], '#222');
      const glow = P(fx, y + 0.65, 1.2);
      this.ctx.fillStyle = Math.sin(this.t / 700 + y) > 0 ? '#9ef' : '#4ad';
      this.ctx.fillRect(glow.x - 1, glow.y - 3, 2, 6);
    }

    foosball(x, y) {
      for (const [lx, ly] of [[0.1, 0.1], [1.42, 0.1], [0.1, 0.62], [1.42, 0.62]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.6, '#5a4030', '#5a4030', '#4a3428');
      this.box(x, y, 0.6, 1.6, 0.8, 0.25, '#2f8a4a', '#6e533b', '#5c4431');
      const P = (a, b, c) => this.iso(a, b, c);
      const players = this.plan && this.plan.pois.filter((q) => q.pair === 'fb' && q.taken).length === 2;
      for (let k = 0; k < 6; k++) {
        const rx = x + 0.2 + k * 0.24;
        const shift = players ? Math.sin(this.t / 120 + k) * 0.06 : 0;
        const a = P(rx, y - 0.15, 0.82), b = P(rx, y + 0.95, 0.82);
        this.ctx.strokeStyle = '#c8ccd0'; this.ctx.lineWidth = 1.2;
        this.ctx.beginPath(); this.ctx.moveTo(a.x, a.y); this.ctx.lineTo(b.x, b.y); this.ctx.stroke();
        for (let m = 0; m < 2; m++) {
          const q = P(rx, y + 0.25 + m * 0.3 + shift, 0.82);
          this.ctx.fillStyle = k % 2 ? '#c0392b' : '#2f6fb0';
          this.ctx.fillRect(q.x - 1.5, q.y - 3, 3, 6);
        }
      }
    }

    booth(add, x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const pal = this.pal;
      const H = 2.0;
      // back walls (felt panels), then the stool, then glass front
      add(x + 0.65 + y + 0.05, () => {
        this.poly([P(x, y, 0), P(x + 1.3, y, 0), P(x + 1.3, y, H), P(x, y, H)], pal.dark ? '#3c4a5a' : '#9fb3c8');
        this.poly([P(x, y, 0), P(x, y + 1.3, 0), P(x, y + 1.3, H), P(x, y, H)], pal.dark ? '#34404e' : '#8ea3b8');
        this.poly([P(x + 0.02, y + 0.02), P(x + 1.28, y + 0.02), P(x + 1.28, y + 1.28), P(x + 0.02, y + 1.28)], pal.dark ? '#2a323b' : '#d8dee5');
        const lamp = P(x + 0.65, y + 0.65, H - 0.05);
        this.ctx.fillStyle = 'rgba(255,230,160,.9)';
        this.ctx.beginPath(); this.ctx.ellipse(lamp.x, lamp.y, 8, 4, 0, 0, Math.PI * 2); this.ctx.fill();
        this.stool(x + 0.65, y + 0.6, 0.43, '#c96442');
      });
      add(x + 1.3 + y + 0.65 + 0.3, () => {
        this.poly([P(x + 1.3, y, 0), P(x + 1.3, y + 1.3, 0), P(x + 1.3, y + 1.3, H), P(x + 1.3, y, H)], pal.glass, pal.glassEdge);
        this.poly([P(x, y + 1.3, 0), P(x + 1.3, y + 1.3, 0), P(x + 1.3, y + 1.3, H), P(x, y + 1.3, H)], pal.glass, pal.glassEdge);
        this.poly([P(x + 0.85, y + 1.3, 0), P(x + 0.87, y + 1.3, 0), P(x + 0.87, y + 1.3, H), P(x + 0.85, y + 1.3, H)], pal.glassEdge);
        this.box(x - 0.03, y - 0.03, H, 1.36, 1.36, 0.08, pal.dark ? '#4a5868' : '#b5c4d3', pal.trim, pal.trim);
      });
    }

    desk(dk, p) {
      const pal = this.pal;
      const { x, y } = dk;
      for (const [lx, ly] of [[0.05, 0.05], [1.27, 0.05], [0.05, 0.67], [1.27, 0.67]]) {
        this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.72, pal.deskL, pal.deskL, pal.deskR);
      }
      this.box(x, y, 0.72, 1.4, 0.8, 0.07, pal.deskTop, pal.deskL, pal.deskR);
      const worker = p && p.mode === 'work' ? p : null;
      if (dk.side === 's') {
        const mx = x + 0.42, my = y + 0.1, mz = 0.79;
        this.box(mx + 0.22, my + 0.04, mz, 0.1, 0.1, 0.18, pal.monitor, pal.monitor, pal.monitor);
        this.box(mx, my, mz + 0.18, 0.56, 0.08, 0.42, pal.monitor, pal.monitor, this.shade(pal.monitor, 10));
        this.screen(mx + 0.04, my + 0.08, mz + 0.22, 0.48, 0.34, worker);
        this.box(x + 0.48, y + 0.48, 0.79, 0.44, 0.16, 0.025, '#d8d8d8', '#aaa', '#999');
      } else {
        // We see this monitor from behind; a status LED on its back.
        const mx = x + 0.42, my = y + 0.6, mz = 0.79;
        this.box(x + 0.48, y + 0.16, 0.79, 0.44, 0.16, 0.025, '#d8d8d8', '#aaa', '#999');
        this.box(mx + 0.22, my - 0.02, mz, 0.1, 0.1, 0.18, pal.monitor, pal.monitor, pal.monitor);
        this.box(mx, my, mz + 0.18, 0.56, 0.08, 0.42, this.shade(pal.monitor, 15), this.shade(pal.monitor, 8), this.shade(pal.monitor, 12));
        if (worker) {
          const g = this.iso(mx + 0.28, my + 0.08, mz + 0.5);
          this.ctx.fillStyle = STATUS_COLOR[worker.s.status] || '#888';
          this.ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t / 400 + worker.phase);
          this.ctx.beginPath(); this.ctx.arc(g.x, g.y, 1.8, 0, Math.PI * 2); this.ctx.fill();
          this.ctx.globalAlpha = 1;
        }
      }
      // personal touches, stable per desk
      const h = hash(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (h % 3 === 0) this.box(x + 1.12, y + 0.3, 0.79, 0.12, 0.12, 0.13, '#f2f2f2', '#d0d0d0', '#bbb');
      if (h % 5 === 1) {
        this.box(x + 0.14, y + 0.24, 0.79, 0.12, 0.12, 0.08, pal.pot, pal.pot, this.shade(pal.pot, -15));
        const q = this.iso(x + 0.2, y + 0.3, 0.87);
        this.ctx.fillStyle = pal.plant;
        this.ctx.beginPath(); this.ctx.ellipse(q.x, q.y - 4, 4, 6, 0, 0, Math.PI * 2); this.ctx.fill();
      }
      if (h % 4 === 2) this.box(x + 0.12, y + 0.45, 0.79, 0.22, 0.15, 0.05, '#f2d16b', '#d9b84f', '#c4a33f');
    }

    screen(x, y, z, w, h, p) {
      const P = (a, b, cc) => this.iso(a, b, cc);
      const st = p ? p.s.status : 'off';
      const base = { thinking: '#3a3160', tool: '#14324f', typing: '#123d2e', waiting: '#4d3510', error: '#4a1612' }[st] || this.pal.screenOff;
      const corners = [P(x, y, z), P(x + w, y, z), P(x + w, y, z + h), P(x, y, z + h)];
      this.poly(corners, base);
      if (!p) return;
      const c = this.ctx;
      c.save();
      c.beginPath();
      corners.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
      c.clip();
      const t = this.t / 1000;
      const col = STATUS_COLOR[st];
      if (st === 'tool' || st === 'typing') {
        const scroll = (t * (st === 'tool' ? 2.2 : 1.2) + p.phase) % 1;
        for (let i = -1; i < 6; i++) {
          const zz = z + h - 0.05 - ((i + scroll) * h) / 5;
          const len = 0.12 + ((p.h >> ((i + 8) & 15)) % 7) / 20;
          const a = P(x + 0.05, y, zz), b = P(x + 0.05 + Math.min(len, w - 0.1), y, zz);
          c.strokeStyle = i % 3 === 0 ? col : 'rgba(255,255,255,.55)';
          c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
      } else {
        const m = P(x + w / 2, y, z + h / 2);
        c.fillStyle = col;
        c.globalAlpha = st === 'thinking' ? 0.5 + 0.4 * Math.sin(t * 3 + p.phase) : 0.9;
        c.font = '700 10px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText({ thinking: '…', waiting: '?', error: '!' }[st] || '', m.x, m.y);
      }
      c.restore();
      c.save();
      c.globalAlpha = 0.18;
      const g = P(x + w / 2, y + 0.35, 0.8);
      c.fillStyle = col;
      c.beginPath(); c.ellipse(g.x, g.y, 18, 7, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    chair(dk, p) {
      const pal = this.pal;
      const sx = dk.seat.x - 0.25, sy = dk.seat.y - 0.22;
      const seated = p && !p.path.length && p.pose === 'sit' && Math.hypot(p.x - dk.seat.x, p.y - dk.seat.y) < 0.05;
      const ox = seated ? 0 : 0.12, oy = seated ? 0 : dk.side === 's' ? 0.18 : -0.18;
      this.box(sx + 0.22 + ox, sy + 0.19 + oy, 0, 0.06, 0.06, 0.32, '#222', '#222', '#111');
      if (dk.side === 'n') this.box(sx + ox, sy + oy - 0.05, 0.4, 0.5, 0.07, 0.55, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
      this.box(sx + ox, sy + oy, 0.32, 0.5, 0.45, 0.08, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
      if (dk.side === 's' && !seated) this.box(sx + ox, sy + oy + 0.4, 0.4, 0.5, 0.07, 0.5, this.shade(pal.chair, 15), pal.chair, this.shade(pal.chair, -10));
    }

    // ------------------------------------------------------------ people

    stateOf(p) {
      const s = p.s || {};
      if (p.path.length) return { pose: 'walk', face: p.walkFace, act: null, sitZ: 0 };
      if (p.mode === 'work' && p.desk) {
        const face = p.desk.side === 'n' ? 'front' : 'back';
        if (s.status === 'waiting' || s.status === 'error') return { pose: 'stand', face, act: 'wave', sitZ: 0 };
        if (p.desk.pose === 'stand') return { pose: 'stand', face, act: 'station', sitZ: 0 };
        return { pose: 'sit', face, act: s.status === 'tool' || s.status === 'typing' ? 'type' : 'think', sitZ: 0.34 };
      }
      if (p.mode === 'wander' && p.poi) {
        const q = p.poi;
        return { pose: q.sit ? 'sit' : 'stand', face: q.face === 'side' ? 'front' : q.face, act: q.act, sitZ: q.sit || 0 };
      }
      return { pose: 'stand', face: 'front', act: null, sitZ: 0 };
    }

    person(p) {
      const c = this.ctx;
      const t = this.t / 1000;
      const s = p.s || {};
      const st = this.stateOf(p);
      p.pose = st.pose;
      const moving = st.pose === 'walk';
      const seated = st.pose === 'sit';
      const front = st.face !== 'back';
      const b = this.iso(p.x, p.y, st.sitZ);
      const step = moving ? Math.sin(t * 12 + p.phase) : 0;
      const bob = moving ? Math.abs(step) * 1.5 : 0;

      const fb = this.iso(p.x, p.y, 0);
      c.fillStyle = this.pal.shadow;
      c.beginPath(); c.ellipse(fb.x, fb.y, 10, 5, 0, 0, Math.PI * 2); c.fill();
      if (this.hoverKey === p.key) {
        c.strokeStyle = STATUS_COLOR[s.status] || '#888';
        c.lineWidth = 2;
        c.beginPath(); c.ellipse(fb.x, fb.y, 14, 7, 0, 0, Math.PI * 2); c.stroke();
      }

      let x = b.x;
      const y = b.y - bob;
      if (st.act === 'pingpong') x += Math.sin(t * 7 + p.phase) * 4;
      if (st.act === 'foosball') x += Math.sin(t * 5 + p.phase) * 1.5;
      const sc = 1;
      c.save();
      c.translate(x, y);
      // From here one unit is one art pixel, on whole pixels. The camera's
      // scale is exactly 1 / ART, so this is a translation and nothing else.
      {
        const m = c.getTransform();
        c.setTransform(1, 0, 0, 1, Math.round(m.e), Math.round(m.f));
      }

      const br = p.breed || BREEDS[0];
      const fur = br.fur;
      const INK = INK_HEX;
      const pxFloor = (v) => Math.round(v);

      // Tail: a few blocks along a curve, so it can still swing. Drawn before
      // the body so it sits behind it.
      {
        const sway = Math.sin(t * (moving ? 6 : 1.6) + p.phase) * (moving ? 1.6 : 0.8);
        const root = seated ? -3 : -5;
        for (let i = 0; i < 4; i++) {
          const k = i / 3;
          const tx = pxFloor(4 + k * 4 + sway * k);
          const ty = pxFloor(root - k * 7);
          c.fillStyle = INK; c.fillRect(tx - 1, ty - 1, 4, 4);
          c.fillStyle = i > 1 ? br.belly : fur; c.fillRect(tx, ty, 2, 2);
        }
      }

      const sleepy = s.status === 'idle';
      const napping = st.act === 'nap';
      const blink = Math.sin(t * 0.7 + p.phase * 3) > 0.985;
      const eyes = (blink || sleepy || napping) ? 'shut' : s.status === 'error' ? 'wide' : 'open';
      const sprite = catSprite(br, seated, front, eyes);
      c.imageSmoothingEnabled = false;
      c.drawImage(sprite, -PXC, -PXH + 1);

      // The sprite already has the cat's own front paws, so an activity only
      // adds what it needs: a small paw block and the thing being held. Full
      // arms grafted onto a pixel cat read as two black wings.
      const paw = (px2, py2) => {
        c.fillStyle = INK; c.fillRect(pxFloor(px2) - 1, pxFloor(py2) - 1, 4, 4);
        c.fillStyle = br.belly; c.fillRect(pxFloor(px2), pxFloor(py2), 2, 2);
      };
      const prop = (px2, py2, w, h, fill) => {
        c.fillStyle = INK; c.fillRect(pxFloor(px2) - 1, pxFloor(py2) - 1, w + 2, h + 2);
        c.fillStyle = fill; c.fillRect(pxFloor(px2), pxFloor(py2), w, h);
      };
      const sip = Math.sin(t * 0.9 + p.phase) > 0.6;
      const top = -PXH + 13;
      switch (st.act) {
        case 'wave': {
          const wave = Math.sin(t * 8 + p.phase) > 0 ? 0 : 2;
          paw(6, top - 4 - wave);
          break;
        }
        case 'type': {
          const k1 = Math.sin(t * 18 + p.phase) > 0 ? 1 : 0;
          paw(-8, top + 2 + k1);
          paw(6, top + 3 - k1);
          break;
        }
        case 'coffee':
        case 'water': {
          const cupY = sip && front ? top - 3 : top + 1;
          paw(6, cupY + 2);
          prop(6, cupY, 3, 4, st.act === 'water' ? '#aad7ff' : '#fafafa');
          if (st.act === 'coffee') { c.fillStyle = '#6b3f22'; c.fillRect(7, cupY + 1, 1, 1); }
          break;
        }
        case 'read': {
          if (front) {
            prop(-5, top + 1, 10, 6, pick(this.pal.book, p.h, 5));
            c.fillStyle = '#fff'; c.fillRect(0, top + 2, 1, 4);
          }
          paw(-7, top + 4); paw(5, top + 4);
          break;
        }
        case 'whiteboard':
        case 'arcade': {
          const k = Math.sin(t * (st.act === 'arcade' ? 14 : 3) + p.phase) > 0 ? 0 : 2;
          paw(6, top - 5 + k);
          break;
        }
        case 'pingpong': {
          paw(6, top);
          prop(8, top - 4, 3, 3, '#c0392b');
          break;
        }
        case 'foosball': {
          const k1 = Math.sin(t * 16 + p.phase) > 0 ? 0 : 1;
          paw(-8, top + k1); paw(6, top + 1 - k1);
          break;
        }
        case 'phone': {
          paw(6, top - 2);
          prop(6, top - 6, 2, 5, '#2a2a30');
          break;
        }
        default: break;
      }
      c.restore();

      // Back in world units for the name tag and the click target.
      const headTop = y - (PXH + 1) * ART;
      const half = (PXC + 1) * ART;
      this.hit.push({ key: p.key, x0: x - half, x1: x + half, y0: headTop - 4, y1: fb.y + 4 });
      return { x, y: headTop + 6, act: st.act };
    }

    bubble(p, at) {
      const c = this.ctx;
      const t = this.t / 1000;
      const s = p.s || {};
      const st = s.status;
      const pal = this.pal;
      const x = at.x, y = at.y - 6;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const font = (w, px) => `${w} ${px}px ui-sans-serif, system-ui, -apple-system, "PingFang TC", "Apple Color Emoji", sans-serif`;
      c.font = font(600, 10);

      const badge = this.showAgent && AGENT_BADGES[s.agent];
      const pill = (text, fg, bg, yy, alpha = 1, identify = false) => {
        c.globalAlpha = alpha;
        let tx = text;
        while (c.measureText(tx).width > 118 && tx.length > 2) tx = tx.slice(0, -2) + '…';
        const extra = badge && identify ? 26 : 0;
        const w = c.measureText(tx).width + 12 + extra;
        const height = extra ? 22 : 16;
        this.roundRect(x - w / 2, yy - height / 2, w, height, 8, bg);
        c.fillStyle = fg;
        c.fillText(tx, x + extra / 2, yy + 0.5);
        if (extra) this.agentBadge(badge, x - w / 2 + 13, yy);
        c.globalAlpha = 1;
        return yy - 8;
      };

      let top = y;
      if (p.mode === 'work' && !p.path.length) {
        const col = STATUS_COLOR[st] || '#888';
        if (st === 'thinking') {
          c.fillStyle = pal.bubble;
          c.beginPath(); c.arc(x + 6, y - 2, 2, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(x + 10, y - 7, 3, 0, Math.PI * 2); c.fill();
          this.roundRect(x - 2, y - 26, 32, 16, 8, pal.bubble);
          for (let i = 0; i < 3; i++) {
            c.fillStyle = col;
            c.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 - i * 0.7));
            c.beginPath(); c.arc(x + 6 + i * 8, y - 18, 2.4, 0, Math.PI * 2); c.fill();
          }
          c.globalAlpha = 1;
          top = y - 26;
        } else if (st === 'typing') {
          this.roundRect(x - 2, y - 24, 34, 16, 5, col);
          c.beginPath(); c.moveTo(x + 2, y - 9); c.lineTo(x - 2, y - 3); c.lineTo(x + 8, y - 9); c.fillStyle = col; c.fill();
          const n = Math.floor(t * 4) % 4;
          c.fillStyle = '#fff';
          for (let i = 0; i < n; i++) { c.beginPath(); c.arc(x + 7 + i * 8, y - 16, 2, 0, Math.PI * 2); c.fill(); }
          top = y - 24;
        } else if (st === 'tool') {
          const tool = (s.activity || 'tool').split(/[:\s]/)[0];
          top = pill('⚙ ' + tool, '#fff', col, y - 12);
        } else if (st === 'waiting' || st === 'error') {
          const jump = Math.abs(Math.sin(t * 4)) * 4;
          c.fillStyle = col;
          c.beginPath(); c.arc(x, y - 12 - jump, 9, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff';
          c.font = font(800, 12);
          c.fillText('!', x, y - 11.5 - jump);
          c.font = font(600, 10);
          top = y - 22 - jump;
        }
      } else if (p.mode === 'wander') {
        const justDone = st === 'done' && Date.now() - (s.lastEventAt || 0) < 3 * 60_000;
        const dozing = at.act === 'nap' || (st === 'idle' && (at.act === 'couch' || at.act === 'beanbag' || (p.poi && p.poi.sleepy)));
        if (justDone) {
          c.fillStyle = STATUS_COLOR.done;
          c.beginPath(); c.arc(x, y - 10, 7, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#fff'; c.font = font(800, 9); c.fillText('✓', x, y - 9.5); c.font = font(600, 10);
          top = y - 18;
        } else if (dozing && !p.path.length) {
          c.fillStyle = STATUS_COLOR.idle;
          c.font = font(700, 10);
          for (let i = 0; i < 3; i++) {
            const k = (t * 0.6 + i / 3) % 1;
            c.globalAlpha = 1 - k;
            c.fillText('z', x + 6 + k * 10, y - 4 - k * 18);
          }
          c.globalAlpha = 1;
          c.font = font(600, 10);
          top = y - 20;
        } else if (at.act && (ACT_EMOJI[at.act] || (p.poi && p.poi.emoji)) && !p.path.length) {
          const cycle = (t + p.phase * 3) % 9;
          if (cycle < 2.2) {
            c.globalAlpha = Math.min(1, cycle * 3, (2.2 - cycle) * 3);
            c.font = font(400, 13);
            c.fillText((p.poi && p.poi.emoji) || ACT_EMOJI[at.act], x, y - 10);
            c.globalAlpha = 1;
            c.font = font(600, 10);
            top = y - 18;
          }
        }
      }

      const hover = this.hoverKey === p.key;
      if (!s.subagent || hover) {
        pill(this.label(s), pal.text, pal.tagBg, top - 11, p.mode === 'work' || hover ? 1 : 0.7, true);
      } else if (badge) {
        this.agentBadge(badge, x, top - 11);
      }
      c.restore();
    }

    agentBadge(badge, x, y) {
      const c = this.ctx;
      c.save();
      c.globalAlpha = 1;
      if (badge.image.complete && badge.image.naturalWidth > 0) {
        if (badge.mono && this.pal.dark) c.filter = 'invert(1)';
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = 'high';
        c.drawImage(badge.image, x - 9, y - 9, 18, 18);
      } else {
        c.fillStyle = this.pal.text;
        c.font = '800 10px ui-sans-serif, system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(badge.short, x, y + 0.5);
      }
      c.restore();
    }

    moveCat(dt, now) {
      const k = this.cat;
      if (!k.path.length && now > k.until) {
        const { W, D, grid } = this.plan;
        let tx, ty, tries = 0;
        do { tx = rand(0.6, W - 0.6); ty = rand(1, D - 0.6); tries++; } while (grid.blocked(tx, ty) && tries < 30);
        k.path = grid.path(k.x, k.y, tx, ty);
        k.until = Infinity;
      }
      if (k.path.length) {
        const n = k.path[0];
        const dx = n.x - k.x, dy = n.y - k.y, d = Math.hypot(dx, dy), v = 1.2 * dt;
        if (d > 0.001) k.face = dx - dy >= 0 ? 1 : -1;
        if (d <= v) { k.x = n.x; k.y = n.y; k.path.shift(); if (!k.path.length) k.until = now + rand(4000, 12000); }
        else { k.x += (dx / d) * v; k.y += (dy / d) * v; }
      }
    }

    drawCat() {
      const k = this.cat;
      const c = this.ctx;
      const p = this.iso(k.x, k.y, 0);
      const t = this.t / 1000;
      const walking = k.path.length > 0;
      c.save();
      c.translate(p.x, p.y);
      c.scale(k.face, 1);
      c.fillStyle = this.pal.shadow;
      c.beginPath(); c.ellipse(0, 0, 8, 3, 0, 0, Math.PI * 2); c.fill();
      const col = '#e09a4a';
      c.fillStyle = col;
      if (walking) {
        const s = Math.sin(t * 14) * 1.5;
        c.fillRect(-5, -4, 2, 4 + s); c.fillRect(3, -4, 2, 4 - s);
      }
      c.beginPath(); c.ellipse(0, walking ? -6 : -4, 7, walking ? 4 : 5, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(6, walking ? -10 : -9, 3.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(4, -12); c.lineTo(5, -16); c.lineTo(7, -12.5); c.fill();
      c.beginPath(); c.moveTo(7, -12.5); c.lineTo(9, -15.5); c.lineTo(9.5, -11); c.fill();
      c.strokeStyle = col; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-6, -6); c.quadraticCurveTo(-12, -8 + Math.sin(t * 3) * 3, -10, -14); c.stroke();
      c.fillStyle = '#2a2018';
      c.fillRect(7, -10.5, 1.2, walking ? 1.2 : 0.6);
      c.restore();
    }

    pingPongBall() {
      const players = this.plan.pois
        .filter((q) => q.pair === 'pp' && q.taken)
        .map((q) => this.people.get(q.taken))
        .filter((p) => p && p.poi && p.poi.pair === 'pp' && !p.path.length);
      if (players.length < 2) return;
      const pp = this.plan.pp;
      const k = (this.t / 900) % 2;
      const f = k < 1 ? k : 2 - k;
      const x = pp.x0 + 0.3 + f * (pp.x1 - pp.x0 - 0.6);
      const z = 0.8 + Math.abs(Math.sin(f * Math.PI * 2)) * 0.45;
      const c = this.ctx;
      const sh = this.iso(x, pp.y, 0.77);
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.beginPath(); c.ellipse(sh.x, sh.y, 2.5, 1.2, 0, 0, Math.PI * 2); c.fill();
      const p = this.iso(x, pp.y, z);
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(p.x, p.y, 2.2, 0, Math.PI * 2); c.fill();
    }

    // ------------------------------------------------------------ frame

    frame(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t = now;
      if (!this.visible) return;
      this.step(dt);
      if (this.draw() !== false) {
        if (!this.first && ++this.framesShown === 3) this.markReady(true);
        // Capture immediately: a WebGL drawing buffer may be cleared after
        // this task. The overlay and the 3D canvas must be copied together.
        if (this.onFrame) this.onFrame(this);
      }
    }

    // Advance people and the cat; shared by the 2D and 3D renderers.
    step(dt) {
      const wall = Date.now();
      for (const [k, p] of this.people) {
        if (p.mode === 'wander') {
          if (p.poi && !p.path.length && p.until === Infinity) p.until = wall + p.stay;
          this.wander(p, wall);
        }
        if (p.path.length) {
          const n = p.path[0];
          const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy), v = SPEED * dt;
          if (d > 0.001) p.walkFace = dx + dy >= 0 ? 'front' : 'back';
          if (d <= v) { p.x = n.x; p.y = n.y; p.path.shift(); }
          else { p.x += (dx / d) * v; p.y += (dy / d) * v; }
        } else if (p.leaving) {
          this.people.delete(k);
        }
      }
      this.moveCat(dt, wall);
    }

    draw() {
      this.fitCamera();
      const S = this.cam.S;
      // The buffer holds art pixels: the canvas divided by S, so one buffer
      // pixel is one art pixel and the blit below is a clean S-times enlarge.
      const bw = Math.max(1, Math.ceil(this.cw / S)), bh = Math.max(1, Math.ceil(this.ch / S));
      if (this.buf.width !== bw || this.buf.height !== bh) { this.buf.width = bw; this.buf.height = bh; }
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, bw, bh);
      c.imageSmoothingEnabled = false;
      c.setTransform(1 / S, 0, 0, 1 / S, 0, 0);
      c.translate(this.cam.ox, this.cam.oy);
      c.scale(this.cam.zoom, this.cam.zoom);

      this.drawRoom();
      const occupant = new Map();
      for (const p of this.people.values()) {
        if (p.mode === 'work' && p.desk) occupant.set(p.desk, p);
        else if (p.napDesk) occupant.set(p.napDesk, p);
      }
      const items = [...this.plan.items];
      for (const dk of this.plan.desks) {
        const p = occupant.get(dk);
        items.push({ depth: dk.x + 0.7 + dk.y + 0.4, draw: () => this.desk(dk, p) });
        items.push({ depth: dk.seat.x + dk.seat.y - 0.06, draw: () => this.chair(dk, p) });
      }
      for (const p of this.people.values()) items.push({ depth: p.x + p.y + 0.01, person: p });
      items.push({ depth: this.cat.x + this.cat.y, draw: () => this.drawCat() });
      items.sort((a, b) => a.depth - b.depth);

      this.hit = [];
      const heads = [];
      for (const it of items) {
        if (it.person) heads.push([it.person, this.person(it.person)]);
        else it.draw();
      }
      this.pingPongBall();

      // Blow the buffer back up with nearest-neighbour: this is the step that
      // turns the whole scene into pixels, not just the cats.
      const v = this.vctx;
      v.setTransform(1, 0, 0, 1, 0, 0);
      v.clearRect(0, 0, this.canvas.width, this.canvas.height);
      v.imageSmoothingEnabled = false;
      v.drawImage(this.buf, 0, 0, this.buf.width * S * this.dpr, this.buf.height * S * this.dpr);

      // Name tags and the off-duty line go on at full resolution, after the
      // scale-up: run through the pixel buffer their text turns to mush.
      const buffered = this.ctx;
      this.ctx = v;
      v.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const toScreen = (at) => ({
        ...at, x: at.x * this.cam.zoom + this.cam.ox, y: at.y * this.cam.zoom + this.cam.oy,
      });
      for (const [p, at] of heads) this.bubble(p, toScreen(at));
      if (this.offDuty > 0) {
        const d = toScreen(this.iso(0.2, this.plan.door.y + 0.9, 0));
        v.font = '600 10px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
        v.textAlign = 'center';
        v.fillStyle = this.pal.text;
        v.globalAlpha = 0.65;
        v.fillText(`+${this.offDuty} ${this.offDutyLabel}`, d.x - 10, d.y + 14);
        v.globalAlpha = 1;
      }
      this.ctx = buffered;

      const z = this.cam.zoom;
      this.hit = this.hit.map((h) => ({
        key: h.key,
        x0: h.x0 * z + this.cam.ox, x1: h.x1 * z + this.cam.ox,
        y0: h.y0 * z + this.cam.oy, y1: h.y1 * z + this.cam.oy,
      }));
    }
  }

  window.Office = Office;
  window.OFFICE_AGENT_BADGES = AGENT_BADGES;
  window.OfficeGrid = Grid;
  window.OfficeCats = { sprite: catSprite, breeds: BREEDS, W: PXW, H: PXH };
})();
