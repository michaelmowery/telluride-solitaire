// Klondike rules engine. Pure state + functions, no DOM, so it can be tested in Node.
import { newDeck, isRed } from './deck.js';

/** Small seeded PRNG (mulberry32) so a deal number always produces the same layout. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(cards, seed) {
  const rand = rng(seed);
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function deal(seed, drawCount = 1) {
  const cards = shuffle(newDeck(), seed);
  const tableau = [[], [], [], [], [], [], []];
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const card = cards.pop();
      card.faceUp = col === row;
      tableau[col].push(card);
    }
  }
  return {
    seed,
    drawCount,
    stock: cards, // remaining 24, face down; top of stock is the end of the array
    waste: [],
    foundations: [[], [], [], []], // indexed by suit
    tableau,
    moves: 0,
    passes: 0,
    startedAt: null,
    elapsed: 0,
    won: false,
  };
}

const top = (pile) => pile[pile.length - 1];

export function pileAt(state, loc) {
  switch (loc.type) {
    case 'stock': return state.stock;
    case 'waste': return state.waste;
    case 'foundation': return state.foundations[loc.index];
    case 'tableau': return state.tableau[loc.index];
    default: throw new Error(`Unknown pile ${loc.type}`);
  }
}

export function canPlaceOnFoundation(state, card, index) {
  if (card.suit !== index) return false;
  const pile = state.foundations[index];
  return pile.length === 0 ? card.rank === 1 : top(pile).rank === card.rank - 1;
}

export function canPlaceOnTableau(state, card, index) {
  const pile = state.tableau[index];
  if (pile.length === 0) return card.rank === 13;
  const t = top(pile);
  return t.faceUp && isRed(t) !== isRed(card) && t.rank === card.rank + 1;
}

/** Cards that would move if the player picks up the card at `cardIndex` in `from`. */
export function movableRun(state, from, cardIndex) {
  const pile = pileAt(state, from);
  if (cardIndex < 0 || cardIndex >= pile.length) return null;
  if (from.type === 'stock') return null;
  if (from.type !== 'tableau' && cardIndex !== pile.length - 1) return null;
  const run = pile.slice(cardIndex);
  if (!run[0].faceUp) return null;
  for (let i = 1; i < run.length; i++) {
    if (isRed(run[i]) === isRed(run[i - 1]) || run[i].rank !== run[i - 1].rank - 1) return null;
  }
  return run;
}

export function canMove(state, from, cardIndex, to) {
  const run = movableRun(state, from, cardIndex);
  if (!run) return false;
  if (from.type === to.type && from.index === to.index) return false;
  if (to.type === 'foundation') return run.length === 1 && canPlaceOnFoundation(state, run[0], to.index);
  if (to.type === 'tableau') return canPlaceOnTableau(state, run[0], to.index);
  return false;
}

const clone = (s) => JSON.parse(JSON.stringify(s));

function touch(state) {
  if (state.startedAt === null) state.startedAt = Date.now();
  state.moves++;
}

function flipExposed(state, from) {
  if (from.type !== 'tableau') return;
  const pile = state.tableau[from.index];
  const t = top(pile);
  if (t && !t.faceUp) t.faceUp = true;
}

function checkWin(state) {
  state.won = state.foundations.every((f) => f.length === 13);
  if (state.won && state.startedAt !== null) {
    state.elapsed += Date.now() - state.startedAt;
    state.startedAt = null;
  }
}

/** Returns a new state with the move applied, or null if illegal. */
export function move(state, from, cardIndex, to) {
  if (!canMove(state, from, cardIndex, to)) return null;
  const next = clone(state);
  const src = pileAt(next, from);
  const run = src.splice(cardIndex);
  pileAt(next, to).push(...run);
  flipExposed(next, from);
  touch(next);
  checkWin(next);
  return next;
}

/** Click on the stock: draw 1 or 3, or recycle the waste when the stock is empty. */
export function draw(state) {
  if (state.stock.length === 0 && state.waste.length === 0) return null;
  const next = clone(state);
  if (next.stock.length === 0) {
    next.stock = next.waste.reverse().map((c) => ({ ...c, faceUp: false }));
    next.waste = [];
    next.passes++;
  } else {
    const n = Math.min(next.drawCount, next.stock.length);
    for (let i = 0; i < n; i++) {
      const c = next.stock.pop();
      c.faceUp = true;
      next.waste.push(c);
    }
  }
  touch(next);
  return next;
}

/** Best destination for a tapped card: foundation first, then a tableau pile (non-empty preferred). */
export function bestTarget(state, from, cardIndex) {
  const run = movableRun(state, from, cardIndex);
  if (!run) return null;
  if (run.length === 1 && from.type !== 'foundation') {
    const f = { type: 'foundation', index: run[0].suit };
    if (canMove(state, from, cardIndex, f)) return f;
  }
  const options = [];
  for (let i = 0; i < 7; i++) {
    const t = { type: 'tableau', index: i };
    if (canMove(state, from, cardIndex, t)) options.push(t);
  }
  // Don't shuffle a King that already heads an empty column between empty columns.
  const useful = options.filter((t) => !(state.tableau[t.index].length === 0 && from.type === 'tableau' && cardIndex === 0));
  const nonEmpty = useful.find((t) => state.tableau[t.index].length > 0);
  return nonEmpty || useful[0] || null;
}

/** True once every card is face up and the stock/waste are empty: the rest is a formality. */
export function canAutoComplete(state) {
  if (state.won) return false;
  if (state.stock.length || state.waste.length) return false;
  return state.tableau.every((p) => p.every((c) => c.faceUp));
}

/** One auto-complete step: move the lowest available card to its foundation. */
export function autoStep(state) {
  let best = null;
  const sources = [{ type: 'waste' }, ...state.tableau.map((_, i) => ({ type: 'tableau', index: i }))];
  for (const from of sources) {
    const pile = pileAt(state, from);
    if (!pile.length) continue;
    const card = top(pile);
    const to = { type: 'foundation', index: card.suit };
    if (canMove(state, from, pile.length - 1, to) && (!best || card.rank < best.card.rank)) {
      best = { from, idx: pile.length - 1, to, card };
    }
  }
  return best ? move(state, best.from, best.idx, best.to) : null;
}

export function elapsedMs(state) {
  return state.elapsed + (state.startedAt !== null ? Date.now() - state.startedAt : 0);
}
