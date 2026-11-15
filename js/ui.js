// Board rendering, drag and drop, and app chrome.
import { SUITS, RANK_LABELS, cardCode, cardName, isRed } from './deck.js';
import {
  deal, draw, move, movableRun, canMove, bestTarget, canAutoComplete, autoStep, elapsedMs, pileAt,
} from './game.js';

const CARD_DIR = 'assets/cards';
const STORE_KEY = 'telluride-solitaire:v1';
const MAX_HISTORY = 200;

const board = document.getElementById('board');
const $ = (id) => document.getElementById(id);

let state;
let undoStack = [];
let settings = { drawCount: 1 };
let stats = { played: 0, won: 0, bestMs: null };
let geo = null; // layout geometry
const cardEls = new Map(); // id -> element
const slotEls = {};
let locById = new Map(); // id -> { loc, index }
let autoTimer = null;

/* ------------------------------------------------------------------ setup */

const MOUNTAIN_SVG = '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M2 38 L20 10 L28 22 L38 4 L62 38 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 19 L20 10 L25 17" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M33 12 L38 4 L44 13" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

function buildSlots() {
  const make = (key, cls, inner = '') => {
    const el = document.createElement('div');
    el.className = `slot ${cls}`;
    el.innerHTML = inner;
    board.appendChild(el);
    slotEls[key] = el;
  };
  make('stock', 'stock');
  make('waste', 'waste');
  SUITS.forEach((s, i) => make(`f${i}`, `foundation f${i}`, `${s.symbol}<span class="lbl">${s.season}</span>`));
  for (let i = 0; i < 7; i++) make(`t${i}`, 'tableau');
}

function buildCards() {
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      const card = { id: suit * 13 + rank - 1, suit, rank };
      const s = SUITS[suit];
      const el = document.createElement('div');
      el.className = `card s-${s.key}`;
      el.dataset.id = card.id;
      el.setAttribute('aria-label', cardName(card));
      const idx = `<span class="r">${RANK_LABELS[rank]}</span><span class="s">${s.symbol}</span>`;
      el.innerHTML = `
        <div class="face ${isRed(card) ? 'red' : ''}">
          <div class="photo"></div>
          <div class="pip">${s.symbol}<small>${s.season}</small></div>
          <div class="idx tl">${idx}</div>
          <div class="idx br">${idx}</div>
          <div class="season-band"></div>
        </div>
        <div class="back">${MOUNTAIN_SVG}</div>`;
      board.appendChild(el);
      cardEls.set(card.id, el);

      // Use the deck photo when assets/cards/<code>.jpg exists; otherwise the styled face stays.
      const url = `${CARD_DIR}/${cardCode(card)}.jpg`;
      const img = new Image();
      img.onload = () => {
        el.querySelector('.photo').style.backgroundImage = `url("${url}")`;
        el.classList.add('has-photo');
      };
      img.src = url;
    }
  }
  const back = new Image();
  back.onload = () => {
    for (const el of cardEls.values()) {
      el.querySelector('.back').style.backgroundImage = `url("${back.src}")`;
      el.classList.add('has-back');
    }
  };
  back.src = `${CARD_DIR}/back.jpg`;
}

/* ----------------------------------------------------------------- layout */

function computeGeometry() {
  const W = board.clientWidth;
  const H = Math.max(board.clientHeight, 320);
  const pad = W < 500 ? 6 : 14;
  const gapRatio = W < 500 ? 0.1 : 0.16;
  let cw = (W - pad * 2) / (7 + 6 * gapRatio);
  cw = Math.min(cw, 118, (H - 24) / (1.4 * 3.3)); // leave room for a fanned tableau
  cw = Math.floor(cw);
  const ch = Math.round(cw * 1.4);
  const gap = cw * gapRatio;
  const left = (W - (7 * cw + 6 * gap)) / 2;
  const top = pad + 2;
  const tabTop = top + ch + Math.max(gap * 1.5, 14);
  document.documentElement.style.setProperty('--cw', `${cw}px`);
  document.documentElement.style.setProperty('--ch', `${ch}px`);
  return { W, H, cw, ch, gap, left, top, tabTop, colX: (i) => left + i * (cw + gap) };
}

function slotPos(key) {
  const g = geo;
  if (key === 'stock') return [g.colX(0), g.top];
  if (key === 'waste') return [g.colX(1), g.top];
  if (key[0] === 'f') return [g.colX(3 + Number(key.slice(1))), g.top];
  return [g.colX(Number(key.slice(1))), g.tabTop];
}

function tableauOffsets(pile) {
  const { ch, H, tabTop } = geo;
  let down = ch * 0.1;
  let up = ch * 0.28;
  const n = pile.length;
  if (n <= 1) return { down, up };
  const avail = H - tabTop - ch - 8;
  const downs = pile.slice(0, -1).filter((c) => !c.faceUp).length;
  const ups = n - 1 - downs;
  const need = downs * down + ups * up;
  if (need > avail && need > 0) {
    const f = avail / need;
    down = Math.max(ch * 0.05, down * f);
    up = Math.max(ch * 0.12, up * f);
  }
  return { down, up };
}

/* ----------------------------------------------------------------- render */

function place(el, x, y, z) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.zIndex = z;
}

function render() {
  if (!geo) geo = computeGeometry();
  for (const [key, el] of Object.entries(slotEls)) {
    const [x, y] = slotPos(key);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  locById = new Map();
  const set = (card, loc, index, x, y, z, grabbable) => {
    const el = cardEls.get(card.id);
    el.classList.toggle('up', card.faceUp);
    el.classList.toggle('grab', grabbable);
    place(el, x, y, z);
    locById.set(card.id, { loc, index });
  };

  // stock
  const [sx, sy] = slotPos('stock');
  state.stock.forEach((c, i) => set(c, { type: 'stock' }, i, sx + Math.min(i, 6) * -0.4, sy - Math.min(i, 6) * 0.4, 10 + i, false));
  slotEls.stock.classList.toggle('recycle', state.stock.length === 0 && state.waste.length > 0);
  slotEls.stock.classList.toggle('empty', state.stock.length === 0 && state.waste.length === 0);

  // waste: show the last 1 (draw 1) or fan the last 3 (draw 3)
  const [wx, wy] = slotPos('waste');
  const fan = state.drawCount === 3 ? 3 : 1;
  const firstFanned = Math.max(0, state.waste.length - fan);
  state.waste.forEach((c, i) => {
    const off = i >= firstFanned ? (i - firstFanned) * geo.cw * 0.24 : 0;
    set(c, { type: 'waste' }, i, wx + off, wy, 100 + i, i === state.waste.length - 1);
  });

  // foundations
  state.foundations.forEach((pile, f) => {
    const [fx, fy] = slotPos(`f${f}`);
    pile.forEach((c, i) => set(c, { type: 'foundation', index: f }, i, fx, fy, 200 + i, i === pile.length - 1));
  });

  // tableau
  state.tableau.forEach((pile, t) => {
    const [tx, ty] = slotPos(`t${t}`);
    const { down, up } = tableauOffsets(pile);
    let y = ty;
    pile.forEach((c, i) => {
      set(c, { type: 'tableau', index: t }, i, tx, y, 300 + i, c.faceUp);
      y += c.faceUp ? up : down;
    });
  });

  $('moves').textContent = state.moves;
  $('dealLabel').textContent = `Deal #${state.seed}${state.drawCount === 3 ? ' · draw 3' : ''}`;
  $('btnUndo').disabled = undoStack.length === 0;
  $('btnDraw').textContent = `Draw ${settings.drawCount === 1 ? '1' : '3'}`;
  tickTime();
}

function relayout() {
  geo = computeGeometry();
  for (const el of cardEls.values()) el.classList.add('instant');
  render();
  requestAnimationFrame(() => { for (const el of cardEls.values()) el.classList.remove('instant'); });
}

/* ------------------------------------------------------------ game flow */

function commit(next) {
  if (!next) return false;
  undoStack.push(state);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  state = next;
  render();
  save();
  afterChange();
  return true;
}

function afterChange() {
  clearTimeout(autoTimer);
  if (state.won) {
    onWin();
  } else if (canAutoComplete(state)) {
    autoTimer = setTimeout(() => {
      const next = autoStep(state);
      if (next) { state = next; render(); save(); afterChange(); }
    }, 110);
  }
}

function newGame(seed = randomSeed()) {
  clearTimeout(autoTimer);
  state = deal(seed, settings.drawCount);
  undoStack = [];
  stats.played++;
  window.history.replaceState(null, '', `#deal=${seed}`);
  $('win').hidden = true;
  relayout();
  save();
}

function randomSeed() {
  return 1 + Math.floor(Math.random() * 999999);
}

function undo() {
  if (!undoStack.length) return;
  clearTimeout(autoTimer);
  const { startedAt, elapsed } = state;
  state = undoStack.pop();
  // undo doesn't rewind the clock
  if (state.moves > 0) Object.assign(state, { startedAt, elapsed });
  render();
  save();
}

/* ------------------------------------------------------------ persistence */

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ state, history: undoStack.slice(-50), settings, stats }));
  } catch { /* storage may be unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    settings = { ...settings, ...data.settings };
    stats = { ...stats, ...data.stats };
    if (data.state && !data.state.won) {
      state = data.state;
      undoStack = data.history || [];
      // the clock pauses while the tab is closed
      if (state.startedAt !== null) state.startedAt = Date.now();
      return true;
    }
  } catch { /* ignore corrupt storage */ }
  return false;
}

/* ---------------------------------------------------------------- input */

let press = null; // active pointer interaction

function targetsFor(fromLoc) {
  const list = SUITS.map((_, i) => ({ type: 'foundation', index: i }));
  for (let i = 0; i < 7; i++) list.push({ type: 'tableau', index: i });
  return list.filter((t) => !(t.type === fromLoc.type && t.index === fromLoc.index));
}

function dropPoint(loc) {
  const pile = pileAt(state, loc);
  if (loc.type === 'foundation') { const [x, y] = slotPos(`f${loc.index}`); return [x, y]; }
  const topCard = pile[pile.length - 1];
  if (!topCard) { const [x, y] = slotPos(`t${loc.index}`); return [x, y]; }
  const el = cardEls.get(topCard.id);
  return [parseFloat(el.style.left), parseFloat(el.style.top) + (pile.length ? geo.ch * 0.25 : 0)];
}

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (press) return;
  const cardEl = e.target.closest('.card');
  const slotEl = e.target.closest('.slot.stock');
  if (!cardEl && !slotEl) return;
  if (slotEl || (cardEl && locById.get(Number(cardEl.dataset.id))?.loc.type === 'stock')) {
    press = { kind: 'stock', x: e.clientX, y: e.clientY };
    return;
  }
  const id = Number(cardEl.dataset.id);
  const info = locById.get(id);
  if (!info) return;
  const run = movableRun(state, info.loc, info.index);
  if (!run) return;
  const els = run.map((c) => cardEls.get(c.id));
  press = {
    kind: 'card',
    from: info.loc,
    index: info.index,
    els,
    origin: els.map((el) => [parseFloat(el.style.left), parseFloat(el.style.top)]),
    x: e.clientX,
    y: e.clientY,
    dragging: false,
  };
  board.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e) {
  if (!press || press.kind !== 'card') return;
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  if (!press.dragging) {
    if (Math.hypot(dx, dy) < 6) return;
    press.dragging = true;
    press.els.forEach((el, i) => { el.classList.add('dragging'); el.style.zIndex = 2000 + i; });
  }
  press.els.forEach((el, i) => {
    el.style.left = `${press.origin[i][0] + dx}px`;
    el.style.top = `${press.origin[i][1] + dy}px`;
  });
  highlightDrop(dx, dy);
}

function bestDrop(p, dx, dy) {
  const cx = p.origin[0][0] + dx + geo.cw / 2;
  const cy = p.origin[0][1] + dy + geo.ch / 2;
  let best = null;
  for (const t of targetsFor(p.from)) {
    if (!canMove(state, p.from, p.index, t)) continue;
    const [px, py] = dropPoint(t);
    const d = Math.hypot(px + geo.cw / 2 - cx, py + geo.ch / 2 - cy);
    if (d < geo.cw * 1.25 && (!best || d < best.d)) best = { t, d };
  }
  return best?.t || null;
}

function highlightDrop(dx, dy) {
  Object.values(slotEls).forEach((el) => el.classList.remove('drop-ok'));
  const t = bestDrop(press, dx, dy);
  if (t) slotEls[t.type === 'foundation' ? `f${t.index}` : `t${t.index}`].classList.add('drop-ok');
}

function onPointerUp(e) {
  if (!press) return;
  const p = press;
  press = null;
  Object.values(slotEls).forEach((el) => el.classList.remove('drop-ok'));
  if (p.kind === 'stock') {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) commit(draw(state));
    return;
  }
  p.els.forEach((el) => el.classList.remove('dragging'));
  if (!p.dragging) {
    const t = bestTarget(state, p.from, p.index);
    if (t) commit(move(state, p.from, p.index, t));
    else nudge(p.els);
    return;
  }
  const t = bestDrop(p, e.clientX - p.x, e.clientY - p.y);
  if (!(t && commit(move(state, p.from, p.index, t)))) render(); // snap back
}

function nudge(els) {
  els.forEach((el) => el.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
    { duration: 220 },
  ));
}

/* ----------------------------------------------------------------- hint */

function findHint() {
  // 1) anything to a foundation, 2) moves that flip a hidden card, 3) waste to tableau, 4) draw
  const cands = [];
  const consider = (from, index, pr) => {
    const t = bestTarget(state, from, index);
    if (!t) return;
    let priority = pr;
    if (t.type === 'foundation') priority = 0;
    cands.push({ from, index, t, priority });
  };
  state.tableau.forEach((pile, i) => {
    const first = pile.findIndex((c) => c.faceUp);
    if (first < 0) return;
    // moving the whole face-up run is useful only if it reveals something or empties a column for a king
    if (first > 0) consider({ type: 'tableau', index: i }, first, 1);
    else if (pile[0].rank !== 13) consider({ type: 'tableau', index: i }, 0, 2);
    const last = pile.length - 1;
    if (last !== first) {
      const t = { type: 'foundation', index: pile[last].suit };
      if (canMove(state, { type: 'tableau', index: i }, last, t)) cands.push({ from: { type: 'tableau', index: i }, index: last, t, priority: 0 });
    }
  });
  if (state.waste.length) consider({ type: 'waste' }, state.waste.length - 1, 3);
  cands.sort((a, b) => a.priority - b.priority);
  return cands[0] || null;
}

function showHint() {
  const h = findHint();
  let els;
  if (h) els = pileAt(state, h.from).slice(h.index).map((c) => cardEls.get(c.id));
  else if (state.stock.length) els = [cardEls.get(state.stock[state.stock.length - 1].id)];
  else if (state.waste.length) els = [slotEls.stock];
  else return;
  els.forEach((el) => { el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint'); });
  setTimeout(() => els.forEach((el) => el.classList.remove('hint')), 1900);
}

/* ------------------------------------------------------------- timer/win */

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function tickTime() { if (state) $('time').textContent = fmt(elapsedMs(state)); }

function onWin() {
  stats.won++;
  const ms = elapsedMs(state);
  if (!stats.bestMs || ms < stats.bestMs) stats.bestMs = ms;
  save();
  $('winStats').textContent = `${state.moves} moves in ${fmt(ms)} · ${stats.won} won of ${stats.played} played · best ${fmt(stats.bestMs)}`;
  setTimeout(() => { $('win').hidden = false; confetti(); }, 450);
}

function confetti() {
  const c = $('confetti');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#6fa3c9', '#e07a8f', '#e2a92c', '#c8642b', '#f4f1e8'];
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.6,
    vx: (Math.random() - 0.5) * 1.2, vy: 1.5 + Math.random() * 2.5,
    r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const end = performance.now() + 4500;
  const frame = (now) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.x += b.vx; b.y += b.vy; b.a += b.va;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.fillStyle = b.color; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2);
      ctx.restore();
    }
    if (now < end && !$('win').hidden) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(frame);
}

/* ----------------------------------------------------------------- boot */

function seedFromHash() {
  const m = location.hash.match(/deal=(\d+)/);
  return m ? Number(m[1]) : null;
}

function boot() {
  buildSlots();
  buildCards();
  const hashSeed = seedFromHash();
  const restored = load();
  if (!restored || (hashSeed && hashSeed !== state.seed)) newGame(hashSeed || randomSeed());
  else { window.history.replaceState(null, '', `#deal=${state.seed}`); relayout(); }

  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', () => { press = null; render(); });
  new ResizeObserver(relayout).observe(board);

  $('btnNew').onclick = () => newGame();
  $('btnAgain').onclick = () => newGame();
  $('btnUndo').onclick = undo;
  $('btnHint').onclick = showHint;
  $('btnDraw').onclick = () => {
    settings.drawCount = settings.drawCount === 1 ? 3 : 1;
    newGame();
  };
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey ? e.key === 'z' : false) { undo(); e.preventDefault(); return; }
    if (e.key === 'u') undo();
    else if (e.key === 'n') newGame();
    else if (e.key === 'h') showHint();
    else if (e.key === ' ') { commit(draw(state)); e.preventDefault(); }
  });
  window.addEventListener('hashchange', () => {
    const s = seedFromHash();
    if (s && s !== state.seed) newGame(s);
  });
  setInterval(tickTime, 1000);
  afterChange();
}

boot();

// Exposed for debugging and automated tests.
window.__solitaire = {
  get state() { return state; },
  set state(s) { state = s; render(); afterChange(); },
};
