import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deal, draw, move, canMove, bestTarget, canAutoComplete, autoStep, movableRun } from '../js/game.js';

const count = (s) => s.stock.length + s.waste.length + s.foundations.flat().length + s.tableau.flat().length;
const ids = (s) => [...s.stock, ...s.waste, ...s.foundations.flat(), ...s.tableau.flat()].map((c) => c.id).sort((a, b) => a - b);

test('deal lays out 28 tableau cards and 24 stock, same seed same deal', () => {
  const a = deal(42);
  assert.equal(a.tableau.flat().length, 28);
  assert.equal(a.stock.length, 24);
  a.tableau.forEach((p, i) => {
    assert.equal(p.length, i + 1);
    assert.ok(p[i].faceUp);
    assert.ok(p.slice(0, -1).every((c) => !c.faceUp));
  });
  assert.deepEqual(deal(42), a);
  assert.notDeepEqual(deal(43).tableau, a.tableau);
});

test('draw 1 / draw 3 and recycling the waste', () => {
  let s = deal(1, 3);
  s = draw(s);
  assert.equal(s.waste.length, 3);
  for (let i = 0; i < 7; i++) s = draw(s);
  assert.equal(s.stock.length, 0);
  assert.equal(s.waste.length, 24);
  s = draw(s);
  assert.equal(s.stock.length, 24);
  assert.ok(s.stock.every((c) => !c.faceUp));
  assert.equal(s.passes, 1);
});

test('foundation and tableau rules', () => {
  const s = deal(7);
  const card = (suit, rank, faceUp = true) => ({ id: suit * 13 + rank - 1, suit, rank, faceUp });
  s.tableau = [[card(1, 1)], [card(0, 13)], [card(1, 12)], [], [], [], []];
  s.foundations = [[], [], [], []];
  const T = (i) => ({ type: 'tableau', index: i });
  assert.ok(canMove(s, T(0), 0, { type: 'foundation', index: 1 }), 'ace of hearts to hearts foundation');
  assert.ok(!canMove(s, T(0), 0, { type: 'foundation', index: 0 }), 'not to spades');
  assert.ok(canMove(s, T(2), 0, T(1)), 'red queen on black king');
  assert.ok(canMove(s, T(1), 0, T(3)), 'king to empty column');
  assert.ok(!canMove(s, T(2), 0, T(3)), 'queen not to empty column');
  assert.deepEqual(bestTarget(s, T(0), 0), { type: 'foundation', index: 1 });
});

test('moving the last face-up card flips the one beneath', () => {
  const s = deal(7);
  const card = (suit, rank, faceUp = true) => ({ id: suit * 13 + rank - 1, suit, rank, faceUp });
  s.tableau = [[card(2, 5, false), card(1, 1)], [], [], [], [], [], []];
  s.foundations = [[], [], [], []];
  const n = move(s, { type: 'tableau', index: 0 }, 1, { type: 'foundation', index: 1 });
  assert.ok(n.tableau[0][0].faceUp);
  assert.equal(n.moves, 1);
});

test('runs must alternate colour and descend', () => {
  const s = deal(7);
  const card = (suit, rank, faceUp = true) => ({ id: suit * 13 + rank - 1, suit, rank, faceUp });
  s.tableau = [[card(0, 9), card(1, 8), card(3, 7)], [card(0, 9), card(2, 8), card(1, 7)], [], [], [], [], []];
  assert.equal(movableRun(s, { type: 'tableau', index: 0 }, 0).length, 3);
  assert.equal(movableRun(s, { type: 'tableau', index: 1 }, 0), null);
});

test('random play keeps all 52 cards and auto-complete finishes a won position', () => {
  for (let seed = 1; seed <= 200; seed++) {
    let s = deal(seed, seed % 2 ? 1 : 3);
    for (let step = 0; step < 400 && !s.won; step++) {
      let moved = null;
      const sources = [{ type: 'waste' }, ...s.tableau.map((_, i) => ({ type: 'tableau', index: i }))];
      for (const from of sources) {
        const pile = from.type === 'waste' ? s.waste : s.tableau[from.index];
        for (let i = pile.length - 1; i >= 0 && !moved; i--) {
          const t = bestTarget(s, from, i);
          if (t && !(t.type === 'tableau' && from.type === 'tableau' && i > 0 && pile[i - 1].faceUp && t.index !== from.index && s.tableau[t.index].length === 0)) {
            if (t.type === 'foundation' || from.type === 'waste' || (i > 0 && !pile[i - 1].faceUp) || (i === 0 && pile[0].rank !== 13)) moved = move(s, from, i, t);
          }
        }
        if (moved) break;
      }
      s = moved || draw(s) || s;
      if (canAutoComplete(s)) while (!s.won) s = autoStep(s);
      assert.equal(count(s), 52);
    }
    assert.deepEqual(ids(s), [...Array(52).keys()]);
  }
});
