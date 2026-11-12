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
  const MAX_KITTENS = 4;           // per parent
  const KITTEN_LINGER = 90 * 1000; // a finished kitten stays this long, then goes
  // Lunch, by the clock on the wall. Whoever is not working eats or naps,
  // and the lights go off.
  const LUNCH_FROM = 12 * 60 + 30, LUNCH_TO = 13 * 60 + 30;
  const LUNCH_EAT = new Set(['stool', 'meeting']);                 // places with a table
  const LUNCH_NAP = new Set(['couch', 'beanbag', 'box', 'sun']);   // places to lie down
  // Petting the office cat. A stroke is a click, or PET_RUB screen pixels of
  // the mouse moving over it. It purrs for PET_GLOW after the last stroke,
  // stays put for PET_STAY, and rolls over after PET_BELLY strokes.
  const SHUT_ACTS = new Set(['sun', 'zen', 'fall']);   // things done with the eyes closed
  const PET_KEY = 'pet:cat';
  const PET_RUB = 26, PET_GLOW = 2600, PET_STAY = 7000, PET_BELLY = 10;
  const PET_HEART = [[1, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]];
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

  function catGrid(br, seated, front, eyes, kit) {
    const g = pxGrid();
    // A kitten is the same cat on a smaller frame: it shares the canvas and
    // the line the feet stand on, so everything that draws a cat draws it.
    const hcx = PXC, hcy = kit ? 12.2 : 8.2, hrx = kit ? 4.3 : 5.6, hry = kit ? 3.7 : 4.8;
    const bcy = kit ? 17.3 : seated ? 15.2 : 15.0, brx = kit ? (seated ? 3.5 : 3.0) : seated ? 4.8 : 4.0, bry = kit ? 2.6 : seated ? 4.0 : 4.4;
    const E = kit ? [4.1, 1.2, 3.3, 5.6, 1.2, 2.2] : [5.4, 1.6, 4.2, 7.6, 1.6, 3.0];
    const earFur = br.mask ? PX_DARK : PX_FUR;
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
    const darkFace = !!br.mask || lum(br.fur) < 90;
    // Ears first, head over them: the roots vanish into the head, and the tips
    // have to clear the head's ellipse or they end up as two bumps.
    pxTri(g, hcx - E[0], hcy - E[1], hcx - E[2], hcy - E[3], hcx - E[4], hcy - E[5], earFur);
    pxTri(g, hcx + E[0], hcy - E[1], hcx + E[2], hcy - E[3], hcx + E[4], hcy - E[5], earFur);
    pxEllipse(g, hcx, bcy, brx, bry, PX_FUR);
    pxEllipse(g, hcx, bcy + 0.8, brx - 2.0, bry - 1.3, PX_BELLY);
    for (const sx of [-1, 1]) pxEllipse(g, hcx + sx * (kit ? 1.7 : 2.3), bcy + bry - 0.5, kit ? 1.0 : 1.4, kit ? 0.8 : 1.0, PX_BELLY);
    if (br.patches) pxEllipse(g, hcx + (kit ? 2 : 3), bcy - (kit ? 0.6 : 1), kit ? 1.1 : 1.6, kit ? 1.1 : 1.6, PX_SOOT);
    pxEllipse(g, hcx, hcy, hrx, hry, PX_FUR);
    if (front) {
      if (kit) {
        pxPut(g, hcx - 3, hcy - 3.6, PX_PINK); pxPut(g, hcx + 3, hcy - 3.6, PX_PINK);
      } else {
        pxPut(g, hcx - 4, hcy - 4.4, PX_PINK); pxPut(g, hcx - 4, hcy - 5.4, PX_PINK);
        pxPut(g, hcx + 4, hcy - 4.4, PX_PINK); pxPut(g, hcx + 4, hcy - 5.4, PX_PINK);
      }
    }
    if (br.stripes) for (const dx of [-2, 0, 2]) for (let k = 0; k < (kit ? 1 : 2); k++) pxPut(g, hcx + dx, (kit ? 9 : 4) + k, PX_DARK);
    if (br.patches) {
      // Kept high and to the sides: a patch over an eye reads as an eyepatch.
      pxEllipse(g, hcx - (kit ? 3 : 4), hcy - (kit ? 2.3 : 3), kit ? 1.2 : 1.6, kit ? 1.0 : 1.4, PX_GINGER);
      pxEllipse(g, hcx + (kit ? 3 : 4), hcy - (kit ? 2.3 : 3), kit ? 1.1 : 1.4, kit ? 0.9 : 1.2, PX_SOOT);
    }
    if (br.mask && front) pxEllipse(g, hcx, hcy + (kit ? 1.0 : 1.4), kit ? 2.4 : 3.2, kit ? 2.0 : 2.6, PX_DARK);

    if (front) {
      const ey = kit ? 12 : 8, low = kit ? 0 : 1;
      for (const ex of [hcx - 3, hcx + 2]) {
        if (eyes === 'shut') {
          pxPut(g, ex, ey + low, PX_EYE); pxPut(g, ex + 1, ey + low, PX_EYE);
          continue;
        }
        // A pale face gets a tall dark eye with one highlight and a fleck of
        // iris. A dark face gets the eye in the iris colour instead, since a
        // dark eye on dark fur simply disappears. An iris band across the
        // middle was tried first and made every cat look half-asleep.
        const lit = darkFace ? PX_IRIS : PX_EYE;
        pxPut(g, ex, ey - 1, PX_HI); pxPut(g, ex + 1, ey - 1, lit);
        if (!kit) { pxPut(g, ex, ey, lit); pxPut(g, ex + 1, ey, lit); }
        pxPut(g, ex, ey + low, lit); pxPut(g, ex + 1, ey + low, darkFace ? PX_EYE : PX_IRIS);
        if (eyes === 'wide') { pxPut(g, ex, ey - 2, lit); pxPut(g, ex + 1, ey - 2, lit); }
      }
      const ny = ey + (kit ? 2 : 3);
      pxPut(g, hcx, ny, PX_PINK);
      // No mouth on a kitten: on a head that small it merges with the outline.
      if (!kit) { pxPut(g, hcx - 1, ny + 1, PX_INK); pxPut(g, hcx + 1, ny + 1, PX_INK); }
      // Blush in pink, never in the shade colour: dark cheeks read as dirt on
      // a pale cat.
      pxPut(g, hcx - (kit ? 3 : 4), ny, PX_PINK); pxPut(g, hcx + (kit ? 3 : 4), ny, PX_PINK);
    }
    return pxOutline(g);
  }

  function catSprite(br, seated, front, eyes, kit) {
    const key = `${br.id}|${seated ? 's' : 'u'}|${front ? 'f' : 'b'}|${eyes}|${kit ? 'k' : 'a'}`;
    let cv = spriteCache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.width = PXW; cv.height = PXH;
    const c = cv.getContext('2d');
    const g = catGrid(br, seated, front, eyes, kit);
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

  // ---- Hand-placed pixel art ---------------------------------------------
  // Shading here is never a blend. A material is a short ramp from dark to
  // light, and a lit value picks from it through a 4x4 Bayer matrix, so two
  // neighbouring tones dither into a third without a new colour appearing.
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function rampPick(pal, val, x, y) {
    const th = 0.25 + 0.5 * (BAYER[y & 3][x & 3] + 0.5) / 16;
    const i = Math.floor(Math.max(0, Math.min(1, val)) * (pal.length - 1) + th);
    return pal[Math.max(0, Math.min(pal.length - 1, i))];
  }
  function pxDisc(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1))));
      c.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  // The outline of an ellipse, one pixel thick, for a ring on the floor.
  function pxRing(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    const half = (y) => (Math.abs(y) > ry ? -1 : Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry || 1)))));
    for (let y = -ry; y <= ry; y++) {
      const w = half(y), wn = half(Math.abs(y) + 1);
      const n = w - wn;
      c.fillRect(cx - w, cy + y, n, 1);
      c.fillRect(cx + w - n + 1, cy + y, n, 1);
    }
  }
  // A rounded lump lit from the upper left: foliage, a beanbag, a lampshade.
  function pxLump(c, cx, cy, rx, ry, pal, outline) {
    if (outline) pxDisc(c, cx, cy, rx + 1, ry + 1, outline);
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const nx = x / (rx + 0.5), ny = y / (ry + 0.5), d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const lit = -0.5 * nx - 0.55 * ny + 0.67 * Math.sqrt(1 - d2);
      c.fillStyle = rampPick(pal, (lit + 0.3) / 1.25, cx + x, cy + y);
      c.fillRect(cx + x, cy + y, 1, 1);
    }
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
    vending: '🥤', foosball: '⚽', phone: '📞', bento: '🍱',
    lift: '🏋️', treadmill: '🏃', wheel: '🌀', yoga: '🧘', box: '📦', sun: '☀️',
  };

  // Five-pixel capitals, only the ones the walls use. A font run through
  // the pixel buffer comes out as smears; these are placed dot by dot.
  const PX_FONT = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
    E: ['###', '#..', '##.', '#..', '###'], G: ['###', '#..', '#.#', '#.#', '###'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
    I: ['#', '#', '#', '#', '#'], M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
    P: ['###', '#.#', '###', '#..', '#..'], S: ['###', '#..', '###', '..#', '###'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
    '✓': ['....#', '...#.', '#.#..', '.#...', '.....'], ' ': ['..', '..', '..', '..', '..'],
  };
  // Nine-pixel capitals with two-pixel stems, for the banner. Drawn at this
  // size rather than doubled up from the small ones, which left the
  // diagonals too short to tell N from M.
  const PX_BIG = {
    A: ['..###..', '.#####.', '##...##', '##...##', '#######', '#######', '##...##', '##...##', '##...##'],
    I: ['##', '##', '##', '##', '##', '##', '##', '##', '##'],
    N: ['##...##', '###..##', '###..##', '####.##', '##.####', '##..###', '##..###', '##...##', '##...##'],
    W: ['##.....##', '##.....##', '##.....##', '##..#..##', '##.###.##', '##.###.##', '####.####', '###...###', '##.....##'],
    ' ': ['...', '...', '...', '...', '...', '...', '...', '...', '...'],
  };
  const pxGlyph = (ch, font = PX_FONT) => font[ch] || font[' '];
  const pxTextWidth = (str, font = PX_FONT, gap = 1) => [...str].reduce((w, ch) => w + pxGlyph(ch, font)[0].length + gap, -gap);
  // `slope` shears the line to lie along a wall: half a pixel down per
  // pixel across on the back wall, half a pixel up on the left one.
  // `k` is the size: each dot of a glyph becomes k pixels square. The shear
  // is still applied a pixel column at a time, so big letters lean smoothly.
  function pxText(c, str, x0, y0, col, slope = 0, k = 1, font = PX_FONT, gap = 1) {
    c.fillStyle = col;
    let X = x0;
    for (const ch of [...str]) {
      const g = pxGlyph(ch, font);
      for (let gx = 0; gx < g[0].length; gx++) {
        for (let sub = 0; sub < k; sub++, X++) {
          const dy = Math.round(X * slope);
          for (let gy = 0; gy < g.length; gy++) if (g[gy][gx] === '#') c.fillRect(X, y0 + gy * k + dy, 1, k);
        }
      }
      X += gap * k;
    }
  }
  function pxLine(c, x0, y0, x1, y1, col) {
    c.fillStyle = col;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx - dy;
    for (;;) {
      c.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 > -dy) { e -= dy; x0 += sx; }
      if (e2 < dx) { e += dx; y0 += sy; }
    }
  }

  // A mug five pixels wide, standing on the origin.
  function pxMug(c, col, drink = '#6b3f22') {
    c.fillStyle = INK_HEX; c.fillRect(-2, -5, 5, 6); c.fillRect(3, -4, 2, 3);
    c.fillStyle = col; c.fillRect(-1, -4, 3, 4); c.fillRect(3, -3, 1, 1);
    c.fillStyle = drink; c.fillRect(-1, -4, 3, 1);
  }

  // ---- What the gym reads off a session ----------------------------------
  const ctxPct = (s) => (s && s.context && s.context.used ? Math.min(1, s.context.used / (s.context.window || 200000)) : 0);
  // Steps on a log scale: a quiet day and a heavy one are orders apart.
  const tokTier = (s) => { const n = (s && s.today && s.today.tokens) || 0; return n >= 5e6 ? 5 : n >= 1e6 ? 4 : n >= 3e5 ? 3 : n >= 1e5 ? 2 : n > 0 ? 1 : 0; };
  const turnTier = (s) => { const n = (s && s.today && s.today.turns) || 0; return n >= 60 ? 5 : n >= 30 ? 4 : n >= 15 ? 3 : n >= 6 ? 2 : n > 0 ? 1 : 0; };
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  // The number a cat on a machine is showing, for the tag over its head.
  function gymStat(act, s) {
    if (act === 'lift' && s.context && s.context.used) {
      const pct = ctxPct(s);
      return { text: '🧠 ' + Math.round(pct * 100) + '%', color: pct >= 0.85 ? '#de4b40' : pct >= 0.6 ? '#e09412' : '#5f9a4c' };
    }
    if (act === 'treadmill' && s.today && s.today.tokens) return { text: '🔥 ' + fmtTok(s.today.tokens), color: '#3b8ee0' };
    if (act === 'wheel' && s.today && s.today.turns) return { text: '↻ ' + s.today.turns, color: '#8b6be6' };
    return null;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const pick = (arr, h, salt) => arr[(Math.imul(h ^ Math.imul(salt, 2654435761), 2246822519) >>> 0) % arr.length];
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function palette(scene) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const base = dark ? {
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
    // A scene lays its own colours over the office ones.
    const over = SCENE_ART[scene] && SCENE_ART[scene].palette;
    return over ? Object.assign(base, over[dark ? 'dark' : 'light']) : base;
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
    constructor(root, { onHover, label, onFrame, showAgent = true, compact = false, scene = 'office' } = {}) {
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
      // The scene: its drawing stands in for the office method of the same
      // name, on this one office, before the room is planned.
      this.scene = SCENES.includes(scene) ? scene : 'office';
      this.sceneArt = SCENE_ART[this.scene] || {};
      for (const [k, fn] of Object.entries(this.sceneArt)) if (typeof fn === 'function') this[k] = fn;
      this.pal = palette(this.scene);
      this.plan = this.buildPlan(0);
      this.cat = { x: this.plan.W - 3, y: this.plan.D - 2, path: [], until: 0, face: 1, petAt: 0, strokes: 0, hearts: [] };
      this.theme = matchMedia('(prefers-color-scheme: dark)');
      this.onTheme = () => (this.pal = palette(this.scene));
      this.theme.addEventListener('change', this.onTheme);

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(root);
      this.canvas.addEventListener('mousemove', (e) => this.pointer(e));
      this.canvas.addEventListener('click', (e) => this.pointer(e, true));
      this.canvas.addEventListener('mouseleave', () => { this.hoverKey = null; this.rubAt = null; this.onHover(null); });
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
      const GD = 3.3;                              // gym strip along the front
      const D = Math.max(OD + 3.4 + GD, 14.5);
      const gy = D - GD;
      const RW = 7.2;                              // right column width
      const W = OW + RW;
      const MR = 5.2;                              // meeting room depth
      const PY = 9.9;                              // pantry / lounge boundary
      const grid = new Grid(W, D);
      const items = [];
      const pois = [];
      const desks = [];
      // `live` marks furniture that animates; everything else is baked to a
      // sprite. It may be a function, for things that only move some of the
      // time, and `state` names what a baked sprite depends on besides the room.
      const add = (depth, draw, live = false, state = null) => items.push({ depth, draw, live, state });
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
        const panels = this.sceneArt.panels || PANEL;
        const panel = panels[p % panels.length];
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
      add(rx + 0.35 + 0.51, () => this.rackLights(rx, 0.2), true);
      prop('rack', { x: rx, y: 0.2 });
      prop('printer', { x: OW - 2.3, y: 0.25 });
      solid(rx, 0.2, 0.7, 0.6);
      add(OW - 2.3 + 0.3 + 0.5, () => this.printer(OW - 2.3, 0.25));
      solid(OW - 2.3, 0.25, 0.75, 0.55);
      for (const [x, y] of [[0.45, 0.45], [0.45, OD - 0.2]]) { add(x + y, () => this.plant(x, y), true); prop('plant', { x, y }); solid(x - 0.2, y - 0.2, 0.4, 0.4); }
      const windows = [];
      for (let x = 1.0; x < OW - 2.6; x += 2.4) {
        windows.push(x);
        poi(x + 0.75, 0.75, 'window', 'back');
      }
      // A cushion in the light, in each gap between pods.
      for (let c = 1; c < podCols; c++) {
        const sx = 1.3 + c * 4.2 - 0.57, sy = 0.9;
        add(sx + sy - 0.3, () => this.cushion(sx, sy));
        poi(sx, sy, 'sun', 'front', { sit: 0.06, sleepy: true });
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
      if (gy - fy >= 1.7) {
        add(0.5 + fy + 0.4, () => this.vending(0.12, fy, '#c0392b'));
        add(0.5 + fy + 0.41, () => this.vendingLight(0.12, fy), true);
        prop('vending', { x: 0.12, y: fy, color: '#c0392b' });
        prop('vending', { x: 0.12, y: fy + 0.8, color: '#2f6fb0' });
        add(0.5 + fy + 1.2, () => this.vending(0.12, fy + 0.8, '#2f6fb0'));
        add(0.5 + fy + 1.21, () => this.vendingLight(0.12, fy + 0.8), true);
        solid(0.1, fy, 0.75, 1.55);
        poi(1.3, fy + 0.4, 'vending', 'back');
        poi(1.3, fy + 1.2, 'vending', 'back');
      }
      if (gy - fy >= 1.5) {
        const fx = 3.0, fby = fy + 0.4;
        add(fx + 0.8 + fby + 0.4, () => this.foosball(fx, fby));
        add(fx + 0.8 + fby + 0.41, () => this.foosRods(fx, fby), true);
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
      }

      // ---- gym along the front. What a cat does here is its own numbers:
      // the bar carries its context, the belt and the wheel run at its day.
      const dy = D - 1.2;
      const gym = { x0: 3.7, x1: OW - 0.4, y0: gy + 0.2, y1: D - 0.2 };
      const g0 = gym.x0 + 0.15 + Math.max(0, (gym.x1 - gym.x0 - 5.3) / 2);
      const station = (x, y, act, opt) => { poi(x, y, act, 'front', opt); return pois[pois.length - 1]; };
      {
        const tx = g0 + 0.2, ty = gy + 0.5;
        const q = station(tx + 0.35, ty + 0.85, 'treadmill', { z: 0.12 });
        add(tx + 0.35 + ty + 0.6, () => this.treadmill(tx, ty, q), () => !!this.userOf(q));
        solid(tx, ty, 0.7, 1.5, 0.05);
      }
      {
        const cx = g0 + 2.25, wy = gy + 0.8;
        const q = station(cx, wy + 0.18, 'wheel', { z: 0.14 });
        add(cx + wy - 0.02, () => this.catWheel(cx, wy, q, false), () => !!this.userOf(q));
        add(cx + wy + 0.6, () => this.catWheel(cx, wy, q, true));
        solid(cx - 1.05, wy, 2.1, 0.36, 0.05);
      }
      {
        const lx2 = g0 + 3.55, ly2 = gy + 0.45;
        const q = station(lx2 + 0.7, ly2 + 0.8, 'lift', { z: 0.05 });
        add(lx2 + 0.7 + ly2 + 0.1, () => this.liftRack(lx2, ly2, q), () => !!this.userOf(q));
        solid(lx2 + 0.1, ly2, 1.2, 0.15, 0.03);
      }
      const mats = [
        { x: g0 + 2.25, y: gy + 2.35, w: 1.3, d: 0.6, color: '#8b6be6' },
        { x: g0 + 3.85, y: gy + 2.35, w: 1.3, d: 0.6, color: '#2fa39a' },
      ];
      for (const mt of mats) poi(mt.x + mt.w / 2, mt.y + mt.d / 2, 'yoga', 'front');
      add(g0 + 0.7 + gy + 2.75, () => this.dumbbells(g0 + 0.05, gy + 2.5));
      solid(g0 + 0.05, gy + 2.5, 1.0, 0.3, 0.04);

      // ---- by the door: whoever is waiting for the user comes here to be
      // seen. The one who has waited longest takes it out on the post.
      const wait = {
        x0: 0.95, x1: 3.3, y0: dy - 0.8, y1: dy + 1.0,
        spots: [{ x: 1.4, y: dy - 1.45, act: 'scratch' }],
      };
      for (const yy of [dy + 0.5, dy - 0.35]) for (const xx of [1.45, 2.2, 2.95]) wait.spots.push({ x: xx, y: yy });
      add(0.45 + dy - 1.35 + 0.1, () => this.scratchPost(0.45, dy - 1.35), false, () => this.scratch || 0);
      solid(0.2, dy - 1.6, 0.5, 0.5, 0.03);

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
      add(W - 0.45 + 0.45, () => this.plant(W - 0.45, 0.45), true);
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
      add(mx + 2.65 + cy + 0.36, () => this.coffeeLight(mx + 2.4, cy + 0.12), true);
      add(mx + 4.15 + cy + 0.35, () => this.sink(mx + 3.9, cy + 0.12));
      add(W - 0.75 + cy + 0.4, () => this.fridge(W - 1.15, cy));
      solid(W - 1.15, cy, 0.85, 0.75);
      add(mx + 0.55 + cy + 0.25, () => this.waterCooler(mx + 0.35, cy + 0.05));
      add(mx + 0.55 + cy + 0.26, () => this.coolerBubble(mx + 0.35, cy + 0.05), true);
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
      add(ax + 0.35 + ay + 0.36, () => this.arcadeScreen(ax, ay), true);
      prop('arcade', { x: ax, y: ay });
      prop('plant', { x: W - 0.5, y: D - 0.5 });
      prop('rug', { x: OW + 0.3, y: PY + 0.6, w: 4.0, d: D - PY - 1.0 });
      solid(ax, ay, 0.7, 0.7);
      poi(ax + 0.35, ay + 1.15, 'arcade', 'back');
      add(W - 0.5 + D - 0.5, () => this.plant(W - 0.5, D - 0.5), true);

      // A cardboard box, because the couch cost money and this is what they wanted.
      const bx2 = OW + 4.9, by2 = D - 1.75;
      add(bx2 + by2 + 0.2, () => this.cardboard(bx2, by2, false));
      add(bx2 + by2 + 1.3, () => this.cardboard(bx2, by2, true));
      solid(bx2, by2, 0.8, 0.7, 0.02);
      poi(bx2 + 0.4, by2 + 0.38, 'box', 'front', { sit: 0.02, sleepy: true });

      const posters = [
        { y: 2.2, w: 3.8, color: '#f2c230', ink: '#3b2a12', text: 'WANIN' },
      ];
      return { W, D, OW, OD, MR, PY, RW, grid, items, props, pois, desks, windows, posters, pp, gym, mats, wait, door: { x: 0.4, y: D - 1.2 } };
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
      // A subagent whose parent is on the floor comes along as its kitten
      // instead of taking a desk of its own.
      const byKey = new Map(sessions.map((s) => [s.key, s]));
      const clock = Date.now();
      const litters = new Map();
      const grown = [];
      for (const s of sessions) {
        let par = s.subagent && s.parentId != null ? byKey.get(`${s.agent}:${s.parentId}`) : null;
        // A subagent's subagent belongs to the same grown cat.
        for (let hop = 0; par && par.subagent && hop < 4; hop++) {
          const up = byKey.get(`${par.agent}:${par.parentId}`);
          if (!up || up === par) break;
          par = up;
        }
        if (!par || par === s) { grown.push(s); continue; }
        // Around for its errand and a little after, then gone.
        if (!WORKING.has(s.status) && clock - (s.lastEventAt || 0) > KITTEN_LINGER) continue;
        if (!litters.has(par.key)) litters.set(par.key, []);
        litters.get(par.key).push(s);
      }
      const working = grown.filter((s) => WORKING.has(s.status));
      const off = grown
        .filter((s) => !WORKING.has(s.status))
        .sort((a, b) => (b.lastEventAt || 0) - (a.lastEventAt || 0));
      const wanderers = off.slice(0, MAX_WANDERERS);
      this.offDuty = off.length - wanderers.length;

      const cap = this.plan.desks.length;
      // Scene packs have a fixed floor plan; the built-in office grows with the team.
      if (!this.plan.fixed && (working.length > cap - 1 || (cap > 8 && working.length < cap * 0.35))) {
        this.plan = this.buildPlan(working.length);
        this.deskOf.clear();
        for (const p of this.people.values()) { p.poi = null; p.napDesk = null; p.desk = null; p.until = 0; p.spot = null; p.followAt = null; }
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

      // Whoever is waiting for the user queues at the door, longest wait
      // first, so one look at the door says how many and for how long.
      const spots = this.plan.wait.spots;
      const queue = working.filter((s) => s.status === 'waiting' && this.deskOf.has(s.key))
        .sort((a, b) => (a.lastEventAt || 0) - (b.lastEventAt || 0)).slice(0, spots.length);
      const spotOf = new Map(queue.map((s, i) => [s.key, spots[i]]));
      this.scratch = queue.length ? Math.min(5, 1 + Math.floor(Math.max(0, clock - (queue[0].lastEventAt || clock)) / 120000)) : 0;

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
          const spot = spotOf.get(s.key);
          if (spot) {
            // The desk stays theirs; they have got up to come and find you.
            if (p.mode !== 'door' || p.spot !== spot) { p.spot = spot; this.goTo(p, spot); }
            p.desk = desk;
            p.mode = 'door';
          } else {
            if (p.desk !== desk || p.mode !== 'work') { p.desk = desk; this.goTo(p, desk.seat); }
            p.mode = 'work';
            p.spot = null;
          }
        } else {
          if (p.mode !== 'wander') { p.mode = 'wander'; p.desk = null; p.poi = null; p.until = 0; }
          // Someone started working at the desk this one was napping on.
          if (p.napDesk && takenDesks.has(p.napDesk)) { this.release(p); p.path = []; }
        }
      }
      for (const [pk, kits] of litters) {
        const par = this.people.get(pk);
        if (!par || !shown.has(pk)) continue;
        kits.sort((a, b) => WORKING.has(b.status) - WORKING.has(a.status) || (b.lastEventAt || 0) - (a.lastEventAt || 0));
        const keep = kits.slice(0, MAX_KITTENS).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0) || (a.key < b.key ? -1 : 1));
        keep.forEach((s, slot) => {
          shown.add(s.key);
          let p = this.people.get(s.key);
          if (!p) {
            // Born at the parent's side, in the parent's coat.
            p = this.newPerson(s);
            p.x = par.x; p.y = par.y; p.placeOnArrive = false; p.breed = par.breed;
            this.people.set(s.key, p);
          }
          p.s = s;
          p.leaving = false;
          if (p.mode !== 'follow') { this.release(p); p.desk = null; p.mode = 'follow'; p.followAt = null; }
          p.parent = par;
          p.slot = slot;
        });
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

    // Lunch is 12:30 to 13:30. `lunchOverride` is for looking at it at any
    // other hour: true, false, or 'eat' / 'nap' to pick which half.
    isLunch() {
      if (this.lunchOverride != null) return !!this.lunchOverride;
      const d = new Date();
      const m = d.getHours() * 60 + d.getMinutes();
      return m >= LUNCH_FROM && m < LUNCH_TO;
    }

    lunchEating() {
      if (typeof this.lunchOverride === 'string') return this.lunchOverride === 'eat';
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes() < LUNCH_FROM + 30;
    }

    // A kitten keeps to its parent: a place beside wherever the parent is
    // headed, so it sets off when the parent does instead of trailing a step
    // behind it.
    follow(p) {
      const par = p.parent;
      if (!par || !this.people.has(par.key)) return;
      const dest = par.path.length ? par.path[par.path.length - 1] : par;
      const at = p.followAt;
      if (at && at.slot === p.slot && Math.hypot(at.x - dest.x, at.y - dest.y) < 0.3) return;
      const grid = this.plan.grid;
      const ring = [[0.62, 0.3], [-0.62, 0.3], [0.92, -0.15], [-0.92, -0.15], [0.3, 0.78], [-0.34, 0.78], [0.5, -0.62], [-0.5, -0.62], [0, 1.05], [0, -0.8]];
      const others = [...this.people.values()].filter((o) => o !== p && o.mode === 'follow' && o.parent === par && o.followTo);
      let spot = null;
      for (let k = 0; k < ring.length && !spot; k++) {
        const [ox, oy] = ring[(p.slot + k) % ring.length];
        const x = dest.x + ox, y = dest.y + oy;
        if (grid.blocked(x, y)) continue;
        if (others.some((o) => Math.hypot(o.followTo.x - x, o.followTo.y - y) < 0.3)) continue;
        spot = { x, y };
      }
      spot = spot || { x: dest.x + 0.2, y: dest.y + 0.35 };
      p.followAt = { x: dest.x, y: dest.y, slot: p.slot };
      p.followTo = spot;
      this.goTo(p, spot);
    }

    wander(p, now) {
      if (p.path.length) return;
      if (p.poi && now < p.until) return;
      this.release(p);
      const plan = this.plan;
      const workingDesks = new Set([...this.deskOf.values()].map((i) => plan.desks[i]));
      const sleepy = p.s.status === 'idle';
      // Half the office eats first and sleeps after; the other half the other way
      // round, so at any moment of the hour there is some of each.
      const lunch = this.lunch, eating = lunch && this.lunchEating() === (p.h % 2 === 0);
      const weighted = [];
      for (const q of plan.pois) {
        if (q.taken) continue;
        // At lunch there are only two things to do.
        if (lunch && !LUNCH_EAT.has(q.act) && !LUNCH_NAP.has(q.act)) continue;
        let w = 1;
        if (q.pair) w = plan.pois.some((o) => o.pair === q.pair && o !== q && o.taken) ? 7 : 1.2;
        if (q.act === 'couch' || q.act === 'beanbag' || q.sleepy) w = sleepy ? 3 : 1.4;
        // The gym is a gauge, so the cats with most to show get it first.
        if (q.act === 'lift') w = 0.8 + 4 * ctxPct(p.s);
        if (q.act === 'treadmill') w = 0.8 + 0.4 * tokTier(p.s);
        if (q.act === 'wheel') w = 0.8 + 0.4 * turnTier(p.s);
        if (q.act === 'yoga') w = sleepy ? 2.5 : 1.2;
        // A cat that has just finished goes and lies in the sun.
        if (q.act === 'sun') w = p.s.status === 'done' ? 4 : sleepy ? 2 : 1;
        if (lunch) w = LUNCH_EAT.has(q.act) === eating ? 3 : 1;
        weighted.push([q, w]);
      }
      for (const d of plan.noNap ? [] : plan.desks) {
        if (workingDesks.has(d) || d.napper) continue;
        weighted.push([{ x: d.seat.x, y: d.seat.y, act: 'nap', face: d.side === 'n' ? 'front' : 'back', sit: plan.seatZ != null ? plan.seatZ : 0.34, desk: d }, lunch ? (eating ? 0.5 : 2) : sleepy ? 3 : 0.25]);
      }
      if (!weighted.length) return;
      let r = Math.random() * weighted.reduce((a, [, w]) => a + w, 0);
      let choice = weighted[0][0];
      for (const [q, w] of weighted) { r -= w; if (r <= 0) { choice = q; break; } }
      if (choice.desk) { choice.desk.napper = p.key; p.napDesk = choice.desk; }
      choice.taken = p.key;
      p.poi = choice;
      p.until = Infinity; // set on arrival
      const long = choice.act === 'nap' || choice.act === 'sun' || choice.act === 'box';
      const mid = ['pingpong', 'lift', 'treadmill', 'wheel', 'yoga'].includes(choice.act);
      p.stay = (lunch ? rand(240, 540) : long ? rand(25, 60) : mid ? rand(15, 30) : rand(8, 20)) * 1000;
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
      // S screen pixels per art pixel. In the main window it is always whole:
      // a zoom in between would resample the art and smear it, which is
      // exactly what went wrong when the camera was free to squeeze a
      // 21-pixel cat into five.
      //
      // The pop-out is a window the user drags to the size they want, and a
      // room that only grows at 1x, 2x, 3x looks stuck in between. There S
      // follows the window, and settles on a whole number when it is close
      // to one: a little under is rounded up (a sliver of margin is lost), a
      // little over is rounded down. The scene is still drawn one buffer
      // pixel per art pixel; only the enlargement in draw() is fractional.
      let S;
      if (this.compact) {
        const k = Math.max(0.25, fit * ART);
        const whole = Math.round(k);
        S = whole >= 1 && k >= whole * 0.94 && k <= whole * 1.12 ? whole : k;
      } else {
        S = Math.max(1, Math.floor(fit * ART + 0.25));
      }
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
      const pet = key === PET_KEY;
      this.canvas.style.cursor = pet ? 'grab' : key ? 'pointer' : 'default';
      if (pet) this.rubCat(mx, my, click); else this.rubAt = null;
      // A click on the cat is for the cat: it does not close a pinned card.
      if (key !== this.hoverKey || (click && !pet)) {
        this.hoverKey = key;
        const p = key && this.people.get(key);
        this.onHover(p ? p.s : null, { x: e.clientX, y: e.clientY }, !!click);
      }
    }

    // The mouse is on the cat. It stops for a hand held out to it; a click
    // is one stroke, and so is every PET_RUB pixels of rubbing.
    rubCat(mx, my, click) {
      const k = this.cat, now = Date.now();
      const wait = k.path.length || k.until === Infinity ? 0 : k.until;
      k.path = [];
      k.until = Math.max(wait, now + 2500);
      let strokes = click ? 1 : 0;
      if (this.rubAt) {
        this.rub = (this.rub || 0) + Math.hypot(mx - this.rubAt.x, my - this.rubAt.y);
        while (this.rub >= PET_RUB) { this.rub -= PET_RUB; strokes++; }
      }
      this.rubAt = { x: mx, y: my };
      if (!strokes) return;
      if (now - k.petAt > PET_STAY) k.strokes = 0;
      k.strokes += strokes;
      k.petAt = now;
      k.until = now + PET_STAY;
      if (k.hearts.length < 14) k.hearts.push({ at: this.t, dx: rand(-5, 5) });
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

    // Furniture that never changes is painted once into a sprite of its own
    // and blitted from then on. The room is some seven hundred polygons, each
    // filled a row at a time; redrawing them all every frame was fifteen
    // thousand fills, and that - not the enlargement it was blamed on - was
    // the whole frame budget.
    drawItem(it) {
      if (typeof it.live === 'function' ? it.live() : it.live) { it.draw(); return; }
      const key = this.bgKey + '|' + (skyColor().night ? 'n' : 'd') + (it.state ? '|' + it.state() : '');
      if (it.bakedFor !== key) {
        // A few per frame: baking the room in one go would stall the first one.
        if (this.bakedThisFrame >= 4) { it.draw(); return; }
        this.bakedThisFrame++;
        it.sprite = this.bakeItem(it);
        it.bakedFor = key;
      }
      const sp = it.sprite;
      if (!sp) return;
      const c = this.ctx;
      c.imageSmoothingEnabled = false;
      c.drawImage(sp.cv, sp.x, sp.y, sp.cv.width * ART, sp.cv.height * ART);
    }

    bakeItem(it) {
      const bg = this.bg;
      const tmp = this.bakeTmp || (this.bakeTmp = document.createElement('canvas'));
      if (tmp.width !== bg.width || tmp.height !== bg.height) { tmp.width = bg.width; tmp.height = bg.height; }
      const g = tmp.getContext('2d', { willReadFrequently: true });
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, tmp.width, tmp.height);
      // The same frame of reference as the room layer, so the sprite lands on
      // the same pixel grid when it is put back.
      g.setTransform(1 / ART, 0, 0, 1 / ART, -this.bgAt.x / ART, -this.bgAt.y / ART);
      const keep = this.ctx;
      this.ctx = g;
      try { it.draw(); } finally { this.ctx = keep; }
      const data = g.getImageData(0, 0, tmp.width, tmp.height).data;
      let x0 = tmp.width, y0 = tmp.height, x1 = -1, y1 = -1;
      for (let y = 0, i = 3; y < tmp.height; y++) {
        for (let x = 0; x < tmp.width; x++, i += 4) {
          if (!data[i]) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null;
      const cv = document.createElement('canvas');
      cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1;
      cv.getContext('2d').drawImage(tmp, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
      return { cv, x: this.bgAt.x + x0 * ART, y: this.bgAt.y + y0 * ART };
    }

    // Run fn with one unit = one art pixel and the origin on a projected
    // point, snapped to whole pixels. Everything hand-placed goes through it.
    art(p, fn) {
      const c = this.ctx;
      const m = c.getTransform();
      c.save();
      c.setTransform(1, 0, 0, 1, Math.round(p.x * m.a + m.e), Math.round(p.y * m.d + m.f));
      fn(c);
      c.restore();
    }

    // Five tones around one colour, dark to light.
    rampOf(base) {
      return [this.tint(base, -40), this.tint(base, -18), base, this.tint(base, 18), this.tint(base, 36)];
    }

    // -------------------------------------------------------- static room layer

    roomLayer() {
      const { W, D, OW, MR, PY } = this.plan;
      const key = [this.scene, W, D, OW, MR, PY, this.pal.wood1, this.pal.wallL].join('|');
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

    // The office floors, zone by zone. A scene with its own plan paints its own.
    paintFloor({ P, dot, STEP, planks }) {
      const { W, D, OW, MR, PY, pp } = this.plan;
      const pal = this.pal;
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

      // Gym floor: rubber tiles with a fleck, seams a tile apart.
      {
        const { x0, x1, y0, y1 } = this.plan.gym;
        const base = pal.dark ? '#2c333b' : '#8f9aa8';
        const lt = this.tint(base, 12), dk = this.tint(base, -14);
        this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], base);
        let i = 0;
        for (let y = y0 + STEP / 2; y < y1; y += STEP, i++) {
          let j = 0;
          for (let x = x0 + STEP / 2; x < x1; x += STEP, j++) {
            const k = (i * 5 + j * 11) % 23;
            if (k === 0) dot(P(x, y), lt); else if (k === 12) dot(P(x, y), dk);
          }
        }
        for (let x = x0 + 1; x < x1 - 0.2; x += 1) this.seg(P(x, y0), P(x, y1), dk);
        for (let y = y0 + 1; y < y1 - 0.2; y += 1) this.seg(P(x0, y), P(x1, y), dk);
        this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], null, this.tint(base, pal.dark ? 24 : -30));
        // Yoga mats lie flat, so they are part of the floor.
        for (const mt of this.plan.mats) {
          this.poly([P(mt.x, mt.y), P(mt.x + mt.w, mt.y), P(mt.x + mt.w, mt.y + mt.d), P(mt.x, mt.y + mt.d)], mt.color, this.tint(mt.color, -40));
          this.seg(P(mt.x + 0.08, mt.y + 0.1), P(mt.x + mt.w - 0.08, mt.y + 0.1), this.tint(mt.color, 22));
          this.seg(P(mt.x + 0.08, mt.y + mt.d - 0.12), P(mt.x + mt.w - 0.08, mt.y + mt.d - 0.12), this.tint(mt.color, -18));
        }
      }
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

      this.paintFloor({ P, dot, STEP, planks, rng });

      // The waiting mat by the door, in the colour "waiting" has everywhere else.
      {
        const { x0, x1, y0, y1, spots } = this.plan.wait;
        const base = pal.dark ? '#5c4a22' : '#f3d99b', rim = pal.dark ? '#8a6a20' : '#e0a83a';
        this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], rim);
        this.poly([P(x0 + 0.12, y0 + 0.12), P(x1 - 0.12, y0 + 0.12), P(x1 - 0.12, y1 - 0.12), P(x0 + 0.12, y1 - 0.12)], base);
        // a paw print where each one stands
        const ink = this.tint(base, pal.dark ? 30 : -34);
        for (const sp of spots.slice(1)) {
          const q = P(sp.x, sp.y);
          dot(q, ink, 0, 0); dot(q, ink, 1, 0); dot(q, ink, 0, 1); dot(q, ink, 1, 1); dot(q, ink, -1, 0); dot(q, ink, 2, 0);
          dot(q, ink, -2, -2); dot(q, ink, 0, -3); dot(q, ink, 1, -3); dot(q, ink, 3, -2);
        }
      }

      if (this.sceneFloor) this.sceneFloor({ P, dot, STEP, planks, rng });

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
      if (this.sceneWalls) this.sceneWalls({ P, dot, STEP });
      this.paintWalls();
    }


    // What hangs on the walls and never changes, painted into the room
    // layer with the walls themselves: whiteboard, sign, posters, the
    // clock's face, the door.
    paintWalls() {
      // in parts, so a scene can change one and keep the rest
      this.wallBoard(); this.wallSign(); this.wallBanner(); this.wallClock(); this.wallDoor();
    }

    wallKit() {
      const pal = this.pal;
      const P = (x, y, z) => this.iso(x, y, z);
      return {
        OW: this.plan.OW, pal, P,
        B: (u, z) => P(u, 0, z), // along the back wall
        L: (v, z) => P(0, v, z), // along the left wall
        edge: this.tint(pal.trim, pal.dark ? -14 : -24),
      };
    }

    // meeting room whiteboard: two headings, a flow, a chart, two notes
    wallBoard() {
      const { OW, pal, P, B, L, edge } = this.wallKit();
      const wx = OW + 2.4;
      const Wb = (u, z) => B(wx + u, z);
      this.poly([Wb(0, 0.8), Wb(2.6, 0.8), Wb(2.6, 1.95), Wb(0, 1.95)], '#fdfdfb', edge);
      this.seg(Wb(0.2, 1.8), Wb(0.9, 1.8), '#3b8ee0');
      this.seg(Wb(0.2, 1.68), Wb(1.3, 1.68), '#3b8ee0');
      this.seg(Wb(0.2, 1.56), Wb(0.7, 1.56), '#9cc4ee');
      for (const [u, z] of [[1.6, 1.5], [2.1, 1.16]]) {
        this.poly([Wb(u, z), Wb(u + 0.36, z), Wb(u + 0.36, z + 0.24), Wb(u, z + 0.24)], null, '#c96442');
      }
      this.seg(Wb(1.96, 1.56), Wb(2.1, 1.34), '#c96442');
      const pts = [[0.2, 1.0], [0.45, 1.16], [0.7, 1.06], [0.95, 1.3], [1.2, 1.22], [1.45, 1.42]];
      for (let i = 1; i < pts.length; i++) this.seg(Wb(pts[i - 1][0], pts[i - 1][1]), Wb(pts[i][0], pts[i][1]), '#5f9a4c');
      this.seg(Wb(0.2, 0.92), Wb(1.5, 0.92), '#b9bcc4');
      this.art(Wb(2.2, 1.8), (c) => {
        c.fillStyle = '#ffe066'; c.fillRect(0, 0, 2, 2);
        c.fillStyle = '#ff9ec0'; c.fillRect(3, 2, 2, 2);
      });
      this.box(wx + 0.4, 0, 0.74, 1.8, 0.07, 0.04, this.tint(pal.trim, 12), pal.trim, edge);
      this.art(P(wx + 0.7, 0.05, 0.78), (c) => {
        c.fillStyle = '#de4b40'; c.fillRect(0, -1, 2, 1);
        c.fillStyle = '#3b8ee0'; c.fillRect(4, 1, 2, 1);
        c.fillStyle = '#5f9a4c'; c.fillRect(8, 3, 2, 1);
      });
    }

    // the sign over the meeting room
    wallSign() {
      const { OW, pal, P, B, L, edge } = this.wallKit();
      const sx = OW + 0.3;
      this.poly([B(sx, 1.94), B(sx + 2.0, 1.94), B(sx + 2.0, 2.36), B(sx, 2.36)], this.shade(pal.trim, pal.dark ? 30 : -70), edge);
      this.art(B(sx + 0.12, 2.3), (c) => pxText(c, 'MEETING', 0, 0, pal.dark ? '#1c1c1a' : '#f4efe6', 0.5));
    }

    // a long banner on the left wall: a paper border, a rule inside it top
    // and bottom, the name in the big capitals, a pin at each end
    wallBanner() {
      const { OW, pal, P, B, L, edge } = this.wallKit();
      for (const ps of this.plan.posters) {
        const v0 = ps.y, v1 = ps.y + ps.w, z0 = 1.02, z1 = 1.98, GAP = 3, ROWS = 9;
        this.poly([L(v0, z0), L(v1, z0), L(v1, z1), L(v0, z1)], '#f6f1e6', edge);
        this.poly([L(v0 + 0.06, z0 + 0.06), L(v1 - 0.06, z0 + 0.06), L(v1 - 0.06, z1 - 0.06), L(v0 + 0.06, z1 - 0.06)], ps.color);
        const rule = this.tint(ps.color, ps.ink ? -34 : 26);
        this.seg(L(v0 + 0.16, z1 - 0.1), L(v1 - 0.16, z1 - 0.1), rule);
        this.seg(L(v0 + 0.16, z0 + 0.1), L(v1 - 0.16, z0 + 0.1), rule);
        const inner = Math.round((ps.w - 0.12) * (TW / 2 / ART));
        const pad = Math.max(0, Math.round((inner - pxTextWidth(ps.text, PX_BIG, GAP)) / 2));
        this.art(L(v1 - 0.06, (z0 + z1) / 2 + ROWS / 2 / (TH / ART)), (c) => pxText(c, ps.text, pad, 0, ps.ink || '#ffffff', -0.5, 1, PX_BIG, GAP));
        for (const v of [v0 + 0.1, v1 - 0.1]) {
          this.art(L(v, z1 - 0.02), (c) => { c.fillStyle = '#8a6a2a'; c.fillRect(0, 0, 2, 2); c.fillStyle = '#e8cf8a'; c.fillRect(0, 0, 1, 1); });
        }
      }
    }

    // the clock's face; the hands are drawn each frame
    wallClock() {
      const { OW, pal, P, B, L, edge } = this.wallKit();
      this.art(L(1.0, 1.85), (c) => {
        pxDisc(c, 0, 0, 6, 6, edge);
        pxDisc(c, 0, 0, 5, 5, pal.bubble);
        c.fillStyle = this.tint(pal.bubble, -70);
        c.fillRect(0, -5, 1, 1); c.fillRect(0, 5, 1, 1); c.fillRect(-5, 0, 1, 1); c.fillRect(5, 0, 1, 1);
      });
    }

    // the door: two panels, a brass knob, and a flap for the staff
    wallDoor() {
      const { OW, pal, P, B, L, edge } = this.wallKit();
      const dy = this.plan.door.y;
      const leaf = this.shade(pal.deskL, -10);
      const groove = this.tint(leaf, -26), lip = this.tint(leaf, 20);
      this.poly([L(dy - 0.6, 0), L(dy + 0.6, 0), L(dy + 0.6, 1.8), L(dy - 0.6, 1.8)], pal.trim, edge);
      this.poly([L(dy - 0.52, 0), L(dy + 0.52, 0), L(dy + 0.52, 1.72), L(dy - 0.52, 1.72)], leaf);
      for (const [z0, z1] of [[1.0, 1.6], [0.52, 0.86]]) {
        this.poly([L(dy - 0.38, z0), L(dy + 0.38, z0), L(dy + 0.38, z1), L(dy - 0.38, z1)], null, groove);
        this.seg(L(dy - 0.38, z1), L(dy + 0.38, z1), lip, 0, 1);
      }
      this.poly([L(dy - 0.2, 0.04), L(dy + 0.2, 0.04), L(dy + 0.2, 0.42), L(dy - 0.2, 0.42)], '#2a2420', pal.trim);
      this.seg(L(dy - 0.2, 0.42), L(dy + 0.2, 0.42), this.tint(pal.trim, 30));
      this.art(L(dy - 0.44, 0.94), (c) => {
        c.fillStyle = '#8a6a2a'; c.fillRect(0, 0, 2, 2);
        c.fillStyle = '#e8cf8a'; c.fillRect(0, 0, 1, 1);
      });
      const mat = pal.dark ? '#5a3b2e' : '#b9654a';
      this.poly([P(0.05, dy - 0.6), P(0.9, dy - 0.6), P(0.9, dy + 0.6), P(0.05, dy + 0.6)], mat, this.tint(mat, -30));
    }

    drawRoom() {
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

      // Windows, with the real sky outside: a cloud drifting by day, a moon
      // and two stars by night.
      const sky = skyColor();
      const frame = this.tint(pal.trim, pal.dark ? -14 : -24);
      for (const x of this.plan.windows) {
        const Wn = (u, z) => P(x + u, 0, z);
        this.poly([Wn(0, 0.85), Wn(1.5, 0.85), Wn(1.5, 2.0), Wn(0, 2.0)], sky.sky);
        if (sky.night) {
          this.art(Wn(0.32, 1.78), (c) => { pxDisc(c, 0, 0, 2, 2, '#f4f1d0'); pxDisc(c, 1, -1, 1, 1, sky.sky); });
          this.art(Wn(1.1, 1.74), (c) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, 1, 1); c.fillRect(-5, 3, 1, 1); });
        } else {
          const cx = 0.38 + ((t * 0.02 + x * 0.37) % 1) * 0.74;
          this.art(Wn(cx, 1.8), (c) => {
            c.fillStyle = '#ffffff';
            c.fillRect(-4, 0, 9, 2); c.fillRect(-2, -1, 4, 1); c.fillRect(1, -2, 3, 1);
            c.fillStyle = 'rgba(190,210,235,.9)'; c.fillRect(-3, 2, 7, 1);
          });
        }
        // a glint on the glass, then the frame: a rail, a post, a sill
        this.seg(Wn(0.14, 1.04), Wn(0.3, 1.36), 'rgba(255,255,255,.4)');
        this.seg(Wn(0.94, 0.98), Wn(1.06, 1.22), 'rgba(255,255,255,.3)');
        this.poly([Wn(0.72, 0.85), Wn(0.78, 0.85), Wn(0.78, 2.0), Wn(0.72, 2.0)], pal.trim);
        this.poly([Wn(0, 1.5), Wn(1.5, 1.5), Wn(1.5, 1.55), Wn(0, 1.55)], pal.trim);
        this.poly([Wn(0, 0.85), Wn(1.5, 0.85), Wn(1.5, 2.0), Wn(0, 2.0)], null, frame);
        this.box(x - 0.04, 0, 0.8, 1.58, 0.07, 0.05, this.tint(pal.trim, 14), pal.trim, frame);
        this.poly([P(x, 0.05), P(x + 1.5, 0.05), P(x + 1.95, 1.2), P(x + 0.45, 1.2)], sky.night ? 'rgba(120,140,200,.06)' : 'rgba(255,250,230,.16)');
      }

      // The clock keeps real time.
      this.art(P(0, 1.0, 1.85), (c) => {
        const d = new Date();
        const hand = (ang, len) => pxLine(c, 0, 0, Math.round(Math.sin(ang) * len), Math.round(-Math.cos(ang) * len), pal.bubbleInk);
        hand((d.getMinutes() / 60) * Math.PI * 2, 4);
        hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 2.6);
        c.fillStyle = '#de4b40'; c.fillRect(0, 0, 1, 1);
      });
    }

    // ------------------------------------------------------------ furniture

    plant(x, y) {
      const pal = this.pal;
      this.box(x - 0.18, y - 0.18, 0, 0.36, 0.36, 0.3, this.shade(pal.pot, 10), pal.pot, this.shade(pal.pot, -15));
      // Three lit clumps of leaves rather than soft blobs, which a pixel
      // buffer turns to fog. The top one leans now and then.
      const lean = Math.sin(this.t / 1400 + x) > 0.55 ? 1 : 0;
      const leaf = this.rampOf(pal.plant);
      const edge = this.tint(pal.plant, -58);
      this.art(this.iso(x, y, 0.3), (c) => {
        c.fillStyle = edge; c.fillRect(0, -3, 1, 3);
        pxLump(c, -3, -5, 3, 3, leaf, edge);
        pxLump(c, 3, -6, 3, 3, leaf, edge);
        pxLump(c, lean, -10, 3, 4, leaf, edge);
        c.fillStyle = leaf[4];
        c.fillRect(-5, -8, 1, 1); c.fillRect(5, -9, 1, 1); c.fillRect(lean - 1, -14, 1, 1);
        c.fillStyle = edge;
        c.fillRect(-1, -6, 1, 1); c.fillRect(2, -8, 1, 1);
      });
    }

    serverRack(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      this.box(x, y, 0, 0.7, 0.6, 1.9, '#3a3d44', '#24262b', '#1b1d21');
      // rack units on the face we see, a vent down the side
      for (let r = 0; r < 8; r++) {
        const z = 1.78 - r * 0.22;
        this.poly([P(x + 0.06, y + 0.6, z - 0.15), P(x + 0.64, y + 0.6, z - 0.15), P(x + 0.64, y + 0.6, z), P(x + 0.06, y + 0.6, z)], r % 3 === 2 ? '#2b2e34' : '#30333a');
        this.seg(P(x + 0.06, y + 0.6, z), P(x + 0.64, y + 0.6, z), '#474b54');
      }
      for (let v = 0.12; v < 0.5; v += 0.1) this.seg(P(x + 0.7, y + v, 0.3), P(x + 0.7, y + v, 1.6), '#121316');
    }

    rackLights(x, y) {
      const busy = this.deskOf.size;
      for (let r = 0; r < 7; r++) {
        for (let k = 0; k < 4; k++) {
          const on = Math.sin(this.t / (180 + r * 37 + k * 53) + r * k) > 0.2 && (r * 4 + k) < Math.max(4, busy * 3);
          this.art(this.iso(x + 0.14 + k * 0.125, y + 0.6, 1.72 - r * 0.22), (c) => {
            c.fillStyle = on ? (k % 3 === 0 ? '#ffb347' : '#5cf08a') : '#2f3a33';
            c.fillRect(0, 0, 1, 1);
          });
        }
      }
    }

    printer(x, y) {
      const pal = this.pal;
      const P = (a, b, c) => this.iso(a, b, c);
      this.box(x, y, 0, 0.75, 0.55, 0.55, pal.deskTop, pal.deskL, pal.deskR);
      // cabinet doors
      this.seg(P(x + 0.375, y + 0.55, 0.05), P(x + 0.375, y + 0.55, 0.5), this.tint(pal.deskL, -26));
      this.art(P(x + 0.3, y + 0.55, 0.3), (c) => { c.fillStyle = this.tint(pal.deskL, -44); c.fillRect(0, 0, 1, 2); c.fillRect(3, 1, 1, 2); });
      // the printer: body, paper drawer, a slot with a sheet coming out
      this.box(x + 0.05, y + 0.05, 0.55, 0.65, 0.45, 0.28, '#e8e8e8', '#cfcfd2', '#b6b6ba');
      this.seg(P(x + 0.08, y + 0.5, 0.63), P(x + 0.67, y + 0.5, 0.63), '#9c9ca2');
      this.poly([P(x + 0.15, y + 0.5, 0.7), P(x + 0.6, y + 0.5, 0.7), P(x + 0.6, y + 0.5, 0.76), P(x + 0.15, y + 0.5, 0.76)], '#3a3d44');
      this.poly([P(x + 0.2, y + 0.5, 0.74), P(x + 0.55, y + 0.5, 0.74), P(x + 0.55, y + 0.72, 0.7), P(x + 0.2, y + 0.72, 0.7)], '#ffffff', '#c9c9cc');
      this.seg(P(x + 0.26, y + 0.58, 0.725), P(x + 0.48, y + 0.58, 0.725), '#b9bcc4');
      this.seg(P(x + 0.26, y + 0.64, 0.715), P(x + 0.42, y + 0.64, 0.715), '#b9bcc4');
      // control panel on top
      this.poly([P(x + 0.45, y + 0.1, 0.83), P(x + 0.66, y + 0.1, 0.83), P(x + 0.66, y + 0.3, 0.83), P(x + 0.45, y + 0.3, 0.83)], '#3a3d44');
      this.art(P(x + 0.52, y + 0.2, 0.83), (c) => { c.fillStyle = '#7be08a'; c.fillRect(0, 0, 1, 1); c.fillStyle = '#9fd8ff'; c.fillRect(2, 0, 2, 1); });
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
      const P = (a, b, c) => this.iso(a, b, c);
      const top = this.shade(pal.deskTop, 12);
      for (const lx of [x + 0.3, x + 2.58]) {
        this.box(lx, y + 0.3, 0, 0.12, 0.8, 0.06, pal.deskL, pal.deskL, pal.deskR);
        this.box(lx, y + 0.62, 0.06, 0.12, 0.16, 0.64, pal.deskL, pal.deskL, pal.deskR);
      }
      this.box(x, y, 0.7, 3.0, 1.4, 0.08, top, pal.deskL, pal.deskR);
      // boards along the top
      for (const v of [0.47, 0.93]) this.seg(P(x + 0.02, y + v, 0.78), P(x + 2.98, y + v, 0.78), this.tint(top, -14));
      // an open laptop, its screen toward us
      this.box(x + 1.2, y + 0.55, 0.78, 0.5, 0.35, 0.02, '#3a3d44', '#2a2c31', '#1f2024');
      this.poly([P(x + 1.2, y + 0.55, 0.8), P(x + 1.7, y + 0.55, 0.8), P(x + 1.7, y + 0.5, 1.1), P(x + 1.2, y + 0.5, 1.1)], '#2a2c31', '#17181b');
      this.poly([P(x + 1.24, y + 0.55, 0.84), P(x + 1.66, y + 0.55, 0.84), P(x + 1.66, y + 0.51, 1.06), P(x + 1.24, y + 0.51, 1.06)], '#8fc7ff');
      this.seg(P(x + 1.28, y + 0.54, 0.99), P(x + 1.5, y + 0.54, 0.99), '#ffffff');
      this.seg(P(x + 1.28, y + 0.54, 0.93), P(x + 1.6, y + 0.54, 0.93), '#dff0ff');
      // minutes, a sheet somebody pushed aside, two cups, and the speaker
      // everyone leans toward
      this.poly([P(x + 0.35, y + 0.3, 0.785), P(x + 0.6, y + 0.3, 0.785), P(x + 0.6, y + 0.62, 0.785), P(x + 0.35, y + 0.62, 0.785)], '#ffffff', '#cfd2d6');
      for (const v of [0.38, 0.45, 0.52]) this.seg(P(x + 0.39, y + v, 0.785), P(x + 0.55, y + v, 0.785), '#aeb4bd');
      this.poly([P(x + 0.5, y + 0.72, 0.785), P(x + 0.78, y + 0.8, 0.785), P(x + 0.72, y + 1.07, 0.785), P(x + 0.45, y + 0.99, 0.785)], '#fff7d6', '#d9cf9f');
      this.art(P(x + 2.3, y + 0.9, 0.78), (c) => pxMug(c, '#f2f2f2'));
      this.art(P(x + 0.98, y + 1.05, 0.78), (c) => pxMug(c, '#c96442'));
      this.art(P(x + 2.0, y + 0.4, 0.78), (c) => {
        pxDisc(c, 0, -1, 3, 2, '#1f2024');
        c.fillStyle = '#4a4e57'; c.fillRect(-1, -2, 3, 1);
        c.fillStyle = '#7be08a'; c.fillRect(0, -1, 1, 1);
      });
    }

    stool(x, y, h, color) {
      this.art(this.iso(x, y, 0), (c) => pxDisc(c, 0, 0, 3, 1, '#34363a'));
      this.box(x - 0.04, y - 0.04, 0, 0.08, 0.08, h, '#6a6a6a', '#555', '#3c3c3c');
      this.box(x - 0.2, y - 0.2, h, 0.4, 0.4, 0.07, this.shade(color, 18), color, this.shade(color, -18));
    }

    roundTable(x, y) {
      const top = this.shade(this.pal.deskTop, 15), rim = this.shade(this.pal.deskTop, -20);
      this.art(this.iso(x, y, 0), (c) => pxDisc(c, 0, 0, 6, 3, '#34363a'));
      this.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.72, '#6a6a6a', '#555', '#3c3c3c');
      this.art(this.iso(x, y, 0.75), (c) => {
        pxDisc(c, 0, 2, 15, 7, rim);
        pxDisc(c, 0, 0, 15, 7, top);
        // the lit rim on the far side
        c.fillStyle = this.tint(top, 16);
        c.fillRect(-7, -7, 15, 1);
        // a plate with something on it, and a cup
        pxDisc(c, 5, -1, 4, 2, '#cfd4da');
        pxDisc(c, 5, -2, 3, 1, '#ffffff');
        c.fillStyle = '#c98a3c'; c.fillRect(4, -4, 3, 2);
        c.fillStyle = '#f0c27a'; c.fillRect(4, -4, 2, 1);
        c.translate(-7, 3);
        pxMug(c, '#7d93c4');
      });
    }

    coffeeMachine(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const m = this.pal.metal;
      // body with a steel band, a recess where the cup stands, beans on top
      this.box(x, y, 0.9, 0.5, 0.45, 0.6, '#555b63', '#3a3f45', '#2e3237');
      this.poly([P(x, y + 0.45, 1.36), P(x + 0.5, y + 0.45, 1.36), P(x + 0.5, y + 0.45, 1.44), P(x, y + 0.45, 1.44)], m);
      this.poly([P(x + 0.08, y + 0.45, 0.98), P(x + 0.42, y + 0.45, 0.98), P(x + 0.42, y + 0.45, 1.3), P(x + 0.08, y + 0.45, 1.3)], '#1c1e22');
      this.box(x + 0.2, y + 0.42, 1.2, 0.1, 0.06, 0.1, m, this.tint(m, -20), this.tint(m, -36));
      this.box(x + 0.05, y + 0.45, 0.9, 0.4, 0.1, 0.03, this.tint(m, -14), this.tint(m, -34), this.tint(m, -46));
      this.art(P(x + 0.25, y + 0.5, 0.93), (c) => pxMug(c, '#ffffff'));
      this.box(x + 0.12, y + 0.1, 1.5, 0.26, 0.24, 0.2, '#a9764a', '#7a5334', '#63432a');
      // cups stacked beside it
      this.box(x + 0.6, y + 0.12, 0.9, 0.14, 0.14, 0.2, '#ffffff', '#dcdcdc', '#c6c6c6');
      this.seg(P(x + 0.6, y + 0.26, 1.0), P(x + 0.74, y + 0.26, 1.0), '#b0b0b0');
    }

    coffeeLight(x, y) {
      const on = Math.sin(this.t / 400) > 0;
      this.art(this.iso(x + 0.44, y + 0.45, 1.4), (c) => { c.fillStyle = on ? '#ff6b4a' : '#7a3a2a'; c.fillRect(0, 0, 1, 1); });
      // steam off the cup
      const k = (this.t / 900) % 1;
      this.art(this.iso(x + 0.25, y + 0.5, 0.93), (c) => {
        c.fillStyle = 'rgba(255,255,255,.75)';
        c.fillRect(k < 0.5 ? 0 : 1, -7 - Math.floor(k * 4), 1, 1);
        c.fillRect(k < 0.5 ? 1 : 0, -9 - Math.floor(k * 4), 1, 1);
      });
    }

    sink(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const m = this.pal.metal;
      this.box(x, y + 0.05, 0.9, 0.55, 0.4, 0.02, '#aab2bb', '#7d858e', '#6c737b');
      // the basin, darker toward the wall, and its drain
      this.poly([P(x + 0.06, y + 0.12, 0.92), P(x + 0.49, y + 0.12, 0.92), P(x + 0.49, y + 0.4, 0.92), P(x + 0.06, y + 0.4, 0.92)], '#5d646c', '#474c53');
      this.seg(P(x + 0.06, y + 0.12, 0.92), P(x + 0.49, y + 0.12, 0.92), '#3d4248', 0, 1);
      this.art(P(x + 0.27, y + 0.27, 0.92), (c) => { c.fillStyle = '#2b2e33'; c.fillRect(0, 0, 1, 1); });
      this.box(x + 0.24, y + 0.03, 0.92, 0.06, 0.06, 0.3, this.tint(m, 20), m, this.tint(m, -30));
      this.box(x + 0.24, y + 0.03, 1.2, 0.06, 0.22, 0.04, this.tint(m, 20), m, this.tint(m, -30));
      // soap and a sponge
      this.art(P(x + 0.52, y + 0.1, 0.92), (c) => {
        c.fillStyle = INK_HEX; c.fillRect(-1, -5, 3, 6);
        c.fillStyle = '#5fc08a'; c.fillRect(0, -3, 1, 3);
        c.fillStyle = '#e8e8e8'; c.fillRect(0, -4, 1, 1);
      });
      this.art(P(x + 0.52, y + 0.38, 0.92), (c) => {
        c.fillStyle = '#4f9a5a'; c.fillRect(-1, -2, 3, 1);
        c.fillStyle = '#e9c46a'; c.fillRect(-1, -1, 3, 1);
      });
    }

    fridge(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const F = (u, z) => P(x + u, y + 0.75, z);
      this.box(x, y, 0, 0.85, 0.75, 1.95, '#eef1f4', '#cfd5db', '#bcc3ca');
      // two doors with the gap between them, a lit edge down the hinge side
      this.poly([F(0, 1.24), F(0.85, 1.24), F(0.85, 1.28), F(0, 1.28)], '#8f98a2');
      this.seg(F(0.03, 0.08), F(0.03, 1.22), '#e6eaee');
      this.seg(F(0.03, 1.3), F(0.03, 1.9), '#e6eaee');
      for (const [z0, z1] of [[1.36, 1.8], [0.7, 1.16]]) {
        this.poly([F(0.7, z0), F(0.76, z0), F(0.76, z1), F(0.7, z1)], '#7a828b');
        this.seg(F(0.7, z0), F(0.7, z1), '#f6f8fa');
      }
      // what ends up on a fridge door: magnets, a note, a drawing of a fish
      for (const [u, z, col] of [[0.2, 1.62, '#c96442'], [0.42, 1.5, '#3b8ee0'], [0.52, 1.72, '#e0a83a']]) {
        this.art(F(u, z), (c) => { c.fillStyle = col; c.fillRect(0, 0, 2, 2); });
      }
      this.poly([F(0.12, 0.88), F(0.32, 0.88), F(0.32, 1.12), F(0.12, 1.12)], '#fff7c2', '#d9cf9f');
      for (const z of [0.96, 1.02]) this.seg(F(0.16, z), F(0.28, z), '#b9ad74');
      this.art(F(0.21, 1.12), (c) => { c.fillStyle = '#5f9a4c'; c.fillRect(0, 0, 2, 2); });
      this.poly([F(0.4, 0.82), F(0.6, 0.82), F(0.6, 1.04), F(0.4, 1.04)], '#ffffff', '#c9ced6');
      this.art(F(0.47, 0.94), (c) => {
        c.fillStyle = '#e8913f'; c.fillRect(0, 0, 3, 2); c.fillRect(-1, 0, 1, 1); c.fillRect(-1, 1, 1, 1);
        c.fillStyle = '#241f1c'; c.fillRect(2, 0, 1, 1);
      });
      // kick plate, vents low on the side
      this.poly([F(0, 0), F(0.85, 0), F(0.85, 0.06), F(0, 0.06)], '#7d858e');
      for (const z of [0.12, 0.18, 0.24]) this.seg(P(x + 0.85, y + 0.12, z), P(x + 0.85, y + 0.62, z), '#a3abb3');
      // a cereal box and a plant on top
      this.box(x + 0.1, y + 0.2, 1.95, 0.3, 0.2, 0.28, '#f0b24a', '#e9a03b', '#c98428');
      this.art(P(x + 0.62, y + 0.4, 1.95), (c) => {
        c.fillStyle = this.pal.pot; c.fillRect(-2, -2, 4, 2);
        pxLump(c, 0, -5, 3, 3, this.rampOf(this.pal.plant), this.tint(this.pal.plant, -58));
      });
    }

    waterCooler(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const F = (u, z) => P(x + u, y + 0.42, z);
      this.box(x, y, 0, 0.42, 0.42, 0.95, '#eef1f4', '#cfd5db', '#bcc3ca');
      // the recess with its two taps and the drip tray under them
      this.poly([F(0.06, 0.5), F(0.36, 0.5), F(0.36, 0.78), F(0.06, 0.78)], '#aab3bc');
      this.poly([F(0.06, 0.46), F(0.36, 0.46), F(0.36, 0.5), F(0.06, 0.5)], '#5f666e');
      this.art(F(0.14, 0.72), (c) => { c.fillStyle = '#3b8ee0'; c.fillRect(0, 0, 1, 2); });
      this.art(F(0.28, 0.72), (c) => { c.fillStyle = '#de4b40'; c.fillRect(0, 0, 1, 2); });
      // the bottle
      const blue = this.rampOf(this.pal.dark ? '#5d93c4' : '#8fc3f0');
      const edge = this.tint(blue[2], -62);
      this.art(P(x + 0.21, y + 0.21, 0.95), (c) => {
        c.fillStyle = edge; c.fillRect(-2, -3, 5, 3);
        c.fillStyle = blue[1]; c.fillRect(-1, -2, 3, 2);
        pxLump(c, 0, -9, 4, 6, blue, edge);
        c.fillStyle = '#ffffff'; c.fillRect(-2, -12, 1, 4);
      });
      // paper cups on the side
      this.box(x + 0.42, y + 0.12, 0.55, 0.06, 0.12, 0.25, '#ffffff', '#e2e2e2', '#cfcfcf');
    }

    coolerBubble(x, y) {
      const k = (this.t / 1800) % 1;
      this.art(this.iso(x + 0.21, y + 0.21, 0.95), (c) => {
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.fillRect(1, -5 - Math.floor(k * 8), 1, 1);
        if (k > 0.4) c.fillRect(-1, -4 - Math.floor((k - 0.4) * 8), 1, 1);
      });
    }

    couch(x, y) {
      const pal = this.pal;
      const P = (a, b, c) => this.iso(a, b, c);
      const front = pal.couchD, side = this.shade(pal.couchD, -12);
      const seam = this.tint(pal.couchD, -24), hi = this.tint(pal.couch, 22);
      for (const fx of [x - 0.1, x + 2.82]) this.box(fx, y + 0.68, 0, 0.08, 0.08, 0.07, '#3a2f28', '#2e2520', '#241d19');
      this.box(x, y - 0.05, 0.3, 2.8, 0.25, 0.5, this.shade(pal.couch, 12), front, side);
      this.box(x, y, 0.06, 2.8, 0.8, 0.28, this.shade(pal.couch, 6), front, side);
      // Three cushions: a seam across the seat and down its front, and up
      // the back, with a button in the middle of each back cushion.
      for (let k = 1; k < 3; k++) {
        const sx = x + (2.8 / 3) * k;
        this.seg(P(sx, y + 0.2, 0.34), P(sx, y + 0.8, 0.34), seam);
        this.seg(P(sx, y + 0.8, 0.34), P(sx, y + 0.8, 0.08), seam);
        this.seg(P(sx, y + 0.2, 0.8), P(sx, y + 0.2, 0.36), seam);
      }
      this.seg(P(x, y + 0.8, 0.34), P(x + 2.8, y + 0.8, 0.34), hi);
      this.seg(P(x, y + 0.2, 0.8), P(x + 2.8, y + 0.2, 0.8), hi);
      for (let k = 0; k < 3; k++) {
        this.art(P(x + 0.47 + k * 0.93, y + 0.2, 0.58), (c) => { c.fillStyle = seam; c.fillRect(0, 0, 1, 1); });
      }
      for (const ax of [x - 0.16, x + 2.78]) {
        this.box(ax, y - 0.05, 0.06, 0.18, 0.85, 0.5, this.shade(pal.couch, 10), front, side);
        this.seg(P(ax, y + 0.8, 0.56), P(ax + 0.18, y + 0.8, 0.56), hi);
      }
      // a throw over one arm, a pillow at each end
      const throwCol = pal.dark ? '#b9a27a' : '#f1e3c4';
      this.poly([P(x - 0.16, y + 0.25, 0.565), P(x + 0.02, y + 0.25, 0.565), P(x + 0.02, y + 0.6, 0.565), P(x - 0.16, y + 0.6, 0.565)], throwCol);
      this.poly([P(x - 0.16, y + 0.8, 0.2), P(x - 0.16, y + 0.8, 0.565), P(x - 0.16, y + 0.6, 0.565), P(x - 0.16, y + 0.25, 0.565), P(x - 0.16, y + 0.25, 0.2)], throwCol);
      for (const [px, col] of [[x + 2.4, '#e9c46a'], [x + 0.42, '#c96442']]) {
        this.art(P(px, y + 0.34, 0.34), (c) => {
          pxLump(c, 0, -3, 5, 3, this.rampOf(col), this.tint(col, -70));
          c.fillStyle = this.tint(col, -30); c.fillRect(-1, -3, 3, 1);
        });
      }
    }

    coffeeTable(x, y) {
      const pal = this.pal;
      const P = (a, b, c) => this.iso(a, b, c);
      const top = this.shade(pal.deskTop, -6);
      // a top on four legs with a shelf under it, rather than a block
      for (const [lx, ly] of [[0.04, 0.04], [1.48, 0.04], [0.04, 0.58], [1.48, 0.58]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.24, pal.deskL, pal.deskL, pal.deskR);
      this.box(x + 0.06, y + 0.06, 0.08, 1.48, 0.58, 0.03, this.shade(pal.deskTop, -22), pal.deskR, this.shade(pal.deskR, -12));
      this.box(x, y, 0.24, 1.6, 0.7, 0.06, top, pal.deskL, pal.deskR);
      // a magazine, a mug, and a bowl of something for the cats
      this.poly([P(x + 0.18, y + 0.14, 0.305), P(x + 0.55, y + 0.14, 0.305), P(x + 0.55, y + 0.44, 0.305), P(x + 0.18, y + 0.44, 0.305)], '#c96442', '#8f462e');
      this.seg(P(x + 0.23, y + 0.22, 0.305), P(x + 0.5, y + 0.22, 0.305), '#ffe9d6');
      this.seg(P(x + 0.23, y + 0.3, 0.305), P(x + 0.42, y + 0.3, 0.305), '#f0b8a0');
      this.art(P(x + 0.85, y + 0.5, 0.3), (c) => pxMug(c, '#ffffff'));
      this.art(P(x + 1.25, y + 0.3, 0.3), (c) => {
        pxDisc(c, 0, -1, 4, 2, '#3b6ea8');
        pxDisc(c, 0, -2, 3, 1, '#e8913f');
        c.fillStyle = '#f6c98a'; c.fillRect(-1, -3, 1, 1); c.fillRect(1, -2, 1, 1);
      });
    }

    beanbag(x, y, color) {
      const pal5 = this.rampOf(color);
      const edge = this.tint(color, -70);
      this.art(this.iso(x, y, 0), (c) => {
        pxDisc(c, 0, -1, 10, 4, this.pal.shadow);
        pxLump(c, 0, -5, 9, 5, pal5, edge);
        // the dent where someone sat
        c.fillStyle = pal5[1];
        c.fillRect(-3, -6, 6, 1); c.fillRect(-2, -5, 4, 1);
      });
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
          if (i % 7 !== 3) {
            const col = cols[i % cols.length];
            this.poly([P(bx, y, z), P(bx + bw, y, z), P(bx + bw, y, z + bh), P(bx, y, z + bh)], col);
            this.seg(P(bx, y, z), P(bx, y, z + bh), this.tint(col, 30));
            if (i % 3 === 0) this.seg(P(bx, y, z + bh * 0.62), P(bx + bw, y, z + bh * 0.62), this.tint(col, 55));
          }
          bx += bw + 0.015;
          i++;
        }
        this.poly([P(x0, y, z - 0.02), P(x1, y, z - 0.02), P(x1, y, z), P(x0, y, z)], this.pal.deskR);
      }
    }

    arcade(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const F = (u, z) => P(x + u, y + 0.7, z);
      const body = '#3a2a6a', L = '#2b1f52', R = '#221843';
      this.box(x, y, 0, 0.7, 0.7, 1.75, body, L, R);
      // side art: two stripes up the cabinet's flank
      this.poly([P(x + 0.7, y + 0.1, 0.2), P(x + 0.7, y + 0.3, 0.2), P(x + 0.7, y + 0.6, 1.6), P(x + 0.7, y + 0.4, 1.6)], '#5a44a8');
      this.poly([P(x + 0.7, y + 0.36, 0.2), P(x + 0.7, y + 0.42, 0.2), P(x + 0.7, y + 0.68, 1.45), P(x + 0.7, y + 0.62, 1.45)], '#ffcf4a');
      // marquee, the bezel the screen sits in, the coin door
      this.poly([F(0, 1.55), F(0.7, 1.55), F(0.7, 1.72), F(0, 1.72)], '#ffcf4a');
      this.seg(F(0.08, 1.64), F(0.3, 1.64), '#de4b40');
      this.seg(F(0.38, 1.64), F(0.62, 1.64), '#de4b40');
      this.poly([F(0.06, 0.96), F(0.64, 0.96), F(0.64, 1.49), F(0.06, 1.49)], '#15102e');
      this.poly([F(0.2, 0.25), F(0.5, 0.25), F(0.5, 0.6), F(0.2, 0.6)], '#1d1638', '#4a3a8a');
      this.art(F(0.35, 0.46), (c) => { c.fillStyle = '#ffcf4a'; c.fillRect(0, 0, 1, 2); });
      // control panel: a stick and two buttons
      this.box(x, y + 0.7, 0.8, 0.7, 0.2, 0.08, '#4a3a8a', body, L);
      this.art(P(x + 0.22, y + 0.8, 0.88), (c) => {
        c.fillStyle = INK_HEX; c.fillRect(0, -3, 1, 3);
        c.fillStyle = '#e04a4a'; c.fillRect(-1, -5, 3, 2);
      });
      this.art(P(x + 0.45, y + 0.82, 0.88), (c) => {
        c.fillStyle = '#ffcf4a'; c.fillRect(0, -1, 1, 1);
        c.fillStyle = '#5ce0f0'; c.fillRect(2, 0, 1, 1);
      });
    }

    // The game on the arcade's screen: two rows of invaders, a ship, a shot.
    arcadeScreen(x, y) {
      const F = (u, z) => this.iso(x + u, y + 0.7, z);
      const t = this.t / 1000;
      this.poly([F(0.1, 1.0), F(0.6, 1.0), F(0.6, 1.45), F(0.1, 1.45)], `hsl(${(this.t / 30) % 360},45%,22%)`);
      const px = (u, z, col) => this.art(F(u, z), (c) => { c.fillStyle = col; c.fillRect(0, 0, 1, 1); });
      const shift = Math.round(Math.sin(t * 1.5) * 1.4) * 0.06;
      for (let k = 0; k < 3; k++) {
        px(0.2 + k * 0.125 + shift, 1.38, '#7be08a');
        px(0.2 + k * 0.125 - shift, 1.28, '#ff8fb1');
      }
      const ship = 0.33 + Math.round(Math.sin(t * 2.3) * 2) * 0.06;
      px(ship, 1.08, '#ffffff');
      px(ship, 1.12 + ((t * 1.6) % 1) * 0.12, '#ffe66b');
    }

    floorLamp(x, y) {
      const c0 = this.ctx;
      const b = this.iso(x, y, 0);
      const night = skyColor().night;
      if (night) {
        c0.fillStyle = 'rgba(255,220,140,.14)';
        c0.beginPath(); c0.ellipse(b.x, b.y, 50, 25, 0, 0, Math.PI * 2); c0.fill();
      }
      const brass = ['#5b4318', '#8a6a26', '#b8943e', '#e2c66e'];
      const shade = night ? ['#d9b45e', '#f0d488', '#fff0b8', '#fffbe0'] : ['#b9a172', '#d6c296', '#ecdcb6', '#faf2d8'];
      this.art(b, (c) => {
        pxDisc(c, 0, 0, 4, 1, this.pal.shadow);
        pxDisc(c, 0, -1, 3, 1, brass[1]);
        c.fillStyle = brass[3]; c.fillRect(-2, -2, 3, 1);
        c.fillStyle = brass[1]; c.fillRect(0, -26, 1, 24);
        c.fillStyle = brass[3]; c.fillRect(0, -15, 1, 1); c.fillRect(-1, -14, 3, 1);
        // the shade: a cone, lit from the left, with a darker rim
        for (let r = 0; r < 7; r++) {
          const half = 2 + Math.floor(r * 0.6);
          for (let i = -half; i <= half; i++) {
            c.fillStyle = rampPick(shade, 1 - Math.abs((i + half) / (half * 2 + 1) - 0.3) * 1.5, i, r);
            c.fillRect(i, -33 + r, 1, 1);
          }
        }
        c.fillStyle = shade[0]; c.fillRect(-6, -26, 13, 1);
        c.fillStyle = brass[0]; c.fillRect(-1, -34, 3, 1);
      });
    }

    vending(x, y, color) {
      const P = (a, b, c) => this.iso(a, b, c);
      const V = (v, z) => P(x + 0.7, y + v, z);
      const dark = this.shade(color, -30);
      this.box(x, y, 0, 0.7, 0.75, 1.85, this.shade(color, 15), this.shade(color, -10), color);
      // brand strip across the top, kick plate at the bottom
      this.poly([V(0, 1.68), V(0.75, 1.68), V(0.75, 1.82), V(0, 1.82)], this.shade(color, 34));
      this.seg(V(0.12, 1.75), V(0.42, 1.75), '#ffffff');
      this.poly([V(0, 0), V(0.75, 0), V(0.75, 0.12), V(0, 0.12)], dark);
      // the window: four shelves of cans behind glass
      this.poly([V(0.06, 0.62), V(0.54, 0.62), V(0.54, 1.62), V(0.06, 1.62)], '#16202a');
      const cols = ['#f2d16b', '#5cf08a', '#ff8a65', '#81d4fa', '#ce93d8'];
      for (let r = 0; r < 4; r++) {
        const z = 1.42 - r * 0.24;
        this.seg(V(0.07, z - 0.03), V(0.53, z - 0.03), '#3b4a58');
        for (let k = 0; k < 4; k++) {
          const col = cols[(r * 3 + k + Math.round(y)) % cols.length];
          this.art(V(0.1 + k * 0.125, z), (c) => {
            c.fillStyle = col; c.fillRect(0, -2, 1, 3);
            c.fillStyle = '#ffffff'; c.fillRect(0, -3, 1, 1);
          });
        }
      }
      this.seg(V(0.1, 1.22), V(0.2, 1.58), 'rgba(255,255,255,.3)');
      // buttons down the side, the tray the can drops into
      this.poly([V(0.58, 0.9), V(0.71, 0.9), V(0.71, 1.55), V(0.58, 1.55)], dark);
      for (let k = 0; k < 4; k++) this.art(V(0.64, 1.45 - k * 0.13), (c) => { c.fillStyle = '#e8edf2'; c.fillRect(0, 0, 1, 1); });
      this.poly([V(0.08, 0.2), V(0.52, 0.2), V(0.52, 0.48), V(0.08, 0.48)], '#11161b');
      this.seg(V(0.08, 0.48), V(0.52, 0.48), '#5a6874');
      // a paler band down the side we see edge-on
      this.poly([P(x + 0.25, y + 0.75, 0.3), P(x + 0.45, y + 0.75, 0.3), P(x + 0.45, y + 0.75, 1.5), P(x + 0.25, y + 0.75, 1.5)], this.shade(color, 6));
    }

    vendingLight(x, y) {
      const on = Math.sin(this.t / 700 + y) > 0;
      this.art(this.iso(x + 0.7, y + 0.64, 0.98), (c) => { c.fillStyle = on ? '#99eeff' : '#44aadd'; c.fillRect(0, -1, 1, 2); });
    }

    foosball(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      for (const [lx, ly] of [[0.1, 0.1], [1.42, 0.1], [0.1, 0.62], [1.42, 0.62]]) this.box(x + lx, y + ly, 0, 0.08, 0.08, 0.6, '#5a4030', '#5a4030', '#4a3428');
      this.box(x, y, 0.6, 1.6, 0.8, 0.25, '#6e533b', '#6e533b', '#5c4431');
      // the pitch inside its wooden rim: halfway line, a goal at each end
      this.poly([P(x + 0.07, y + 0.07, 0.85), P(x + 1.53, y + 0.07, 0.85), P(x + 1.53, y + 0.73, 0.85), P(x + 0.07, y + 0.73, 0.85)], '#2f8a4a', '#246b39');
      this.seg(P(x + 0.8, y + 0.08, 0.85), P(x + 0.8, y + 0.72, 0.85), '#bfe8c8');
      for (const gx of [x + 0.07, x + 1.45]) {
        this.poly([P(gx, y + 0.28, 0.85), P(gx + 0.08, y + 0.28, 0.85), P(gx + 0.08, y + 0.52, 0.85), P(gx, y + 0.52, 0.85)], '#1a2a20');
      }
    }

    // Rods and players, which slide when two cats are at the table.
    foosRods(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const players = this.plan && this.plan.pois.filter((q) => q.pair === 'fb' && q.taken).length === 2;
      for (let k = 0; k < 6; k++) {
        const rx = x + 0.2 + k * 0.24;
        const shift = players ? Math.round(Math.sin(this.t / 120 + k) * 2) * 0.03 : 0;
        this.seg(P(rx, y - 0.15, 0.92), P(rx, y + 0.95, 0.92), '#c8ccd0');
        this.art(P(rx, y + 0.95 + shift, 0.92), (c) => { c.fillStyle = '#2a2a2e'; c.fillRect(-1, -1, 2, 2); });
        for (let m = 0; m < 2; m++) {
          this.art(P(rx, y + 0.25 + m * 0.3 + shift, 0.92), (c) => {
            c.fillStyle = k % 2 ? '#c0392b' : '#2f6fb0'; c.fillRect(-1, -1, 2, 3);
            c.fillStyle = '#f3cfb0'; c.fillRect(-1, -2, 2, 1);
          });
        }
      }
    }

    // ---------------------------------------------------------------- gym

    // Whoever is on a piece of equipment, once they have arrived.
    userOf(q) {
      const p = q && q.taken && this.people.get(q.taken);
      return p && p.poi === q && !p.path.length ? p : null;
    }

    treadmill(x, y, q) {
      const P = (a, b, c) => this.iso(a, b, c);
      const p = this.userOf(q);
      const body = this.pal.dark ? '#3b4048' : '#5b626d';
      const lite = this.tint(body, 26), mid = this.tint(body, 10), low = this.tint(body, -18);
      this.box(x, y, 0, 0.7, 1.5, 0.12, '#24272c', mid, low);
      // The belt only moves under someone, and as fast as their day has been.
      const run = p ? ((this.t / 1000) * (0.5 + tokTier(p.s) * 0.45)) % 0.3 : 0.1;
      for (let v = y + 0.08 + run; v < y + 1.42; v += 0.3) this.seg(P(x + 0.08, v, 0.12), P(x + 0.62, v, 0.12), '#444a53');
      this.seg(P(x + 0.04, y + 0.04, 0.12), P(x + 0.04, y + 1.46, 0.12), mid);
      this.seg(P(x + 0.66, y + 0.04, 0.12), P(x + 0.66, y + 1.46, 0.12), mid);
      // Console at the back on two posts: one lamp per step of today's tokens.
      this.box(x + 0.02, y, 0.12, 0.06, 0.06, 0.9, lite, mid, low);
      this.box(x + 0.62, y, 0.12, 0.06, 0.06, 0.9, lite, mid, low);
      this.box(x, y - 0.02, 0.95, 0.7, 0.1, 0.3, lite, '#1d2024', low);
      const lit = p ? tokTier(p.s) : 0;
      for (let i = 0; i < 5; i++) {
        this.art(P(x + 0.1 + i * 0.125, y + 0.08, 1.14), (c) => {
          c.fillStyle = i < lit ? (i > 2 ? '#ff6a4d' : '#7be08a') : '#3d434b';
          c.fillRect(0, 0, 1, 2);
        });
      }
      this.box(x - 0.02, y + 0.06, 0.8, 0.05, 0.6, 0.05, lite, mid, low);
      this.box(x + 0.67, y + 0.06, 0.8, 0.05, 0.6, 0.05, lite, mid, low);
    }

    // A cat wheel: a wooden drum on a stand. It comes in two halves so the
    // runner is drawn between the back of the drum and its front rim.
    catWheel(cx, y, q, front) {
      const P = (a, b, c) => this.iso(a, b, c);
      const R = 1.05, zc = R + 0.12, TK = 0.36, N = 24;
      const wood = this.pal.dark ? '#a8834f' : '#d9b47a';
      const edge = this.tint(wood, -60);
      const at = (a, yy, r = R) => P(cx + Math.cos(a) * r, yy, zc + Math.sin(a) * r);
      const ring = (yy, r) => Array.from({ length: N }, (_, i) => at((i / N) * Math.PI * 2, yy, r));
      if (front) {
        const o = ring(y + TK, R), n = ring(y + TK, R - 0.1);
        for (let i = 0; i < N; i++) { const j = (i + 1) % N; this.poly([o[i], o[j], n[j], n[i]], this.tint(wood, 18)); }
        this.poly(o, null, edge);
        this.poly(n, null, edge);
        return;
      }
      const p = this.userOf(q);
      // It turns as fast as the runner has had turns today.
      const spin = p ? (this.t / 1000) * (1.2 + turnTier(p.s) * 0.9) : 0;
      this.box(cx - 1.0, y + 0.06, 0, 2.0, 0.24, 0.1, this.tint(wood, -18), this.tint(wood, -32), this.tint(wood, -44));
      this.poly(ring(y, R), this.tint(wood, -34), edge);
      for (let i = 0; i < N; i++) {
        const a0 = spin + (i / N) * Math.PI * 2, a1 = spin + ((i + 1) / N) * Math.PI * 2;
        this.poly([at(a0, y), at(a1, y), at(a1, y + TK), at(a0, y + TK)], i % 2 ? wood : this.tint(wood, -13));
      }
      this.poly(ring(y, R), null, edge);
    }

    liftRack(x, y, q) {
      const P = (a, b, c) => this.iso(a, b, c);
      const p = this.userOf(q);
      const rub = this.pal.dark ? '#262a30' : '#444b54';
      const steel = this.pal.metal;
      const sl = this.tint(steel, 22), sd = this.tint(steel, -24);
      // platform: rubber with a strip of wood down the middle
      this.box(x, y + 0.3, 0, 1.4, 1.0, 0.05, rub, this.tint(rub, -8), this.tint(rub, -18));
      this.poly([P(x + 0.35, y + 0.3, 0.05), P(x + 1.05, y + 0.3, 0.05), P(x + 1.05, y + 1.3, 0.05), P(x + 0.35, y + 1.3, 0.05)], this.pal.deskTop);
      // rack behind it, spare plates on a rail
      this.box(x + 0.12, y, 0, 0.08, 0.08, 1.2, sl, steel, sd);
      this.box(x + 1.2, y, 0, 0.08, 0.08, 1.2, sl, steel, sd);
      this.box(x + 0.12, y + 0.02, 1.12, 1.16, 0.04, 0.06, sl, steel, sd);
      this.box(x + 0.12, y + 0.02, 0.42, 1.16, 0.04, 0.05, sl, steel, sd);
      ['#5f9a4c', '#3b8ee0', '#e0a83a', '#de4b40'].forEach((col, i) => {
        this.art(P(x + 0.34 + i * 0.25, y + 0.08, 0.66), (c) => {
          const r = 2 + (i > 1 ? 1 : 0);
          pxDisc(c, 0, 0, r + 1, r + 1, INK_HEX);
          pxDisc(c, 0, 0, r, r, col);
          c.fillStyle = '#c9ced6'; c.fillRect(0, 0, 1, 1);
        });
      });
      // The bar waits on the platform until someone picks it up.
      if (!p) {
        const a = P(x + 0.15, y + 0.85, 0.16), b = P(x + 1.25, y + 0.85, 0.16);
        this.seg(a, b, INK_HEX, 0, -1); this.seg(a, b, INK_HEX, 0, 1); this.seg(a, b, '#c9ced6');
        for (const e of [a, b]) this.art(e, (c) => { pxDisc(c, 0, 0, 3, 4, INK_HEX); pxDisc(c, 0, 0, 2, 3, '#5f9a4c'); });
      }
    }

    dumbbells(x, y) {
      const st = this.pal.dark ? '#30353c' : '#4a515b';
      this.box(x, y, 0, 1.0, 0.3, 0.28, this.tint(st, 22), st, this.tint(st, -16));
      ['#5f9a4c', '#3b8ee0', '#de4b40'].forEach((col, i) => {
        this.art(this.iso(x + 0.2 + i * 0.3, y + 0.15, 0.28), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-3, -3, 7, 4);
          c.fillStyle = col; c.fillRect(-2, -2, 2, 2); c.fillRect(1, -2, 2, 2);
          c.fillStyle = '#c9ced6'; c.fillRect(0, -1, 1, 1);
        });
      });
    }

    // ---------------------------------------------------------- cat things

    scratchPost(x, y) {
      const P = (a, b, c) => this.iso(a, b, c);
      const rope = this.pal.dark ? '#a58d62' : '#d9c08f';
      const wood = this.pal.deskL;
      this.box(x - 0.28, y - 0.28, 0, 0.56, 0.56, 0.06, this.tint(wood, 14), wood, this.tint(wood, -14));
      this.box(x - 0.09, y - 0.09, 0.06, 0.18, 0.18, 1.05, this.tint(rope, 12), rope, this.tint(rope, -16));
      for (let z = 0.16; z < 1.08; z += 0.12) {
        this.seg(P(x - 0.09, y + 0.09, z), P(x + 0.09, y + 0.09, z), this.tint(rope, -24));
        this.seg(P(x + 0.09, y - 0.09, z), P(x + 0.09, y + 0.09, z), this.tint(rope, -36));
      }
      this.box(x - 0.22, y - 0.22, 1.11, 0.44, 0.44, 0.06, this.tint(wood, 14), wood, this.tint(wood, -14));
      // The longer someone has been kept waiting, the more of it is shredded.
      const n = this.scratch || 0;
      if (n) this.art(P(x, y + 0.09, 0.98), (c) => {
        c.fillStyle = this.tint(rope, -78);
        for (let i = 0; i < n; i++) {
          const yy = i * 3, dx = i % 2;
          c.fillRect(-2 + dx, yy, 1, 1); c.fillRect(-1 + dx, yy + 1, 1, 1); c.fillRect(dx, yy + 2, 1, 1);
        }
      });
    }

    // Open box in two halves, like the wheel: whoever is in it sits between
    // the inside and the front.
    cardboard(x, y, front) {
      const P = (a, b, c) => this.iso(a, b, c);
      const w = 0.8, d = 0.7, h = 0.42;
      const card = this.pal.dark ? '#a8854f' : '#cfa76e';
      if (!front) {
        this.poly([P(x, y), P(x + w, y), P(x + w, y + d), P(x, y + d)], this.tint(card, -52));
        this.poly([P(x, y, 0), P(x + w, y, 0), P(x + w, y, h), P(x, y, h)], this.tint(card, -26));
        this.poly([P(x, y, 0), P(x, y + d, 0), P(x, y + d, h), P(x, y, h)], this.tint(card, -38));
        this.poly([P(x, y, h), P(x + w, y, h), P(x + w, y - 0.2, h + 0.12), P(x, y - 0.2, h + 0.12)], this.tint(card, -8), this.tint(card, -60));
        this.poly([P(x, y, h), P(x, y + d, h), P(x - 0.2, y + d, h + 0.12), P(x - 0.2, y, h + 0.12)], this.tint(card, -18), this.tint(card, -60));
        return;
      }
      this.poly([P(x, y + d, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x, y + d, h)], card);
      this.poly([P(x + w, y, 0), P(x + w, y + d, 0), P(x + w, y + d, h), P(x + w, y, h)], this.tint(card, -15));
      this.poly([P(x + w * 0.42, y + d, 0), P(x + w * 0.58, y + d, 0), P(x + w * 0.58, y + d, h), P(x + w * 0.42, y + d, h)], this.tint(card, 26));
      this.seg(P(x, y + d, h), P(x + w, y + d, h), this.tint(card, 24));
      this.seg(P(x + w, y, h), P(x + w, y + d, h), this.tint(card, 8));
      this.seg(P(x, y + d, 0), P(x + w, y + d, 0), this.tint(card, -40));
      this.seg(P(x + w, y, 0), P(x + w, y + d, 0), this.tint(card, -48));
      this.art(P(x + w * 0.2, y + d, h * 0.5), (c) => {
        c.fillStyle = this.tint(card, -60);
        c.fillRect(0, 0, 2, 2); c.fillRect(-1, -2, 1, 1); c.fillRect(1, -3, 1, 1); c.fillRect(3, -2, 1, 1);
      });
    }

    cushion(x, y) {
      const pal5 = this.rampOf(this.pal.dark ? '#a8733c' : '#eab676');
      const edge = this.tint(pal5[2], -70);
      this.art(this.iso(x, y, 0), (c) => {
        pxLump(c, 0, -2, 9, 4, pal5, edge);
        c.fillStyle = pal5[1];
        c.fillRect(-3, -2, 6, 1);
      });
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
        const felt = pal.dark ? '#2e3946' : '#8497ac';
        for (const u of [0.43, 0.87]) {
          this.seg(P(x + u, y, 0.1), P(x + u, y, H - 0.1), felt);
          this.seg(P(x, y + u, 0.1), P(x, y + u, H - 0.1), felt);
        }
        this.art(P(x + 0.65, y + 0.65, H - 0.05), (c) => { pxDisc(c, 0, 0, 4, 2, '#ffe6a0'); pxDisc(c, 0, 0, 2, 1, '#fff8dc'); });
        this.box(x + 0.08, y + 0.04, 0.85, 0.5, 0.22, 0.04, pal.deskTop, pal.deskL, pal.deskR);
        this.art(P(x + 0.3, y + 0.15, 0.89), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-2, -3, 5, 3);
          c.fillStyle = '#4a4e57'; c.fillRect(-1, -2, 3, 1);
          c.fillStyle = '#7be08a'; c.fillRect(1, -2, 1, 1);
        });
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
      // Things people leave on desks, chosen by where the desk stands so a
      // desk keeps its clutter. A bare desk in a room this detailed looks
      // unfinished; three pixels of mug fix that.
      const h = hash(`${x.toFixed(1)},${y.toFixed(1)}`);
      const P = (a, b, cc) => this.iso(a, b, cc);
      const top = 0.79;
      // key rows on the keyboard
      {
        const ky = y + (dk.side === 's' ? 0.48 : 0.16);
        this.seg(P(x + 0.5, ky + 0.05, top + 0.025), P(x + 0.9, ky + 0.05, top + 0.025), '#b9b9b9');
        this.seg(P(x + 0.5, ky + 0.11, top + 0.025), P(x + 0.9, ky + 0.11, top + 0.025), '#b9b9b9');
      }
      if (h % 3 === 0) {
        // mug, with coffee in it and a handle
        this.art(P(x + 1.18, y + 0.36, top), (c) => {
          c.fillStyle = '#8f8f8f'; c.fillRect(-2, -4, 4, 5);
          c.fillStyle = '#fafafa'; c.fillRect(-1, -4, 3, 4);
          c.fillStyle = '#d5d5d5'; c.fillRect(1, -3, 1, 3);
          c.fillStyle = '#6b3f22'; c.fillRect(-1, -4, 3, 1);
          c.fillStyle = '#8f8f8f'; c.fillRect(2, -2, 1, 1); c.fillRect(3, -3, 1, 2);
        });
      }
      if (h % 5 === 1) {
        // a small plant in a pot
        this.box(x + 0.14, y + 0.24, top, 0.12, 0.12, 0.08, pal.pot, pal.pot, this.shade(pal.pot, -15));
        this.art(P(x + 0.2, y + 0.3, top + 0.08), (c) => {
          pxLump(c, 0, -3, 2, 2, this.rampOf(pal.plant), this.tint(pal.plant, -58));
          c.fillStyle = this.tint(pal.plant, 36); c.fillRect(-1, -6, 1, 1);
        });
      }
      if (h % 4 === 2) {
        // two books, the top one askew
        this.box(x + 0.12, y + 0.45, top, 0.22, 0.15, 0.05, '#f2d16b', '#d9b84f', '#c4a33f');
        this.box(x + 0.15, y + 0.46, top + 0.05, 0.17, 0.12, 0.04, '#c8644f', '#a84f3d', '#93432f');
      }
      if (h % 2 === 0) {
        // a sheet of paper with a few lines on it
        const px0 = x + 0.98, py0 = y + (dk.side === 's' ? 0.52 : 0.1);
        this.poly([P(px0, py0, top), P(px0 + 0.24, py0, top), P(px0 + 0.24, py0 + 0.18, top), P(px0, py0 + 0.18, top)], '#fbfaf3', '#cfcabd');
        this.seg(P(px0 + 0.04, py0 + 0.06, top), P(px0 + 0.2, py0 + 0.06, top), '#a9b4c4');
        this.seg(P(px0 + 0.04, py0 + 0.12, top), P(px0 + 0.16, py0 + 0.12, top), '#a9b4c4');
      }
      if (h % 4 === 1 && dk.side === 's') {
        // a sticky note on the monitor's bezel
        const mx = x + 0.42, my = y + 0.18, mz = top + 0.18;
        this.poly([P(mx + 0.44, my, mz + 0.3), P(mx + 0.56, my, mz + 0.3), P(mx + 0.56, my, mz + 0.42), P(mx + 0.44, my, mz + 0.42)], '#f6dc5c');
        this.seg(P(mx + 0.46, my, mz + 0.37), P(mx + 0.54, my, mz + 0.37), '#b79a2c');
      }
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
          this.seg(a, b, i % 3 === 0 ? col : 'rgba(255,255,255,.6)');
        }
      } else {
        // A glyph in pixels: a font at this size is five smeared pixels.
        const m = P(x + w / 2, y, z + h / 2);
        const glyph = {
          thinking: ['#.#.#'],
          waiting: ['###', '..#', '.##', '...', '.#.'],
          error: ['#', '#', '#', '.', '#'],
        }[st];
        if (glyph) {
          const a = st === 'thinking' ? 0.5 + 0.4 * Math.sin(t * 3 + p.phase) : 0.95;
          this.art(m, (g) => {
            g.globalAlpha = a;
            g.fillStyle = col;
            const gw = glyph[0].length, gh = glyph.length;
            glyph.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(i - (gw >> 1), j - (gh >> 1), 1, 1); });
          });
        }
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
        if (this.sceneArt.workState) return this.sceneArt.workState.call(this, p, face);
        if (p.desk.pose === 'stand') return { pose: 'stand', face, act: 'station', sitZ: 0 };
        return { pose: 'sit', face, act: s.status === 'tool' || s.status === 'typing' ? 'type' : 'think', sitZ: 0.34 };
      }
      if (p.mode === 'door' && p.spot) return { pose: 'stand', face: 'front', act: p.spot.act || 'wave', sitZ: 0 };
      if (p.mode === 'follow') {
        if (s.status === 'waiting' || s.status === 'error') return { pose: 'stand', face: 'front', act: 'wave', sitZ: 0 };
        return { pose: 'sit', face: 'front', act: WORKING.has(s.status) ? 'yarn' : 'nap', sitZ: 0 };
      }
      if (p.mode === 'wander' && p.poi) {
        const q = p.poi;
        // At lunch a seat at a table means a lunch box, and anywhere else a nap.
        const act = this.lunch ? (LUNCH_EAT.has(q.act) ? 'bento' : 'nap') : q.act;
        return { pose: q.sit ? 'sit' : 'stand', face: q.face === 'side' ? 'front' : q.face, act, sitZ: q.sit || q.z || 0 };
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
      const kit = !!s.subagent;
      // On the belt or in the wheel a cat runs on the spot, at its own pace.
      const running = !moving && (st.act === 'treadmill' || st.act === 'wheel');
      const pace = 7 + (st.act === 'treadmill' ? tokTier(s) : turnTier(s)) * 2.5;
      const step = moving ? Math.sin(t * 12 + p.phase) : running ? Math.sin(t * pace + p.phase) : 0;
      const bob = moving || running ? Math.abs(step) * 1.5 : 0;

      const fb = this.iso(p.x, p.y, 0);
      this.art(fb, (g) => {
        pxDisc(g, 0, 0, kit ? 4 : 6, kit ? 1 : 2, this.pal.shadow);
        if (this.hoverKey === p.key) pxRing(g, 0, 0, kit ? 6 : 9, kit ? 3 : 4, STATUS_COLOR[s.status] || '#888');
      });

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
        const lively = moving || running;
        const sway = Math.sin(t * (lively ? 6 : 1.6) + p.phase) * (lively ? 1.6 : 0.8);
        const root = kit ? -2 : seated ? -3 : -5;
        const tn = kit ? 3 : 4;
        for (let i = 0; i < tn; i++) {
          const k = i / (tn - 1);
          const tx = pxFloor((kit ? 3 : 4) + k * (kit ? 2.5 : 4) + sway * k);
          const ty = pxFloor(root - k * (kit ? 4 : 7));
          c.fillStyle = INK; c.fillRect(tx - 1, ty - 1, 4, 4);
          c.fillStyle = i > 1 ? br.belly : fur; c.fillRect(tx, ty, 2, 2);
        }
      }

      const sleepy = s.status === 'idle';
      const napping = st.act === 'nap';
      const blink = Math.sin(t * 0.7 + p.phase * 3) > 0.985;
      // Basking shuts the eyes, and so does a bar that is nearly too heavy.
      const strain = st.act === 'lift' && ctxPct(s) >= 0.85;
      const eyes = (blink || sleepy || napping || strain || SHUT_ACTS.has(st.act)) ? 'shut' : s.status === 'error' ? 'wide' : 'open';
      const sprite = catSprite(br, seated, front, eyes, kit);
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
      switch (kit ? 'kit:' + st.act : st.act) {
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
        case 'lift': {
          // The plates are the session's context: more of it, more of them,
          // green through to red. Near the limit the bar stalls at the chin
          // and trembles, which is the thing worth noticing from across the room.
          const pct = ctxPct(s);
          const n = !(s.context && s.context.used) ? 0 : pct >= 0.75 ? 4 : pct >= 0.5 ? 3 : pct >= 0.25 ? 2 : 1;
          const heavy = pct >= 0.85;
          const cyc = ((t * (heavy ? 0.45 : 0.75 - n * 0.08) + p.phase) % 1 + 1) % 1;
          const up = cyc < 0.3 ? cyc / 0.3 : cyc < 0.55 ? 1 : cyc < 0.8 ? 1 - (cyc - 0.55) / 0.25 : 0;
          const rise = heavy ? Math.min(up, 0.1 + 0.05 * Math.sin(t * 3)) : up;
          const shake = heavy && up > 0.1 && Math.sin(t * 45) > 0 ? 1 : 0;
          const by = pxFloor(top + 3 - rise * 17);
          const half2 = 9 + n * 3;
          c.fillStyle = INK; c.fillRect(-half2 - 1 + shake, by - 1, half2 * 2 + 3, 3);
          c.fillStyle = '#c9ced6'; c.fillRect(-half2 + shake, by, half2 * 2 + 1, 1);
          const col = ['#5f9a4c', '#3b8ee0', '#e0a83a', '#de4b40'][Math.max(0, n - 1)];
          for (let k = 0; k < n; k++) for (const sgn of [-1, 1]) {
            // biggest plate inside, as on a real bar
            const ph = Math.max(2, 1 + n - Math.floor(k / 2));
            const px0 = (sgn > 0 ? 9 + k * 3 : -10 - k * 3) + shake;
            c.fillStyle = INK; c.fillRect(px0 - 1, by - ph - 1, 4, ph * 2 + 3);
            c.fillStyle = col; c.fillRect(px0, by - ph, 2, ph * 2 + 1);
            c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(px0, by - ph, 1, ph * 2 + 1);
          }
          paw(-7 + shake, by + 1); paw(5 + shake, by + 1);
          if (heavy && Math.sin(t * 6) > 0) { c.fillStyle = '#7fc4ff'; c.fillRect(8, -PXH + 3, 1, 2); c.fillRect(-9, -PXH + 5, 1, 2); }
          break;
        }
        case 'treadmill':
        case 'wheel': {
          const k = step > 0 ? 1 : 0;
          paw(-5, -2 - k * 2); paw(3, -2 - (1 - k) * 2);
          break;
        }
        case 'yoga': {
          // paws out, then paws up, slowly
          const up = Math.sin(t * 1.1 + p.phase) > 0;
          if (up) { paw(-8, top - 9); paw(6, top - 9); } else { paw(-10, top - 1); paw(8, top - 1); }
          break;
        }
        case 'scratch': {
          const k = Math.sin(t * 9 + p.phase) > 0 ? 0 : 3;
          paw(-12, top - 5 + k); paw(-10, top - 2 - k);
          break;
        }
        case 'bento': {
          // A lunch box on the lap: rice, egg, greens, something fried. One
          // paw holds it and the other brings a bite up.
          const bite = Math.sin(t * 2.2 + p.phase) > 0.2;
          if (front) {
            c.fillStyle = INK; c.fillRect(-5, top + 3, 10, 5);
            c.fillStyle = '#b8323a'; c.fillRect(-4, top + 4, 8, 3);
            c.fillStyle = '#ffffff'; c.fillRect(-3, top + 4, 3, 2);
            c.fillStyle = '#f2c230'; c.fillRect(0, top + 4, 2, 1);
            c.fillStyle = '#5f9a4c'; c.fillRect(2, top + 4, 1, 2);
            c.fillStyle = '#c96442'; c.fillRect(0, top + 5, 2, 1);
          }
          paw(-7, top + 5);
          paw(5, bite ? top - 1 : top + 3);
          if (bite && front) { c.fillStyle = '#ffffff'; c.fillRect(6, top - 2, 1, 1); }
          break;
        }
        case 'zen': {
          // Sitting still, paws together; what it is gathering drifts up
          // round it in the colour of what it is doing.
          paw(-1, top + 3);
          c.fillStyle = STATUS_COLOR[s.status] || '#9b9a94';
          for (let i = 0; i < 4; i++) {
            const k = (((t * 0.45 + i / 4 + p.phase) % 1) + 1) % 1;
            c.globalAlpha = k < 0.6 ? 0.9 : ((1 - k) / 0.4) * 0.9;
            c.fillRect((i % 2 ? 1 : -1) * (9 + (i > 1 ? 3 : 0)), pxFloor(top + 7 - k * 17), 1, 2);
          }
          c.globalAlpha = 1;
          break;
        }
        case 'kata': {
          // one paw out, then the other
          if (Math.sin(t * 6 + p.phase) > 0) { paw(8, top - 1); paw(-7, top + 3); } else { paw(-10, top - 1); paw(5, top + 3); }
          break;
        }
        case 'brush': {
          // a brush drawn down the paper and lifted again
          const k = (Math.sin(t * 5 + p.phase) + 1) / 2;
          const bx = 5, by = top + 2 + pxFloor(k * 3);
          paw(-8, top + 3);
          paw(bx, by);
          if (front) {
            c.fillStyle = '#d9b27a'; c.fillRect(bx + 1, by + 2, 1, 3);
            c.fillStyle = INK; c.fillRect(bx + 1, by + 5, 1, 2);
          }
          break;
        }
        case 'fall': {
          paw(-1, top + 3);
          break;
        }
        case 'kit:yarn': {
          const k = Math.sin(t * 5 + p.phase) > 0 ? 0 : 1;
          const bx = 7 + k;
          c.fillStyle = INK; c.fillRect(bx - 1, -5, 5, 5);
          c.fillStyle = pick(this.pal.book, p.h, 9); c.fillRect(bx, -4, 3, 3);
          c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(bx, -4, 1, 1);
          paw(3 + k, -4);
          break;
        }
        case 'kit:wave': {
          const w = Math.sin(t * 8 + p.phase) > 0 ? 0 : 2;
          paw(5, -10 - w);
          break;
        }
        default: break;
      }
      c.restore();

      // Back in world units for the name tag and the click target.
      const headTop = y - ((kit ? 14 : PXH) + 1) * ART;
      const half = (kit ? 7 : PXC + 1) * ART;
      this.hit.push({ key: p.key, x0: x - half, x1: x + half, y0: headTop - 4, y1: fb.y + 4 });
      return { x, y: headTop + 6, act: st.act };
    }

    emojiOf(act) {
      return (this.sceneArt.emoji && this.sceneArt.emoji[act]) || ACT_EMOJI[act];
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

      if (p.mode === 'follow' && this.hoverKey !== p.key) {
        // A kitten says what it is doing with one dot; the rest is on hover.
        c.fillStyle = STATUS_COLOR[st] || '#888';
        c.beginPath(); c.arc(x, y - 2, 3, 0, Math.PI * 2); c.fill();
        c.restore();
        return;
      }

      let top = y;
      if ((p.mode === 'work' || p.mode === 'door') && !p.path.length) {
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
        const stat = p.path.length ? null : gymStat(at.act, s);
        if (stat) {
          top = pill(stat.text, '#fff', stat.color, y - 12);
        } else if (justDone) {
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
        } else if (at.act && (this.emojiOf(at.act) || (p.poi && p.poi.emoji)) && !p.path.length) {
          const cycle = (t + p.phase * 3) % 9;
          if (cycle < 2.2) {
            c.globalAlpha = Math.min(1, cycle * 3, (2.2 - cycle) * 3);
            c.font = font(400, 13);
            c.fillText((p.poi && p.poi.emoji) || this.emojiOf(at.act), x, y - 10);
            c.globalAlpha = 1;
            c.font = font(600, 10);
            top = y - 18;
          }
        }
      }

      const hover = this.hoverKey === p.key;
      if (!s.subagent || hover) {
        pill(this.label(s), pal.text, pal.tagBg, top - 11, p.mode === 'work' || p.mode === 'door' || hover ? 1 : 0.7, true);
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

    // The office pet: a small ginger cat on all fours, in profile, so nobody
    // takes it for one of the staff.
    drawCat() {
      const k = this.cat;
      const t = this.t / 1000;
      const now = Date.now();
      const walking = k.path.length > 0;
      const petted = now - k.petAt < PET_GLOW;
      const belly = petted && k.strokes >= PET_BELLY;
      const fur = '#e8913f', stripe = '#c9702a', pale = '#fbe6c8', pink = '#f29aa8';
      const at = this.iso(k.x, k.y, 0);
      // Where to pet it, and what it has to say about that.
      this.hit.push({ key: PET_KEY, x0: at.x - 10 * ART, x1: at.x + 10 * ART, y0: at.y - 15 * ART, y1: at.y + 2 * ART });
      this.catSay = petted ? { at, purr: true, n: k.strokes }
        : this.hoverKey === PET_KEY && !walking ? { at, purr: false } : null;
      this.art(at, (c) => {
        pxDisc(c, 0, 0, belly ? 7 : 5, 1, this.pal.shadow);
        c.save();
        c.scale(k.face, 1);
        const sway = Math.sin(t * (petted ? 12 : 3)) > 0 ? 0 : 1;
        const s = walking && Math.sin(t * 14) > 0 ? 1 : 0;
        const bob = petted && Math.sin(t * 9) > 0 ? 1 : 0;    // leaning into the hand
        const kick = Math.sin(t * 10) > 0 ? 1 : 0;
        // each part is [x, y, w, h, colour]; the outline is every part grown by one
        const parts = belly ? [
          [-9, -2, 3, 1, fur], [-10, -3 - sway, 1, 1, fur],           // tail
          [-6, -6, 10, 5, fur],                                        // body, on its back
          [-5, -9 - kick, 2, 3, fur], [0, -10 + kick, 2, 4, fur],     // paws in the air, kicking in turn
          [3, -8, 5, 6, fur], [3, -9, 1, 1, fur], [7, -9, 1, 1, fur],  // head, ears
        ] : walking ? [
          [-6, -9, 1, 3, fur], [-6 - sway, -10, 1, 1, fur],          // tail up
          [-5, -7, 9, 4, fur],                                        // body
          [-4 - s, -3, 2, 3, fur], [2 + s, -3, 2, 3, fur],            // legs
          [3, -10, 5, 5, fur], [3, -11, 1, 1, fur], [7, -11, 1, 1, fur], // head, ears
        ] : [
          [-6, -1, 3, 1, fur], [-7, -2 - sway, 1, 1, fur],           // tail round the feet
          [-3, -7, 6, 7, fur],                                        // body, sitting
          [1, -12 + bob, 5, 5, fur], [1, -13 + bob, 1, 1, fur], [5, -13 + bob, 1, 1, fur],
        ];
        c.fillStyle = INK_HEX;
        for (const [x, y, w, h] of parts) c.fillRect(x - 1, y - 1, w + 2, h + 2);
        for (const [x, y, w, h, col] of parts) { c.fillStyle = col; c.fillRect(x, y, w, h); }
        const dot = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
        if (belly) {
          dot(-5, -6, 8, 3, pale);                                    // the belly
          dot(-5, -9 - kick, 2, 1, pink); dot(0, -10 + kick, 2, 1, pink); // pads
          dot(-4, -3, 1, 2, stripe); dot(-1, -3, 1, 2, stripe); dot(2, -3, 1, 2, stripe);
          dot(4, -6, 2, 1, INK_HEX);                                  // eye shut
          dot(6, -4, 2, 1, pale); dot(7, -5, 1, 1, pink);
        } else if (walking) {
          dot(-3, -7, 1, 2, stripe); dot(-1, -7, 1, 2, stripe); dot(1, -7, 1, 2, stripe);
          dot(-4, -4, 7, 1, pale); dot(6, -7, 2, 1, pale);
          dot(6, -9, 1, 1, INK_HEX); dot(7, -8, 1, 1, pink);
        } else {
          dot(-2, -7, 1, 2, stripe); dot(0, -7, 1, 1, stripe);
          dot(0, -5, 3, 3, pale); dot(1, -1, 2, 1, pale); dot(4, -9 + bob, 2, 1, pale);
          if (petted) dot(3, -11 + bob, 2, 1, INK_HEX);               // eye shut
          else dot(4, -11, 1, 1, INK_HEX);
          dot(5, -10 + bob, 1, 1, pink);
        }
        c.restore();
        // One heart a stroke, drifting up and out.
        for (const h of k.hearts) {
          const a = (this.t - h.at) / 1200;
          if (a < 0 || a >= 1) continue;
          const hx = Math.round(h.dx + Math.sin(a * 7 + h.dx) * 2) - 2, hy = Math.round(-18 - a * 14);
          c.globalAlpha = a < 0.6 ? 1 : (1 - a) / 0.4;
          c.fillStyle = '#ff5c7a';
          for (const [x, y] of PET_HEART) c.fillRect(hx + x, hy + y, 1, 1);
          c.fillStyle = '#ffd0da';
          c.fillRect(hx + 1, hy + 1, 1, 1);
        }
        c.globalAlpha = 1;
      });
      k.hearts = k.hearts.filter((h) => this.t - h.at < 1200);
    }

    // What the cat says, under its feet so the hearts have the air above.
    catBubble(at, say) {
      const c = this.ctx, pal = this.pal;
      const lab = this.petLabel || {};
      const text = say.purr ? (lab.purr || 'purr purr') + ' ×' + say.n : lab.meow || 'Meow?';
      c.save();
      c.font = '600 10px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const w = c.measureText(text).width + 12;
      // purring makes the words tremble
      const jig = say.purr ? Math.round(Math.sin(this.t / 45)) : 0;
      const y = at.y + 14;
      this.roundRect(at.x - w / 2 + jig, y - 8, w, 16, 8, say.purr ? '#ff6b8a' : pal.bubble);
      c.fillStyle = say.purr ? '#ffffff' : pal.bubbleInk;
      c.fillText(text, at.x + jig, y + 0.5);
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

    // Lunch: the lights are off. Everything already drawn is dimmed, then
    // light is added back where there still is some: daylight at the
    // windows, and a pool of screen light round anyone who is still working.
    lightsOut(occupant) {
      const c = this.ctx;
      const P = (x, y, z) => this.iso(x, y, z);
      c.save();
      // source-atop dims only what has been drawn; outside the room the
      // buffer is clear and stays clear.
      c.globalCompositeOperation = 'source-atop';
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = this.pal.dark ? 'rgba(3,5,14,.58)' : 'rgba(12,16,40,.58)';
      c.fillRect(0, 0, this.buf.width, this.buf.height);
      c.restore();

      c.save();
      c.globalCompositeOperation = 'lighter';
      if (!skyColor().night) {
        for (const x of this.plan.windows) {
          this.poly([P(x, 0, 0.85), P(x + 1.5, 0, 0.85), P(x + 1.5, 0, 2.0), P(x, 0, 2.0)], 'rgba(110,140,180,.38)');
          this.poly([P(x, 0.05), P(x + 1.5, 0.05), P(x + 2.05, 1.5), P(x + 0.55, 1.5)], 'rgba(255,240,205,.11)');
        }
      }
      for (const [dk, p] of occupant) {
        if (p.mode !== 'work' || p.path.length) continue;
        // between the screen and the face it lights
        this.art(P((dk.x + 0.7 + dk.seat.x) / 2, (dk.y + 0.4 + dk.seat.y) / 2, 0.75), (g) => {
          pxDisc(g, 0, 0, 24, 13, 'rgba(110,150,255,.08)');
          pxDisc(g, 0, 0, 17, 9, 'rgba(130,170,255,.09)');
          pxDisc(g, 0, 0, 10, 6, 'rgba(170,205,255,.10)');
          pxDisc(g, 0, 0, 5, 3, 'rgba(220,235,255,.08)');
        });
      }
      c.restore();
    }

    // Advance people and the cat; shared by the 2D and 3D renderers.
    step(dt) {
      const wall = Date.now();
      const lunch = this.isLunch();
      if (lunch !== this.lunch) {
        this.lunch = lunch;
        // The bell: everyone off duty gets up at once, to lunch or back from it.
        for (const p of this.people.values()) if (p.mode === 'wander') { this.release(p); p.until = 0; }
      }
      for (const [k, p] of this.people) {
        if (p.mode === 'follow') this.follow(p);
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
      this.bakedThisFrame = 0;
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
        items.push({ depth: dk.x + 0.7 + dk.y + 0.4, live: true, draw: () => this.desk(dk, p) });
        items.push({ depth: dk.seat.x + dk.seat.y - 0.06, live: true, draw: () => this.chair(dk, p) });
      }
      for (const p of this.people.values()) items.push({ depth: p.x + p.y + 0.01, person: p });
      items.push({ depth: this.cat.x + this.cat.y, live: true, draw: () => this.drawCat() });
      items.sort((a, b) => a.depth - b.depth);

      this.hit = [];
      const heads = [];
      for (const it of items) {
        if (it.person) heads.push([it.person, this.person(it.person)]);
        else this.drawItem(it);
      }
      this.pingPongBall();
      if (this.lunch) this.lightsOut(occupant);

      // Blow the buffer back up with nearest-neighbour: this is the step that
      // turns the whole scene into pixels, not just the cats.
      const v = this.vctx;
      v.setTransform(1, 0, 0, 1, 0, 0);
      v.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const kd = S * this.dpr;
      const dw = this.buf.width * kd, dh = this.buf.height * kd;
      if (!this.compact || Math.abs(kd - Math.round(kd)) < 0.01) {
        v.imageSmoothingEnabled = false;
        v.drawImage(this.buf, 0, 0, dw, dh);
      } else if (kd < 1) {
        // Smaller than the art: there are fewer screen pixels than art
        // pixels, so they have to be averaged.
        v.imageSmoothingEnabled = true;
        v.imageSmoothingQuality = 'high';
        v.drawImage(this.buf, 0, 0, dw, dh);
      } else {
        // In between two whole sizes. Nearest-neighbour would make some art
        // pixels two screen pixels wide and their neighbours three, and a
        // straight line wobbles. So: enlarge to the next whole size with hard
        // edges, then bring that down smoothly. Every art pixel comes out the
        // same width, with one soft screen pixel at its edge.
        const n = Math.ceil(kd);
        const up = this.upCanvas || (this.upCanvas = document.createElement('canvas'));
        const uw = this.buf.width * n, uh = this.buf.height * n;
        if (up.width !== uw || up.height !== uh) { up.width = uw; up.height = uh; }
        const u = up.getContext('2d');
        u.imageSmoothingEnabled = false;
        u.clearRect(0, 0, uw, uh);
        u.drawImage(this.buf, 0, 0, uw, uh);
        v.imageSmoothingEnabled = true;
        v.imageSmoothingQuality = 'high';
        v.drawImage(up, 0, 0, dw, dh);
      }

      // Name tags and the off-duty line go on at full resolution, after the
      // scale-up: run through the pixel buffer their text turns to mush.
      const buffered = this.ctx;
      this.ctx = v;
      v.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const toScreen = (at) => ({
        ...at, x: at.x * this.cam.zoom + this.cam.ox, y: at.y * this.cam.zoom + this.cam.oy,
      });
      for (const [p, at] of heads) this.bubble(p, toScreen(at));
      if (this.catSay) this.catBubble(toScreen(this.catSay.at), this.catSay);
      if (this.lunch) {
        v.font = '600 11px ui-sans-serif, system-ui, -apple-system, "PingFang TC", sans-serif';
        v.textAlign = 'left';
        v.textBaseline = 'alphabetic';
        v.fillStyle = this.pal.text;
        v.globalAlpha = 0.8;
        v.fillText('🍱 ' + (this.lunchLabel || 'Lunch break'), 12, 20);
        v.globalAlpha = 1;
      }
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

  // ------------------------------------------------------------ scenes
  // A scene is another place for the same cats. It may give:
  //   palette     colours laid over the office palette, light and dark
  //   emoji       what an activity is called here
  //   buildPlan   its own floor plan, returning what the office's returns
  //   paintFloor  its own floors, to go with that plan
  //   sceneWalls  painted over the plain walls
  //   workState   what a cat at its place is doing, in place of typing
  //   any Office method by name (desk, chair, wallDoor, …) to draw in its place
  const SCENE_ART = {
    // A training hall. Nobody works here: they practise. Each cat has a
    // cushion and a low desk in the hall; thinking is sitting still, running
    // a tool is drilling, writing a reply is brushwork. Beside the hall is a
    // garden with a pond and a fall, and in front a yard, the way in, and a
    // room for tea.
    dojo: {
      palette: {
        light: {
          wood1: '#c79d68', wood2: '#bf945e', woodLine: 'rgba(90,60,30,.14)',
          tileA: '#bdb6a6', tileB: '#b0a998', carpet: '#cdc68c', carpetLine: 'rgba(0,0,0,.04)',
          wallL: '#f1e9d6', wallR: '#e5dcc6', wallTop: '#6a4a36', trim: '#5b4030',
          deskTop: '#7d563a', deskL: '#63432c', deskR: '#523623',
          monitor: '#3a2a1e', screenOff: '#2e2824', chair: '#8f2f2f',
          rug: '#cdc68c', rugEdge: '#3f5a45', couch: '#3f4f7a', couchD: '#33416a',
          counter: '#8a6748', counterL: '#6e5038', counterR: '#5d4330', metal: '#6b6f73',
          glass: 'rgba(250,240,215,.34)', glassEdge: '#5b4030', mat: '#b9c08c',
          pot: '#39536b',
        },
        dark: {
          wood1: '#4d3a28', wood2: '#473524', woodLine: 'rgba(0,0,0,.24)',
          tileA: '#3f3d38', tileB: '#373530', carpet: '#4a4a30', carpetLine: 'rgba(255,255,255,.04)',
          wallL: '#4b463c', wallR: '#403b33', wallTop: '#2a1e16', trim: '#2a1e16',
          deskTop: '#5a3d29', deskL: '#47301f', deskR: '#3a2719',
          monitor: '#1c1512', screenOff: '#26221f', chair: '#6a2424',
          rug: '#4a4a30', rugEdge: '#263a2c', couch: '#33406a', couchD: '#293458',
          counter: '#5d4531', counterL: '#4a3626', counterR: '#3e2d20', metal: '#55595d',
          glass: 'rgba(200,190,165,.22)', glassEdge: '#2a1e16', mat: '#4a5236',
          pot: '#2b3f52',
        },
      },
      emoji: { arcade: '🥋', vending: '🍶', foosball: '⚫', whiteboard: '🙏', meeting: '🍵', fridge: '🍡', beanbag: '💤' },

      buildPlan(nWorking) {
        const COLS = 4;
        const rows = Math.max(2, Math.ceil((nWorking + 2) / COLS));
        const HW = 10.2;                          // the hall
        const HD = 2.6 + (rows - 1) * 2.0 + 1.6;
        const GW = 6.6;                           // beside it: garden, then tea room
        const W = HW + GW, D = HD + 4.4;          // in front of it: the way in, the yard
        const GD = D - 4.6;
        const GX = 3.5;
        const grid = new Grid(W, D);
        const items = [], pois = [], desks = [];
        const add = (depth, draw, live = false, state = null) => items.push({ depth, draw, live, state });
        const solid = (x, y, w, d, pad) => grid.block(x, y, w, d, pad);
        const poi = (x, y, act, face, opt = {}) => { pois.push({ x, y, act, face, sit: 0, ...opt }); return pois[pois.length - 1]; };

        // ---- the hall: rows of places, all facing the room
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < COLS; k++) {
            const x = 1.0 + k * 2.2, y = 2.6 + r * 2.0;
            desks.push({ x, y, side: 'n', seat: { x: x + 0.7, y: y - 0.45 } });
            solid(x + 0.25, y - 0.1, 0.9, 0.42, 0.04);
          }
        }
        // the head of the hall: a drum, the alcove, a rack of wooden swords
        add(0.5 + 0.38 + 0.52, () => this.taiko(0.5, 0.25));
        solid(0.5, 0.25, 0.75, 0.55);
        const rx = HW - 1.3;
        add(rx + 0.35 + 0.5, () => this.serverRack(rx, 0.2));
        solid(rx, 0.2, 0.7, 0.6);
        const kamiza = HW / 2;
        poi(kamiza - 0.1, 0.75, 'whiteboard', 'back');
        const windows = [2.4, 6.8];
        for (const x of windows) poi(x + 0.75, 0.75, 'window', 'back');
        add(0.45 + HD - 0.45, () => this.plant(0.45, HD - 0.45), true);
        solid(0.25, HD - 0.65, 0.4, 0.4);

        // ---- the garden: a veranda, a fall, a pond, a wheel in the stream
        const fx = HW + 4.0;
        const stone = { x0: fx - 0.6, x1: fx + 0.6, y0: 1.4, y1: 2.2 };
        const pond = { x0: HW + 2.3, x1: W - 0.5, y0: 2.45, y1: GD - 1.5 };
        add(fx + 0.1 + 0.75, () => this.fallRock(fx - 0.7, 0.1));
        solid(fx - 0.7, 0.1, 1.6, 1.3, 0.03);
        poi(fx, 1.62, 'fall', 'front', { emoji: '💧' });
        add(fx + 1.62 + 0.06, () => this.fallWater(fx, 1.62), true);
        solid(pond.x0, pond.y0, pond.x1 - pond.x0, pond.y1 - pond.y0, 0.05);
        for (const sy of [1.5, 3.3]) {
          const sx = HW + 0.45;
          add(sx + sy - 0.3, () => this.cushion(sx, sy));
          poi(sx, sy, 'sun', 'front', { sit: 0.06, sleepy: true });
        }
        poi(HW + 1.7, 3.5, 'window', 'front', { emoji: '🐟' });
        {
          const cx = HW + 2.25, wy = GD - 0.9;
          const q = poi(cx, wy + 0.18, 'wheel', 'front', { z: 0.14 });
          add(cx + wy - 0.02, () => this.catWheel(cx, wy, q, false), () => !!this.userOf(q));
          add(cx + wy + 0.6, () => this.catWheel(cx, wy, q, true));
          solid(cx - 1.05, wy, 2.1, 0.36, 0.05);
        }
        add(W - 0.9 + 1.75, () => this.lantern(W - 0.9, 1.75));
        solid(W - 1.15, 1.5, 0.5, 0.5, 0.02);
        for (const [bx, by] of [[W - 0.6, 0.5], [HW + 1.5, 0.45]]) {
          add(bx + by, () => this.bamboo(bx, by));
          solid(bx - 0.3, by - 0.25, 0.6, 0.5, 0.02);
        }

        // ---- paper screens: between garden and tea room, and down its side
        for (let x = HW + 3.6; x < W - 0.01; x += 1) this.glassY(add, x, GD, Math.min(1, W - x));
        solid(HW + 3.6, GD - 0.05, W - HW - 3.6, 0.1, 0.05);
        for (let y = GD + 1.2; y < D - 0.01; y += 1) this.glassX(add, HW, y, Math.min(1, D - y));
        solid(HW - 0.05, GD + 1.2, 0.1, D - GD - 1.2, 0.05);

        // ---- the tea room: a hearth with a kettle, a cushion on each side
        {
          const hx = HW + 2.6, hy = GD + 1.6;
          add(hx + 0.7 + hy + 0.7, () => this.hearth(hx, hy), true);
          solid(hx, hy, 1.4, 1.4, 0.03);
          const seats = [[hx + 0.7, hy - 0.4, 'front'], [hx + 0.7, hy + 1.8, 'back'], [hx - 0.4, hy + 0.7, 'front'], [hx + 1.8, hy + 0.7, 'front']];
          seats.forEach(([sx, sy, face], i) => {
            add(sx + sy - 0.3, () => this.zabuton(sx, sy, i % 2 ? this.pal.couch : this.pal.chair));
            poi(sx, sy, 'meeting', face, { sit: 0.06 });
          });
        }
        add(W - 2.2 + 0.25 + GD + 0.5, () => this.waterCooler(W - 2.2, GD + 0.25));
        solid(W - 2.3, GD + 0.2, 0.6, 0.5, 0.02);
        poi(W - 1.95, GD + 1.05, 'water', 'back');
        add(W - 1.0 + 0.42 + GD + 0.2 + 0.4, () => this.fridge(W - 1.0, GD + 0.2));
        solid(W - 1.0, GD + 0.2, 0.85, 0.75);
        poi(W - 0.6, GD + 1.45, 'fridge', 'back');
        for (const [bx, by, col] of [[HW + 0.9, D - 0.9, '#8f2f2f'], [W - 1.0, D - 0.8, '#3f4f7a']]) {
          add(bx + by, () => this.beanbag(bx, by, col));
          poi(bx, by, 'beanbag', 'front', { sit: 0.18 });
        }
        {
          const bx = W - 1.2, by = GD + 2.3;
          add(bx + by + 0.2, () => this.cardboard(bx, by, false));
          add(bx + by + 1.3, () => this.cardboard(bx, by, true));
          solid(bx, by, 0.8, 0.7, 0.02);
          poi(bx + 0.4, by + 0.38, 'box', 'front', { sit: 0.02, sleepy: true });
        }

        // ---- the yard: a dummy, the bar, a log to run on, a board game
        {
          const ax = GX + 0.5, ay = HD + 0.4;
          add(ax + 0.35 + ay + 0.35, () => this.arcade(ax, ay));
          solid(ax + 0.1, ay + 0.1, 0.5, 0.5, 0.02);
          poi(ax + 0.35, ay + 1.15, 'arcade', 'back');
        }
        {
          const lx = GX + 2.1, ly = HD + 0.5;
          const q = poi(lx + 0.7, ly + 0.8, 'lift', 'front', { z: 0.05 });
          add(lx + 0.7 + ly + 0.1, () => this.liftRack(lx, ly, q), () => !!this.userOf(q));
          solid(lx + 0.1, ly, 1.2, 0.15, 0.03);
        }
        {
          const tx = GX + 4.4, ty = HD + 0.5;
          const q = poi(tx + 0.35, ty + 0.85, 'treadmill', 'front', { z: 0.34 });
          add(tx + 0.35 + ty + 0.6, () => this.treadmill(tx, ty, q), () => !!this.userOf(q));
          solid(tx, ty, 0.7, 1.5, 0.05);
        }
        add(GX + 5.45 + 0.5 + HD + 2.4, () => this.dumbbells(GX + 5.45, HD + 2.4));
        solid(GX + 5.45, HD + 2.4, 1.0, 0.3, 0.04);
        {
          const gx = GX + 4.2, gy = D - 1.3;
          add(gx + 0.8 + gy + 0.4, () => this.foosball(gx, gy));
          solid(gx + 0.25, gy + 0.12, 1.1, 0.56, 0.04);
          poi(gx - 0.2, gy + 0.4, 'foosball', 'side', { pair: 'fb' });
          poi(gx + 1.8, gy + 0.4, 'foosball', 'side', { pair: 'fb' });
        }
        const mats = [
          { x: GX + 0.4, y: D - 1.6, w: 1.3, d: 0.6 },
          { x: GX + 2.0, y: D - 1.6, w: 1.3, d: 0.6 },
        ];
        for (const mt of mats) poi(mt.x + mt.w / 2, mt.y + mt.d / 2, 'yoga', 'front');

        // ---- the way in: whoever is waiting for the user stands here
        const dy = D - 1.2;
        const wait = {
          x0: 0.95, x1: 3.3, y0: dy - 0.8, y1: dy + 1.0,
          spots: [{ x: 1.4, y: dy - 1.45, act: 'scratch' }],
        };
        for (const yy of [dy + 0.5, dy - 0.35]) for (const xx of [1.45, 2.2, 2.95]) wait.spots.push({ x: xx, y: yy });
        add(0.45 + dy - 1.35 + 0.1, () => this.scratchPost(0.45, dy - 1.35), false, () => this.scratch || 0);
        solid(0.2, dy - 1.6, 0.5, 0.5, 0.03);
        add(0.5 + HD + 0.55, () => this.vending(0.12, HD + 0.15, '#b8323a'));
        solid(0.1, HD + 0.15, 0.75, 0.75);
        poi(1.3, HD + 0.55, 'vending', 'back');

        const posters = [{ y: 2.2, w: 3.8, color: '#f2c230', ink: '#3b2a12', text: 'WANIN' }];
        return {
          W, D, OW: HW, OD: HD, MR: GD, PY: GD, RW: GW, HW, HD, GD, GX,
          grid, items, props: [], pois, desks, windows, posters, pp: null, gym: null, mats, wait,
          door: { x: 0.4, y: D - 1.2 }, seatZ: 0.06, kamiza, pond, stone,
        };
      },

      paintFloor({ P, dot, STEP, planks }) {
        const pal = this.pal, { W, D, HW, HD, GD, GX, mats, pond, stone } = this.plan;
        const rect = (x0, y0, x1, y1, fill, stroke) => this.poly([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], fill, stroke);
        const fleck = (x0, y0, x1, y1, lt, dk, a, b, n) => {
          let i = 0;
          for (let y = y0 + STEP / 2; y < y1; y += STEP, i++) {
            let j = 0;
            for (let x = x0 + STEP / 2; x < x1; x += STEP, j++) {
              const k = (i * a + j * b) % n;
              if (k === 0) dot(P(x, y), lt); else if (k === (n >> 1)) dot(P(x, y), dk);
            }
          }
        };
        // mats two tiles by one, laid like bricks, each with its cloth border
        const tatami = (x0, x1, y0, y1) => {
          const base = pal.carpet, alt = this.tint(base, pal.dark ? 5 : -6);
          const edge = pal.rugEdge, weave = this.tint(base, pal.dark ? -8 : -12);
          let row = 0;
          for (let y = y0; y < y1 - 1e-6; y += 1, row++) {
            const yb = Math.min(y1, y + 1);
            let col = 0;
            for (let x = x0 - (row % 2); x < x1; x += 2, col++) {
              const xa = Math.max(x0, x), xb = Math.min(x1, x + 2);
              if (xb - xa < 0.05) continue;
              this.poly([P(xa, y), P(xb, y), P(xb, yb), P(xa, yb)], (col + row) % 2 ? base : alt);
              for (let v = y + STEP * 2; v < yb - STEP; v += STEP * 3) this.seg(P(xa + 0.06, v), P(xb - 0.06, v), weave);
              this.seg(P(xa, y), P(xa, yb), edge);
              this.seg(P(xa, y), P(xb, y), edge);
            }
          }
          rect(x0, y0, x1, y1, null, edge);
        };

        // the hall: boards, and a field of mats under the rows
        planks(0, HW, 0, HD, 17);
        tatami(0.7, HW - 0.7, 1.7, HD - 0.5);

        // the way in: stone flags
        for (let i = 0; i < Math.ceil(GX * 2); i++) {
          for (let j = 0; j < Math.ceil((D - HD) * 2); j++) {
            const x = i / 2, y = HD + j / 2;
            const x1 = Math.min(GX, x + 0.5), y1 = Math.min(D, y + 0.5);
            const base = (i + j) % 2 ? pal.tileA : pal.tileB;
            rect(x, y, x1, y1, base);
            this.seg(P(x, y), P(x1, y), this.tint(base, 10), 0, 1);
            this.seg(P(x, y1), P(x1, y1), this.tint(pal.tileB, -16));
            this.seg(P(x1, y), P(x1, y1), this.tint(pal.tileB, -16));
          }
        }

        // the yard: packed earth, and two mats to drill on
        const earth = pal.dark ? '#4a4032' : '#d2ba92';
        rect(GX, HD, HW, D, earth);
        fleck(GX, HD, HW, D, this.tint(earth, 10), this.tint(earth, -14), 5, 11, 23);
        rect(GX, HD, HW, D, null, this.tint(earth, pal.dark ? 16 : -26));
        const cloth = pal.dark ? ['#33406a', '#6a2424'] : ['#3f4f7a', '#8f2f2f'];
        mats.forEach((mt, i) => {
          const col = cloth[i % 2];
          rect(mt.x, mt.y, mt.x + mt.w, mt.y + mt.d, col, this.tint(col, -40));
          this.seg(P(mt.x + 0.08, mt.y + 0.1), P(mt.x + mt.w - 0.08, mt.y + 0.1), this.tint(col, 26));
        });

        // the tea room
        tatami(HW, W, GD, D);

        // the garden: moss, the veranda's boards, gravel round the water
        const moss = pal.dark ? '#34452c' : '#93b06c';
        rect(HW, 0, W, GD, moss);
        fleck(HW, 0, W, GD, this.tint(moss, 12), this.tint(moss, -14), 5, 11, 19);
        planks(HW, HW + 0.9, 0, GD, 91);
        const gravel = pal.dark ? '#55554f' : '#dbd6c6';
        rect(pond.x0 - 0.45, 1.35, pond.x1 + 0.3, pond.y1 + 0.4, gravel);
        fleck(pond.x0 - 0.45, 1.35, pond.x1 + 0.3, pond.y1 + 0.4, this.tint(gravel, 10), this.tint(gravel, -18), 3, 7, 11);
        const rim = pal.dark ? '#44443f' : '#8e8e86';
        for (let k = 0; k < 3; k++) {
          const sx = HW + 1.05 + k * 0.42, sy = 1.6 + (k % 2) * 0.16;
          rect(sx, sy, sx + 0.34, sy + 0.4, rim, this.tint(rim, -26));
        }
        rect(stone.x0, stone.y0, stone.x1, stone.y1, rim, this.tint(rim, -26));
        this.seg(P(stone.x0, stone.y0), P(stone.x1, stone.y0), this.tint(rim, 18), 0, 1);

        // the pond, with its corners cut, and two fish in it
        const water = pal.dark ? '#27465c' : '#7fc0da';
        const oct = (x0, y0, x1, y1, k) => [P(x0 + k, y0), P(x1 - k, y0), P(x1, y0 + k), P(x1, y1 - k), P(x1 - k, y1), P(x0 + k, y1), P(x0, y1 - k), P(x0, y0 + k)];
        this.poly(oct(pond.x0 - 0.12, pond.y0 - 0.12, pond.x1 + 0.12, pond.y1 + 0.12, 0.62), rim);
        this.poly(oct(pond.x0, pond.y0, pond.x1, pond.y1, 0.55), water, this.tint(water, -30));
        this.poly(oct(pond.x0 + 0.45, pond.y0 + 0.4, pond.x1 - 0.45, pond.y1 - 0.4, 0.4), this.tint(water, -10));
        const lit = this.tint(water, 30);
        for (const [u, v, w] of [[0.8, 0.35, 0.5], [2.0, 0.7, 0.7], [1.2, 1.3, 0.4], [2.6, 1.5, 0.5]]) {
          this.seg(P(pond.x0 + u, pond.y0 + v), P(pond.x0 + u + w, pond.y0 + v), lit);
        }
        for (const [u, v, col] of [[1.3, 0.8, '#f08a3c'], [2.5, 1.2, '#f4f1ea']]) {
          this.art(P(pond.x0 + u, pond.y0 + v), (c) => {
            c.fillStyle = col; c.fillRect(-2, 0, 5, 2); c.fillRect(3, -1, 1, 1); c.fillRect(3, 2, 1, 1);
            c.fillStyle = '#de4b40'; c.fillRect(-1, 0, 2, 1);
          });
        }
      },

      // Posts and a head rail: the frame a plaster wall hangs in.
      sceneWalls({ P }) {
        const pal = this.pal, { W, D } = this.plan;
        const post = pal.trim, lit = this.tint(post, pal.dark ? 14 : 18);
        for (let u = 0; u < W - 0.2; u += 2.2) {
          this.poly([P(u, 0, 0.12), P(u + 0.12, 0, 0.12), P(u + 0.12, 0, WALL_H), P(u, 0, WALL_H)], post);
          this.seg(P(u, 0, 0.12), P(u, 0, WALL_H), lit);
        }
        for (let v = 0.9; v < D - 0.2; v += 2.4) {
          this.poly([P(0, v, 0.12), P(0, v + 0.12, 0.12), P(0, v + 0.12, WALL_H), P(0, v, WALL_H)], post);
          this.seg(P(0, v + 0.12, 0.12), P(0, v + 0.12, WALL_H), lit);
        }
        this.poly([P(0, 0, 2.08), P(W, 0, 2.08), P(W, 0, 2.2), P(0, 0, 2.2)], post);
        this.poly([P(0, 0, 2.08), P(0, D, 2.08), P(0, D, 2.2), P(0, 0, 2.2)], post);
        this.seg(P(0, 0, 2.2), P(W, 0, 2.2), lit);
        this.seg(P(0, 0, 2.2), P(0, D, 2.2), lit);
      },

      // The alcove at the head of the hall: a hanging scroll and a vase.
      wallBoard() {
        const { pal, B, edge } = this.wallKit();
        const k = this.plan.kamiza;
        const a0 = k - 1.2, a1 = k + 1.2;
        this.poly([B(a0, 0.12), B(a1, 0.12), B(a1, 2.05), B(a0, 2.05)], this.tint(pal.wallL, pal.dark ? -10 : -12), edge);
        this.poly([B(a0, 0.12), B(a1, 0.12), B(a1, 0.3), B(a0, 0.3)], pal.deskTop, edge);
        const S = (u, z) => B(k - 0.75 + u, z);
        const paper = pal.dark ? '#cfc6ac' : '#f6f0de';
        this.poly([S(0, 0.5), S(1.1, 0.5), S(1.1, 1.95), S(0, 1.95)], pal.dark ? '#4c5a40' : '#6d7f5c', edge);
        this.poly([S(0.12, 0.68), S(0.98, 0.68), S(0.98, 1.8), S(0.12, 1.8)], paper);
        this.poly([S(-0.05, 0.44), S(1.15, 0.44), S(1.15, 0.5), S(-0.05, 0.5)], pal.trim);
        this.poly([S(-0.05, 1.95), S(1.15, 1.95), S(1.15, 2.0), S(-0.05, 2.0)], pal.trim);
        // one brushed ring, open at the top right, and a seal
        this.art(S(0.55, 1.26), (c) => {
          pxRing(c, 0, 0, 5, 5, INK_HEX);
          pxRing(c, 0, 1, 5, 4, INK_HEX);
          c.fillStyle = paper; c.fillRect(3, -6, 3, 3);
          c.fillStyle = '#b8323a'; c.fillRect(4, 6, 2, 2);
        });
        this.art(B(k + 0.8, 0.3), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-3, -7, 6, 7);
          c.fillStyle = '#39536b'; c.fillRect(-2, -6, 4, 5);
          c.fillStyle = '#5f9a4c'; c.fillRect(0, -12, 1, 5); c.fillRect(-2, -11, 2, 1); c.fillRect(1, -13, 2, 1);
          c.fillStyle = '#f29aa8'; c.fillRect(-3, -12, 1, 1); c.fillRect(3, -14, 1, 1);
        });
      },
      wallSign() {},

      // A sliding paper door with a shop curtain over it, a step stone below.
      wallDoor() {
        const { pal, P, L, edge } = this.wallKit();
        const dy = this.plan.door.y;
        const paper = pal.dark ? '#b9ae93' : '#f6efdc';
        this.poly([L(dy - 0.66, 0), L(dy + 0.66, 0), L(dy + 0.66, 1.86), L(dy - 0.66, 1.86)], pal.trim, edge);
        this.poly([L(dy - 0.56, 0.5), L(dy + 0.56, 0.5), L(dy + 0.56, 1.76), L(dy - 0.56, 1.76)], paper);
        this.poly([L(dy - 0.56, 0.06), L(dy + 0.56, 0.06), L(dy + 0.56, 0.5), L(dy - 0.56, 0.5)], this.tint(pal.trim, pal.dark ? 14 : 20));
        for (const v of [-0.28, 0, 0.28]) this.seg(L(dy + v, 0.5), L(dy + v, 1.76), pal.trim);
        for (const z of [0.82, 1.14, 1.46]) this.seg(L(dy - 0.56, z), L(dy + 0.56, z), pal.trim);
        this.poly([L(dy - 0.2, 0.04), L(dy + 0.2, 0.04), L(dy + 0.2, 0.42), L(dy - 0.2, 0.42)], '#2a2420', pal.trim);
        const cloth = pal.dark ? '#263c64' : '#2f4a7a';
        for (let k = 0; k < 3; k++) {
          const a = dy - 0.62 + k * 0.42;
          this.poly([L(a, 1.48), L(a + 0.4, 1.48), L(a + 0.4, 2.02), L(a, 2.02)], cloth, this.tint(cloth, -30));
          this.art(L(a + 0.2, 1.78), (c) => pxDisc(c, 0, 0, 1, 1, '#f4efe0'));
        }
        this.poly([L(dy - 0.7, 2.02), L(dy + 0.7, 2.02), L(dy + 0.7, 2.08), L(dy - 0.7, 2.08)], pal.trim);
        const stone = pal.dark ? '#4a4a48' : '#9a9a94';
        this.poly([P(0.05, dy - 0.6), P(0.9, dy - 0.6), P(0.9, dy + 0.6), P(0.05, dy + 0.6)], stone, this.tint(stone, -30));
      },

      // Paper screens: a wooden skirt, a lattice above.
      glassX(add, x, y, d) {
        add(x + y + d / 2 + 0.02, () => {
          const P = (a, b, c) => this.iso(a, b, c), pal = this.pal;
          this.poly([P(x, y, 0), P(x, y + d, 0), P(x, y + d, 0.3), P(x, y, 0.3)], pal.deskL);
          this.poly([P(x, y, 0.3), P(x, y + d, 0.3), P(x, y + d, 2.1), P(x, y, 2.1)], pal.glass, pal.glassEdge);
          for (const z of [0.9, 1.5]) this.seg(P(x, y, z), P(x, y + d, z), pal.glassEdge);
          if (d > 0.7) this.seg(P(x, y + d / 2, 0.3), P(x, y + d / 2, 2.1), pal.glassEdge);
        });
      },
      glassY(add, x, y, w) {
        add(x + w / 2 + y + 0.02, () => {
          const P = (a, b, c) => this.iso(a, b, c), pal = this.pal;
          this.poly([P(x, y, 0), P(x + w, y, 0), P(x + w, y, 0.3), P(x, y, 0.3)], pal.deskL);
          this.poly([P(x, y, 0.3), P(x + w, y, 0.3), P(x + w, y, 2.1), P(x, y, 2.1)], pal.glass, pal.glassEdge);
          for (const z of [0.9, 1.5]) this.seg(P(x, y, z), P(x + w, y, z), pal.glassEdge);
          if (w > 0.7) this.seg(P(x + w / 2, y, 0.3), P(x + w / 2, y, 2.1), pal.glassEdge);
        });
      },

      // ---- a place in the hall
      // What a cat does at its place. Thinking is sitting still; running a
      // tool is drilling, on its feet; writing a reply is brushwork.
      workState(p, face) {
        const st = (p.s || {}).status;
        if (st === 'tool') return { pose: 'stand', face, act: 'kata', sitZ: 0.06 };
        return { pose: 'sit', face, act: st === 'typing' ? 'brush' : 'zen', sitZ: 0.06 };
      },

      // A low desk with paper, an ink stone, and a lamp that burns the
      // colour of what its cat is doing.
      desk(dk, p) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        const x = dk.x + 0.25, y = dk.y - 0.1, z = 0.3;
        for (const lx of [x + 0.04, x + 0.78]) this.box(lx, y + 0.06, 0, 0.08, 0.3, 0.24, pal.deskL, pal.deskL, pal.deskR);
        this.box(x, y, 0.24, 0.9, 0.42, 0.06, pal.deskTop, pal.deskL, pal.deskR);
        const worker = p && p.mode === 'work' && !p.path.length ? p : null;
        const paper = pal.dark ? '#cfc6ac' : '#f6f0de';
        this.poly([P(x + 0.22, y + 0.07, z), P(x + 0.64, y + 0.07, z), P(x + 0.64, y + 0.35, z), P(x + 0.22, y + 0.35, z)], paper, this.tint(paper, -50));
        if (worker) {
          this.seg(P(x + 0.3, y + 0.14, z), P(x + 0.54, y + 0.14, z), INK_HEX);
          this.seg(P(x + 0.3, y + 0.22, z), P(x + 0.46, y + 0.22, z), INK_HEX);
        }
        this.art(P(x + 0.76, y + 0.2, z), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-2, -2, 4, 3);
          c.fillStyle = '#4a4e55'; c.fillRect(-1, -1, 2, 1);
        });
        const col = worker ? STATUS_COLOR[worker.s.status] || '#f2c230' : null;
        const flick = Math.sin(this.t / 130 + dk.x * 3) > 0 ? 1 : 0;
        this.art(P(x + 0.1, y + 0.2, z), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-2, -8, 5, 9);
          c.fillStyle = col ? '#fff6dc' : pal.dark ? '#8a8472' : '#d9d2bc'; c.fillRect(-1, -7, 3, 6);
          if (col) { c.fillStyle = col; c.fillRect(0, -5 - flick, 1, 3); }
          c.fillStyle = '#3a2a1e'; c.fillRect(-2, 0, 5, 1); c.fillRect(-2, -9, 5, 1);
        });
      },
      chair(dk) {
        this.zabuton(dk.seat.x, dk.seat.y, this.pal.chair);
      },
      zabuton(x, y, col) {
        this.box(x - 0.27, y - 0.25, 0, 0.54, 0.5, 0.06, this.shade(col, 16), col, this.shade(col, -16));
        this.art(this.iso(x, y, 0.06), (c) => { c.fillStyle = this.shade(col, -34); c.fillRect(0, -1, 1, 1); });
      },

      // ---- the head of the hall
      taiko(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x + 0.08, y + 0.05, 0, 0.6, 0.45, 0.3, pal.deskTop, pal.deskL, pal.deskR);
        this.art(P(x + 0.38, y + 0.3, 0.3), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-7, -12, 14, 13);
          c.fillStyle = '#a8452e'; c.fillRect(-6, -10, 12, 10);
          c.fillStyle = '#8a3522'; c.fillRect(-6, -10, 2, 10);
          c.fillStyle = '#c45a3c'; c.fillRect(-1, -10, 3, 10);
          c.fillStyle = INK_HEX; c.fillRect(-7, -13, 14, 1);
          pxDisc(c, 0, -11, 6, 2, '#efe2c4');
          c.fillStyle = '#3a2a1e';
          for (let i = -5; i <= 5; i += 2) { c.fillRect(i, -8, 1, 1); c.fillRect(i, -2, 1, 1); }
        });
      },
      serverRack(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x, y + 0.02, 0, 0.7, 0.1, 1.7, pal.deskTop, pal.deskL, pal.deskR);
        this.box(x, y + 0.12, 0, 0.7, 0.42, 0.22, pal.deskTop, pal.deskL, pal.deskR);
        for (let k = 0; k < 4; k++) {
          this.art(P(x + 0.12 + k * 0.16, y + 0.34, 0.22), (c) => {
            c.fillStyle = INK_HEX; c.fillRect(-1, -24, 3, 25);
            c.fillStyle = k % 2 ? '#d9b27a' : '#c49a62'; c.fillRect(0, -23, 1, 17);
            c.fillStyle = '#3a2a1e'; c.fillRect(0, -6, 1, 6);
            c.fillStyle = '#e8cf8a'; c.fillRect(0, -7, 1, 1);
          });
        }
      },

      // ---- the garden
      // A rock in three steps with moss on top; the water comes off the front.
      fallRock(x, y) {
        const dark = this.pal.dark;
        const st = dark ? '#55554f' : '#8c8c84', lt = this.tint(st, 14), dk = this.tint(st, -16);
        const moss = dark ? '#3f5a34' : '#86a865';
        this.box(x, y, 0, 1.6, 1.3, 0.9, lt, st, dk);
        this.box(x + 0.2, y + 0.1, 0.9, 1.25, 1.05, 0.5, lt, st, dk);
        this.box(x + 0.5, y + 0.2, 1.4, 0.7, 0.75, 0.3, moss, st, dk);
        const F = (u, z) => this.iso(x + u, y + 1.3, z);
        for (const [u, z] of [[0.25, 0.5], [1.3, 0.3], [0.5, 0.2], [1.05, 0.68]]) {
          this.art(F(u, z), (c) => { c.fillStyle = dk; c.fillRect(0, 0, 2, 1); c.fillRect(1, 1, 2, 1); });
        }
        for (const [u, v] of [[0.3, 0.2], [1.3, 0.6]]) {
          this.art(this.iso(x + u, y + v, 0.9), (c) => { c.fillStyle = moss; c.fillRect(-2, -1, 4, 2); c.fillRect(-1, -2, 2, 1); });
        }
      },
      fallWater(cx, fy) {
        const t = this.t / 1000;
        this.art(this.iso(cx, fy, 0), (c) => {
          const H = 28;
          c.globalAlpha = 0.5; c.fillStyle = '#bfe6f5'; c.fillRect(-4, -H, 8, H);
          c.globalAlpha = 0.9; c.fillStyle = '#ffffff';
          for (let i = 0; i < 4; i++) {
            const k = (t * 1.6 + i * 0.27) % 1;
            c.fillRect(-3 + i * 2, Math.round(-H + k * (H - 4)), 1, 4);
          }
          const s = Math.sin(t * 9) > 0 ? 1 : 0;
          c.globalAlpha = 0.85;
          c.fillRect(-7 - s, -2, 2, 1); c.fillRect(5 + s, -3, 2, 1); c.fillRect(-2, -1 - s, 1, 1); c.fillRect(2, -2 + s, 1, 1);
          c.globalAlpha = 1;
        });
      },
      lantern(x, y) {
        const st = this.pal.dark ? '#5a5a56' : '#a9a9a2', lt = this.tint(st, 16), dk = this.tint(st, -18);
        this.box(x - 0.2, y - 0.2, 0, 0.4, 0.4, 0.12, lt, st, dk);
        this.box(x - 0.08, y - 0.08, 0.12, 0.16, 0.16, 0.6, lt, st, dk);
        this.box(x - 0.2, y - 0.2, 0.72, 0.4, 0.4, 0.08, lt, st, dk);
        this.box(x - 0.14, y - 0.14, 0.8, 0.28, 0.28, 0.3, lt, st, dk);
        this.art(this.iso(x, y + 0.14, 0.88), (c) => { c.fillStyle = '#ffd98a'; c.fillRect(-1, -3, 2, 3); });
        this.box(x - 0.27, y - 0.27, 1.1, 0.54, 0.54, 0.08, lt, st, dk);
        this.box(x - 0.1, y - 0.1, 1.18, 0.2, 0.2, 0.1, lt, st, dk);
      },
      bamboo(x, y) {
        const g = this.pal.dark ? ['#3f6a3a', '#56864a'] : ['#5f9a4c', '#86bd62'];
        this.art(this.iso(x, y, 0), (c) => {
          pxDisc(c, 0, 0, 6, 2, this.pal.shadow);
          for (const [sx, h] of [[-4, 30], [-1, 36], [2, 32], [5, 27]]) {
            c.fillStyle = INK_HEX; c.fillRect(sx - 1, -h - 1, 4, h + 1);
            c.fillStyle = g[0]; c.fillRect(sx, -h, 2, h);
            c.fillStyle = g[1]; c.fillRect(sx, -h, 1, h);
            c.fillStyle = INK_HEX; for (let k = 7; k < h; k += 8) c.fillRect(sx, -k, 2, 1);
            c.fillStyle = g[1]; c.fillRect(sx + 2, -h + 2, 3, 1); c.fillRect(sx - 3, -h + 5, 3, 1);
            c.fillStyle = g[0]; c.fillRect(sx + 2, -h + 9, 4, 1); c.fillRect(sx - 4, -h + 13, 4, 1);
          }
        });
      },

      // ---- the tea room
      hearth(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x, y, 0, 1.4, 1.4, 0.3, pal.deskTop, pal.deskL, pal.deskR);
        this.poly([P(x + 0.4, y + 0.4, 0.3), P(x + 1.0, y + 0.4, 0.3), P(x + 1.0, y + 1.0, 0.3), P(x + 0.4, y + 1.0, 0.3)], '#d9d4c9', INK_HEX);
        const glow = Math.sin(this.t / 300) > 0;
        this.art(P(x + 0.7, y + 0.78, 0.3), (c) => {
          c.fillStyle = '#e8743a'; c.fillRect(-3, 0, 2, 1); c.fillRect(1, 1, 2, 1);
          c.fillStyle = glow ? '#ffd98a' : '#f2a04a'; c.fillRect(-1, 0, 1, 1); c.fillRect(2, 0, 1, 1);
          c.fillStyle = INK_HEX; c.fillRect(-4, -9, 9, 7); c.fillRect(5, -7, 2, 1);
          c.fillStyle = '#34373c'; c.fillRect(-3, -8, 7, 5);
          c.fillStyle = '#4a4e55'; c.fillRect(-2, -8, 2, 1);
          c.fillStyle = INK_HEX; c.fillRect(-3, -12, 1, 3); c.fillRect(3, -12, 1, 3); c.fillRect(-3, -13, 7, 1);
          // steam
          c.fillStyle = 'rgba(255,255,255,.7)';
          const k = Math.floor(this.t / 260) % 3;
          c.fillRect(6, -10 - k, 1, 1); c.fillRect(7, -12 - k, 1, 1);
        });
        for (const [u, v] of [[0.18, 0.2], [1.2, 0.3], [0.25, 1.2], [1.15, 1.15]]) this.art(P(x + u, y + v, 0.3), (c) => pxMug(c, '#e9e4d4', '#7a9a52'));
      },
      // a chest of drawers with iron pulls, a jar on top
      fridge(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x, y, 0, 0.85, 0.75, 1.7, pal.deskTop, pal.deskL, pal.deskR);
        const F = (u, z) => P(x + u, y + 0.75, z);
        const line = this.tint(pal.deskL, -30), iron = '#2a2c30';
        for (const z of [0.45, 0.85, 1.25]) this.seg(F(0.03, z), F(0.82, z), line);
        this.seg(F(0.425, 0.85), F(0.425, 1.7), line);
        for (const [u, z] of [[0.42, 0.24], [0.42, 0.64], [0.2, 1.06], [0.64, 1.06], [0.2, 1.46], [0.64, 1.46]]) {
          this.art(F(u, z), (c) => { c.fillStyle = iron; c.fillRect(-1, 0, 3, 1); c.fillRect(0, 1, 1, 1); });
        }
        this.art(P(x + 0.4, y + 0.4, 1.7), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-4, -8, 8, 8);
          c.fillStyle = '#39536b'; c.fillRect(-3, -7, 6, 6);
          c.fillStyle = '#5a7a96'; c.fillRect(-2, -7, 1, 4);
          c.fillStyle = '#efe2c4'; c.fillRect(-3, -8, 6, 1);
        });
      },
      // a water jar and a ladle
      waterCooler(x, y) {
        const P = (a, b, c) => this.iso(a, b, c);
        this.art(P(x + 0.21, y + 0.25, 0), (c) => {
          pxDisc(c, 0, 0, 5, 2, this.pal.shadow);
          c.fillStyle = INK_HEX; c.fillRect(-5, -13, 10, 13); c.fillRect(-6, -10, 12, 8);
          c.fillStyle = '#39536b'; c.fillRect(-4, -12, 8, 11); c.fillRect(-5, -9, 10, 6);
          c.fillStyle = '#5a7a96'; c.fillRect(-3, -10, 1, 6);
          c.fillStyle = '#7fb6d9'; c.fillRect(-3, -13, 6, 1);
          c.fillStyle = '#d9b27a'; c.fillRect(2, -18, 1, 6); c.fillRect(1, -13, 3, 1);
        });
      },

      // ---- the yard and the way in
      // a wooden dummy: a post with three arms and a leg
      arcade(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x + 0.1, y + 0.1, 0, 0.5, 0.5, 0.12, pal.deskTop, pal.deskL, pal.deskR);
        this.box(x + 0.26, y + 0.26, 0.12, 0.18, 0.18, 1.5, '#b98a58', '#9c7146', '#84603a');
        this.art(P(x + 0.35, y + 0.44, 1.3), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-10, -1, 8, 3); c.fillRect(3, -1, 8, 3);
          c.fillStyle = '#d9b27a'; c.fillRect(-9, 0, 7, 1); c.fillRect(3, 0, 7, 1);
        });
        this.art(P(x + 0.35, y + 0.44, 0.9), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(-2, -1, 4, 4);
          c.fillStyle = '#d9b27a'; c.fillRect(-1, 0, 2, 2);
        });
        this.art(P(x + 0.35, y + 0.44, 0.45), (c) => {
          c.fillStyle = INK_HEX; c.fillRect(1, -1, 9, 3);
          c.fillStyle = '#d9b27a'; c.fillRect(2, 0, 7, 1);
        });
      },
      // a log on two trestles, to run on
      treadmill(x, y, q) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        const wood = pal.dark ? '#7a5a3a' : '#b98a58', dk = this.tint(wood, -22), lt = this.tint(wood, 16);
        for (const yy of [y + 0.05, y + 1.3]) this.box(x + 0.05, yy, 0, 0.6, 0.15, 0.14, pal.deskTop, pal.deskL, pal.deskR);
        this.box(x + 0.12, y, 0.14, 0.46, 1.5, 0.2, lt, wood, dk);
        const turn = this.userOf(q) ? Math.floor(this.t / 120) % 2 : 0;
        this.art(P(x + 0.35, y + 1.5, 0.24), (c) => {
          pxRing(c, 0, 0, 2, 2, dk);
          c.fillStyle = dk; c.fillRect(turn ? -1 : 0, turn ? 0 : -1, 1, 1);
        });
      },
      // stone locks, small to large
      dumbbells(x, y) {
        const st = this.pal.dark ? '#5a5a56' : '#a9a9a2';
        for (let k = 0; k < 3; k++) {
          const s = 0.2 + k * 0.04;
          this.box(x + k * 0.34, y, 0, s, s, s, this.tint(st, 16), st, this.tint(st, -18));
          this.art(this.iso(x + k * 0.34 + s / 2, y + s / 2, s), (c) => {
            c.fillStyle = INK_HEX; c.fillRect(-2, -3, 4, 1); c.fillRect(-2, -2, 1, 2); c.fillRect(1, -2, 1, 2);
          });
        }
      },
      // a board game on a low table
      foosball(x, y) {
        const pal = this.pal, P = (a, b, c) => this.iso(a, b, c);
        this.box(x + 0.25, y + 0.12, 0, 1.1, 0.56, 0.3, pal.deskTop, pal.deskL, pal.deskR);
        const z = 0.36;
        this.box(x + 0.4, y + 0.14, 0.3, 0.8, 0.52, 0.06, '#e6c682', '#c9a560', '#b08e4e');
        for (let i = 1; i < 6; i++) this.seg(P(x + 0.4 + i * 0.8 / 6, y + 0.14, z), P(x + 0.4 + i * 0.8 / 6, y + 0.66, z), '#9a7a45');
        for (let j = 1; j < 4; j++) this.seg(P(x + 0.4, y + 0.14 + j * 0.13, z), P(x + 1.2, y + 0.14 + j * 0.13, z), '#9a7a45');
        for (const [u, v, col] of [[0.55, 0.3, '#1c1c1a'], [0.7, 0.42, '#fbfbf5'], [0.83, 0.28, '#1c1c1a'], [0.95, 0.5, '#fbfbf5'], [1.05, 0.36, '#1c1c1a'], [0.62, 0.52, '#fbfbf5']]) {
          this.art(P(x + u, y + v, z), (c) => { c.fillStyle = col; c.fillRect(-1, -1, 2, 1); });
        }
      },
      // straw-wrapped barrels, two high
      vending(x, y, color) {
        const P = (a, b, c) => this.iso(a, b, c);
        this.art(P(x + 0.36, y + 0.4, 0), (c) => {
          pxDisc(c, 0, 0, 7, 2, this.pal.shadow);
          for (const top of [-12, -24]) {
            c.fillStyle = INK_HEX; c.fillRect(-7, top - 1, 14, 14);
            c.fillStyle = '#dcc48e'; c.fillRect(-6, top, 12, 12);
            c.fillStyle = '#c2a56c'; c.fillRect(-6, top, 2, 12);
            c.fillStyle = '#8a6a3a'; c.fillRect(-6, top + 2, 12, 1); c.fillRect(-6, top + 9, 12, 1);
            c.fillStyle = '#f6f0de'; c.fillRect(-3, top + 4, 7, 4);
            c.fillStyle = color; c.fillRect(-1, top + 5, 3, 2);
            pxDisc(c, 0, top, 6, 1, '#efe2c4');
          }
        });
      },
    },
  };
  const SCENES = ['office', ...Object.keys(SCENE_ART)];

  window.Office = Office;
  window.OFFICE_SCENES = SCENES;
  window.OFFICE_AGENT_BADGES = AGENT_BADGES;
  window.OfficeGrid = Grid;
  window.OfficeCats = { sprite: catSprite, breeds: BREEDS, W: PXW, H: PXH };
})();
