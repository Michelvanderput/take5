'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, sumPoints } = require('../server/game');
const bot = require('../server/bot');

// Een kleine, herhaalbare toevalsgenerator
const seeded = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function setup(rows, hands) {
  const g = new Game(hands.map((_, i) => ({ id: 'p' + i })), { rng: seeded(1) });
  g.startRound();
  g.rows = rows.map((r) => r.slice());
  hands.forEach((h, i) => (g.players[i].hand = h.slice()));
  return g;
}

test('slimme bot mijdt een rij met 4 kaarten waar nog veel kaarten tussen kunnen vallen', () => {
  // 45 zou op een rij met 4 kaarten komen met een groot gat (27-44 kan nog gespeeld worden): grote kans op de 6e kaart.
  // 62 ligt vlak naast de enkele 60: veilig.
  const g = setup([[20, 22, 24, 26], [60], [80], [95]], [[45, 62], [1, 2], [3, 4]]);
  for (let i = 0; i < 30; i++) assert.equal(bot.chooseCard(g, 'p0', 'hard', seeded(i + 5)), 62);
  // een kaart direct naast de 4e kaart (geen gat) is wel prima
  const h = setup([[20, 22, 24, 26], [60], [80], [95]], [[27, 99], [1, 2], [3, 4]]);
  assert.ok(bot.cardCost(h, [27, 99], bot.seenCards(h, [27, 99]), 27) < 1);
});

test('te lage kaart: de goedkoopste rij', () => {
  const g = setup([[50, 55, 60], [70], [80, 90], [99]], [[3, 40], [4], [5]]);
  g.reveal = undefined;
  g.phase = 'chooseRow';
  g.turnCards = [{ playerId: 'p0', card: 3, done: false }];
  g.cursor = 0;
  g.waitingFor = 'p0';
  for (const level of ['normal', 'hard']) {
    const picks = new Set();
    for (let i = 0; i < 30; i++) picks.add(bot.chooseRow(g, 'p0', level, seeded(i + 9)));
    assert.ok(picks.has(1) || picks.has(3), 'kiest een rij met 1 punt (rij 2 of 4)');
    assert.ok(!picks.has(0), 'pakt nooit de dure rij van 5 punten');
  }
  assert.equal(bot.chooseRow(g, 'p0', 'easy'), g.cheapestRow());
});

test('bots kijken niet in andermans hand en gebruiken alleen openbare kaarten', () => {
  const g = setup([[10], [20], [30], [40]], [[50, 60], [70, 80], [90, 100]]);
  const seen = bot.seenCards(g, g.player('p0').hand);
  assert.ok([10, 20, 30, 40, 50, 60].every((c) => seen.has(c)));
  assert.ok(![70, 80, 90, 100].some((c) => seen.has(c)), 'handen van anderen zijn onbekend');
});

test('onbekend niveau valt terug op een geldige kaart', () => {
  const g = setup([[10], [20], [30], [40]], [[50, 60], [70, 80]]);
  assert.ok(g.player('p0').hand.includes(bot.chooseCard(g, 'p0', 'bestaatniet')));
});

// Meting: speelt 'slim' echt beter dan 'makkelijk'?
function playRound(levels, rng) {
  const g = new Game(levels.map((_, i) => ({ id: 'p' + i })), { rng, targetScore: 9999 });
  g.startRound();
  for (let t = 0; t < 10; t++) {
    g.players.forEach((p, i) => g.submit(p.id, bot.chooseCard(g, p.id, levels[i], rng)));
    g.reveal();
    for (let guard = 0; guard < 100 && (g.phase === 'resolving' || g.phase === 'chooseRow'); guard++) {
      const ev = g.step();
      if (ev.type === 'needRow') g.chooseRow(ev.playerId, bot.chooseRow(g, ev.playerId, levels[+ev.playerId.slice(1)], rng));
      if (ev.type === 'roundEnd' || ev.type === 'gameOver') break;
    }
  }
  return g.players.map((p) => p.score);
}

test('niveaus: slim < normaal < makkelijk in strafpunten per ronde', () => {
  const rng = seeded(2024);
  const levels = ['hard', 'hard', 'normal', 'normal', 'easy', 'easy'];
  const tot = { hard: 0, normal: 0, easy: 0 };
  const n = 300;
  for (let r = 0; r < n; r++) {
    const sc = playRound(levels, rng);
    sc.forEach((s, i) => { tot[levels[i]] += s; });
  }
  const avg = (k) => tot[k] / (n * 2);
  console.log(`  gemiddeld per speler per ronde: slim ${avg('hard').toFixed(1)} · normaal ${avg('normal').toFixed(1)} · makkelijk ${avg('easy').toFixed(1)}`);
  assert.ok(avg('hard') < avg('easy') * 0.85, 'slim is duidelijk beter dan makkelijk');
  assert.ok(avg('normal') < avg('easy'), 'normaal is beter dan makkelijk');
  assert.ok(avg('hard') <= avg('normal') + 0.3, 'slim is minstens zo goed als normaal');
});
