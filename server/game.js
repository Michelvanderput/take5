'use strict';
// Pure game engine voor Take 5! (6 nimmt!). Geen netwerk, geen timers.

const MAX_ROW = 5;
const HAND_SIZE = 10;
const ROWS = 4;

function cardPoints(n) {
  if (n === 55) return 7;
  if (n % 11 === 0) return 5;
  if (n % 10 === 0) return 3;
  if (n % 5 === 0) return 2;
  return 1;
}

const sumPoints = (cards) => cards.reduce((s, c) => s + cardPoints(c), 0);

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  /**
   * @param {{id:string}[]} players  2-10 spelers
   * @param {{targetScore?:number, rng?:Function}} opts
   */
  constructor(players, opts = {}) {
    if (players.length < 2 || players.length > 10) throw new Error('2-10 spelers vereist');
    this.rng = opts.rng || Math.random;
    this.targetScore = opts.targetScore || 66;
    this.players = players.map((p) => ({
      id: p.id,
      hand: [],
      pile: [], // strafkaarten van deze ronde
      score: 0, // totaal na afgeronde rondes
    }));
    this.round = 0;
    this.rows = [];
    this.phase = 'idle'; // choosing | resolving | chooseRow | roundEnd | gameOver
    this.chosen = {}; // playerId -> kaart (geheim)
    this.turnCards = []; // gesorteerd, onthuld: {playerId, card, done}
    this.cursor = 0;
    this.waitingFor = null;
    this.lastEvent = null;
    this.eventSeq = 0;
    this.winners = [];
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  startRound() {
    this.round++;
    const deck = shuffle(Array.from({ length: 104 }, (_, i) => i + 1), this.rng);
    for (const p of this.players) {
      p.hand = deck.splice(0, HAND_SIZE).sort((a, b) => a - b);
      p.pile = [];
    }
    this.rows = [];
    for (let i = 0; i < ROWS; i++) this.rows.push([deck.shift()]);
    this._startChoosing();
  }

  _startChoosing() {
    this.phase = 'choosing';
    this.chosen = {};
    this.turnCards = [];
    this.cursor = 0;
    this.waitingFor = null;
  }

  /** Speler kiest geheim een kaart. Geeft true terug als alle spelers gekozen hebben. */
  submit(playerId, card) {
    if (this.phase !== 'choosing') throw new Error('Nu niet mogelijk');
    const p = this.player(playerId);
    if (!p) throw new Error('Onbekende speler');
    if (this.chosen[playerId] !== undefined) throw new Error('Al gekozen');
    if (!p.hand.includes(card)) throw new Error('Kaart niet in hand');
    this.chosen[playerId] = card;
    return this.allChosen();
  }

  allChosen() {
    return this.players.every((p) => this.chosen[p.id] !== undefined);
  }

  /** Onthul alle kaarten en sorteer van laag naar hoog. */
  reveal() {
    if (this.phase !== 'choosing' || !this.allChosen()) throw new Error('Niet iedereen heeft gekozen');
    this.turnCards = this.players
      .map((p) => ({ playerId: p.id, card: this.chosen[p.id], done: false }))
      .sort((a, b) => a.card - b.card);
    for (const p of this.players) p.hand = p.hand.filter((c) => c !== this.chosen[p.id]);
    this.cursor = 0;
    this.phase = 'resolving';
  }

  /** Index van de rij met het kleinste positieve verschil, of -1 als de kaart te laag is. */
  targetRow(card) {
    let best = -1;
    let bestDiff = Infinity;
    this.rows.forEach((row, i) => {
      const diff = card - row[row.length - 1];
      if (diff > 0 && diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }

  /** Goedkoopste rij (voor bots / afwezige spelers). */
  cheapestRow() {
    let best = 0;
    let bestPts = Infinity;
    this.rows.forEach((row, i) => {
      const pts = sumPoints(row);
      if (pts < bestPts) {
        bestPts = pts;
        best = i;
      }
    });
    return best;
  }

  _emit(ev) {
    this.lastEvent = { seq: ++this.eventSeq, ...ev };
    return this.lastEvent;
  }

  /**
   * Verwerk de volgende kaart. Geeft het event terug.
   * type: 'place' | 'sixth' | 'needRow' | 'turnEnd' | 'roundEnd' | 'gameOver'
   */
  step() {
    if (this.phase !== 'resolving') throw new Error('Niets te verwerken');
    if (this.cursor >= this.turnCards.length) return this._finishTurn();

    const tc = this.turnCards[this.cursor];
    const row = this.targetRow(tc.card);
    if (row === -1) {
      this.phase = 'chooseRow';
      this.waitingFor = tc.playerId;
      return this._emit({ type: 'needRow', playerId: tc.playerId, card: tc.card });
    }
    const p = this.player(tc.playerId);
    let ev;
    if (this.rows[row].length >= MAX_ROW) {
      const taken = this.rows[row];
      p.pile.push(...taken);
      this.rows[row] = [tc.card];
      ev = { type: 'sixth', playerId: p.id, card: tc.card, row, taken, points: sumPoints(taken) };
    } else {
      this.rows[row].push(tc.card);
      ev = { type: 'place', playerId: p.id, card: tc.card, row };
    }
    tc.done = true;
    this.cursor++;
    return this._emit(ev);
  }

  /** Speler met te lage kaart kiest een rij om op te ruimen. */
  chooseRow(playerId, rowIndex) {
    if (this.phase !== 'chooseRow' || this.waitingFor !== playerId) throw new Error('Nu niet mogelijk');
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= ROWS) throw new Error('Ongeldige rij');
    const tc = this.turnCards[this.cursor];
    const p = this.player(playerId);
    const taken = this.rows[rowIndex];
    p.pile.push(...taken);
    this.rows[rowIndex] = [tc.card];
    tc.done = true;
    this.cursor++;
    this.waitingFor = null;
    this.phase = 'resolving';
    return this._emit({
      type: 'take', playerId, card: tc.card, row: rowIndex, taken, points: sumPoints(taken),
    });
  }

  _finishTurn() {
    const handsEmpty = this.players.every((p) => p.hand.length === 0);
    if (!handsEmpty) {
      this._startChoosing();
      return this._emit({ type: 'turnEnd' });
    }
    // Einde ronde: tel strafpunten bij totaal.
    const roundPoints = {};
    for (const p of this.players) {
      roundPoints[p.id] = sumPoints(p.pile);
      p.score += roundPoints[p.id];
    }
    this.turnCards = [];
    this.cursor = 0;
    if (this.players.some((p) => p.score >= this.targetScore)) {
      const min = Math.min(...this.players.map((p) => p.score));
      this.winners = this.players.filter((p) => p.score === min).map((p) => p.id);
      this.phase = 'gameOver';
      return this._emit({ type: 'gameOver', roundPoints, winners: this.winners });
    }
    this.phase = 'roundEnd';
    return this._emit({ type: 'roundEnd', roundPoints });
  }
}

module.exports = { Game, cardPoints, sumPoints, shuffle, MAX_ROW, HAND_SIZE, ROWS };
