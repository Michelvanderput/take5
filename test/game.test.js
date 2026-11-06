'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, cardPoints } = require('../server/game');

test('koeienkoppen per kaart', () => {
  assert.equal(cardPoints(55), 7);
  assert.equal(cardPoints(11), 5);
  assert.equal(cardPoints(99), 5);
  assert.equal(cardPoints(10), 3);
  assert.equal(cardPoints(100), 3);
  assert.equal(cardPoints(15), 2);
  assert.equal(cardPoints(1), 1);
  assert.equal(cardPoints(104), 1);
  const total = Array.from({ length: 104 }, (_, i) => cardPoints(i + 1)).reduce((a, b) => a + b);
  assert.equal(total, 171); // bekend totaal van het spel
});

function setup(rows, hands) {
  const g = new Game(hands.map((_, i) => ({ id: 'p' + i })));
  g.startRound();
  g.rows = rows.map((r) => r.slice());
  hands.forEach((h, i) => (g.players[i].hand = h.slice()));
  return g;
}

function playTurn(g, cards) {
  cards.forEach((c, i) => g.submit('p' + i, c));
  g.reveal();
}

test('deelt 10 kaarten en 4 rijen van 1', () => {
  const g = new Game([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  g.startRound();
  assert.equal(g.rows.length, 4);
  assert.ok(g.rows.every((r) => r.length === 1));
  assert.ok(g.players.every((p) => p.hand.length === 10));
  const all = [...g.rows.flat(), ...g.players.flatMap((p) => p.hand)];
  assert.equal(new Set(all).size, all.length);
});

test('kaarten worden gesorteerd en op kleinste verschil gelegd', () => {
  const g = setup([[10], [20], [30], [40]], [[33, 90], [12, 91]]);
  playTurn(g, [33, 12]);
  assert.deepEqual(g.turnCards.map((t) => t.card), [12, 33]);
  assert.equal(g.step().row, 0); // 12 -> rij met 10
  assert.equal(g.step().row, 2); // 33 -> rij met 30
  assert.deepEqual(g.rows, [[10, 12], [20], [30, 33], [40]]);
});

test('zesde kaart: rij gaat naar speler, kaart wordt nieuwe start', () => {
  const g = setup([[1, 2, 3, 4, 5], [50], [60], [70]], [[6, 90], [80, 91]]);
  playTurn(g, [6, 80]);
  const ev = g.step();
  assert.equal(ev.type, 'sixth');
  assert.equal(ev.points, 1 + 1 + 1 + 1 + 2);
  assert.deepEqual(g.rows[0], [6]);
  assert.equal(g.player('p0').pile.length, 5);
});

test('te lage kaart: speler kiest rij', () => {
  const g = setup([[10], [20], [30], [40]], [[5, 90], [50, 91]]);
  playTurn(g, [5, 50]);
  assert.equal(g.step().type, 'needRow');
  assert.equal(g.phase, 'chooseRow');
  assert.throws(() => g.chooseRow('p1', 0));
  const ev = g.chooseRow('p0', 1);
  assert.equal(ev.type, 'take');
  assert.deepEqual(g.rows[1], [5]);
  assert.deepEqual(g.player('p0').pile, [20]);
  assert.equal(g.step().type, 'place');
});

test('volledige ronde en einde spel', () => {
  let n = 0;
  const g = new Game([{ id: 'a' }, { id: 'b' }], { targetScore: 1 });
  g.startRound();
  for (let t = 0; t < 10; t++) {
    for (const p of g.players) g.submit(p.id, p.hand[0]);
    g.reveal();
    let ev;
    do {
      ev = g.step();
      if (ev.type === 'needRow') g.chooseRow(ev.playerId, g.cheapestRow());
      n++;
    } while (g.phase === 'resolving' || g.phase === 'chooseRow');
  }
  assert.ok(['gameOver', 'roundEnd'].includes(g.phase));
  assert.ok(g.players.every((p) => p.hand.length === 0));
});
