'use strict';
// Bots. Ze gebruiken alleen openbare informatie: het bord, de strafstapels (= alle kaarten die al gespeeld zijn),
// hun eigen hand en bij het kiezen van een rij de al onthulde kaarten van deze beurt. Nooit andermans hand.
const { sumPoints } = require('./game');

const LEVELS = ['easy', 'normal', 'hard'];
const NOISE = { easy: Infinity, normal: 1.6, hard: 0.12 }; // hoe 'vergeetachtig' de bot is (in koeienkoppen)

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

function seenCards(g, hand) {
  const seen = new Set(hand);
  for (const row of g.rows) for (const c of row) seen.add(c);
  for (const p of g.players) for (const c of p.pile) seen.add(c);
  return seen;
}

/** P(X >= k) voor X ~ Poisson(lambda) */
function poissonTail(lambda, k) {
  if (k <= 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

/** Verwachte straf (in koeienkoppen) als deze bot kaart `c` speelt. */
function cardCost(g, hand, seen, c) {
  const unseen = 104 - seen.size;
  const others = g.players.length - 1;
  let target = -1;
  let best = Infinity;
  g.rows.forEach((row, i) => {
    const d = c - row[row.length - 1];
    if (d > 0 && d < best) { best = d; target = i; }
  });
  if (target === -1) {
    // te laag: je moet een rij nemen. Wordt later in het spel alleen maar erger.
    return 0.9 * Math.min(...g.rows.map(sumPoints)) + 1;
  }
  const row = g.rows[target];
  const last = row[row.length - 1];
  let gap = 0;
  for (let n = last + 1; n < c; n++) if (!seen.has(n)) gap++;
  // elke andere speler legt één ongeziene kaart; kans dat er genoeg in mijn 'gat' vallen om de rij vol te maken
  const lambda = (gap * others) / Math.max(1, unseen);
  const pFull = poissonTail(lambda, 5 - row.length);
  return pFull * (sumPoints(row) + 2) + (row.length === 4 ? 0.25 : 0); // net niet de 5e: dan ben je volgende keer kwetsbaar
}

function chooseCard(g, id, level = 'normal', rng = Math.random) {
  const hand = g.player(id).hand;
  if (level === 'easy' || !NOISE[level]) return hand[Math.floor(rng() * hand.length)];
  const seen = seenCards(g, hand);
  let pick = hand[0];
  let bestScore = Infinity;
  for (const c of hand) {
    const score = cardCost(g, hand, seen, c) + gauss(rng) * NOISE[level];
    if (score < bestScore) { bestScore = score; pick = c; }
  }
  return pick;
}

/** Wat gebeurt er met de andere spelers als de rest van de onthulde kaarten na de mijne wordt gelegd? */
function othersLoss(rows, idx, card, rest) {
  const R = rows.map((r) => r.slice());
  R[idx] = [card];
  let loss = 0;
  for (const c of rest) {
    let t = -1;
    let best = Infinity;
    R.forEach((r, i) => { const d = c - r[r.length - 1]; if (d > 0 && d < best) { best = d; t = i; } });
    if (t === -1) {
      let ci = 0;
      R.forEach((r, i) => { if (sumPoints(r) < sumPoints(R[ci])) ci = i; });
      loss += sumPoints(R[ci]);
      R[ci] = [c];
    } else if (R[t].length >= 5) {
      loss += sumPoints(R[t]);
      R[t] = [c];
    } else R[t].push(c);
  }
  return loss;
}

/** Rij kiezen bij een te lage kaart. */
function chooseRow(g, id, level = 'normal', rng = Math.random) {
  const pts = g.rows.map(sumPoints);
  if (level === 'easy' || !NOISE[level]) return g.cheapestRow();
  const tc = g.turnCards[g.cursor];
  const rest = g.turnCards.slice(g.cursor + 1).map((t) => t.card); // zijn al onthuld, dus openbaar
  let pick = 0;
  let bestScore = Infinity;
  g.rows.forEach((row, i) => {
    let score = pts[i] + gauss(rng) * NOISE[level];
    if (level === 'hard' && tc) score -= 0.35 * othersLoss(g.rows, i, tc.card, rest); // liefst een rij waar anderen straks in lopen
    if (score < bestScore) { bestScore = score; pick = i; }
  });
  return pick;
}

module.exports = { LEVELS, chooseCard, chooseRow, cardCost, seenCards };
