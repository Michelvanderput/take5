'use strict';
// Stateless kamerlogica: alle state is JSON, tijd-gestuurde acties lopen via `tick`.
const crypto = require('crypto');
const { Game, sumPoints } = require('./game');

const T = {
  STEP: +process.env.STEP_MS || 1000, // pauze tussen kaarten (animatie)
  TURN: 60000, // bedenktijd per beurt
  ROW: 30000, // bedenktijd om een rij te kiezen
  BREAK: 9000, // pauze tussen rondes
};
const PRESENCE_MS = 12000;
// Na het nemen van een rij heeft de animatie meer tijd nodig: hoe meer punten, hoe dramatischer.
const takeMs = (pts) => Math.round(T.STEP * 1.9 + Math.min(pts, 25) * T.STEP * 0.02);
const BOT_NAMES = ['Koe Klaas', 'Bella', 'Dolly', 'Muu-ke', 'Gerda', 'Stier Piet', 'Lotte', 'Daisy', 'Henk'];

const hydrate = (d) => Object.assign(Object.create(Game.prototype), d, { rng: Math.random });
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Speler';
const connected = (s, m, ctx) => m.bot || (ctx.seen[m.id] && ctx.now - ctx.seen[m.id] < PRESENCE_MS);
const isAuto = (s, id, ctx) => {
  const m = s.members.find((x) => x.id === id);
  return !m || m.bot || !connected(s, m, ctx);
};
const pick = (g, id) => {
  const h = g.player(id).hand;
  return h[Math.floor(Math.random() * h.length)];
};
const schedule = (s, now, ms, action) => {
  s.nextAt = now + ms;
  s.nextAction = action;
};

function newRoom(code, hostName) {
  const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(hostName), bot: false };
  return {
    state: { code, version: 0, hostId: m.id, members: [m], phase: 'lobby', targetScore: 66, game: null, nextAt: null, nextAction: null },
    member: m,
  };
}

function settleChoosing(s, ctx) {
  const g = s.game;
  if (g.phase !== 'choosing') return;
  for (const p of g.players) {
    if (g.chosen[p.id] !== undefined) continue;
    if (p.hand.length === 1) g.chosen[p.id] = p.hand[0]; // laatste kaart: geen keuze, automatisch
    else if (isAuto(s, p.id, ctx)) g.chosen[p.id] = pick(g, p.id);
  }
  if (g.allChosen()) {
    g.reveal();
    schedule(s, ctx.now, T.STEP, 'step');
  }
}

function runAction(s, ctx) {
  const g = s.game;
  const now = ctx.now;
  switch (s.nextAction) {
    case 'force':
      if (g.phase !== 'choosing') break;
      for (const p of g.players) if (g.chosen[p.id] === undefined) g.chosen[p.id] = pick(g, p.id);
      g.reveal();
      schedule(s, now, T.STEP, 'step');
      return;
    case 'autoRow':
      if (g.phase === 'chooseRow') {
        const tev = g.chooseRow(g.waitingFor, g.cheapestRow());
        schedule(s, now, takeMs(tev.points), 'step');
        return;
      }
      break;
    case 'nextRound':
      g.startRound();
      schedule(s, now, T.TURN, 'force');
      return;
    case 'step': {
      if (g.phase !== 'resolving') break;
      const ev = g.step();
      if (ev.type === 'needRow') schedule(s, now, isAuto(s, ev.playerId, ctx) ? T.STEP : T.ROW, 'autoRow');
      else if (ev.type === 'turnEnd') schedule(s, now, T.TURN, 'force');
      else if (ev.type === 'roundEnd') schedule(s, now, T.BREAK, 'nextRound');
      else if (ev.type === 'gameOver') s.nextAt = s.nextAction = null;
      else if (ev.type === 'sixth') schedule(s, now, takeMs(ev.points), 'step');
      else schedule(s, now, T.STEP, 'step');
      return;
    }
  }
  s.nextAt = s.nextAction = null;
}

/** Laat tijd-gestuurde dingen gebeuren: bots/afwezigen spelen, deadlines verlopen. */
function tick(s, ctx) {
  const g = s.game;
  if (!g) return;
  settleChoosing(s, ctx);
  if (g.phase === 'chooseRow' && isAuto(s, g.waitingFor, ctx) && s.nextAt - ctx.now > T.STEP) {
    schedule(s, ctx.now, T.STEP, 'autoRow');
  }
  if (s.nextAt && ctx.now >= s.nextAt) {
    runAction(s, ctx);
    settleChoosing(s, ctx);
  }
}

function view(s, forId, ctx) {
  const g = s.game;
  const players = s.members.map((m) => {
    const gp = g && g.player(m.id);
    return {
      id: m.id, name: m.name, bot: m.bot, connected: !!connected(s, m, ctx),
      score: gp ? gp.score : 0,
      roundPoints: gp ? sumPoints(gp.pile) : 0,
      handCount: gp ? gp.hand.length : 0,
      hasChosen: g ? g.chosen[m.id] !== undefined || g.phase !== 'choosing' : false,
    };
  });
  const v = {
    v: s.version, code: s.code, you: forId, hostId: s.hostId, phase: s.phase,
    targetScore: s.targetScore, players, deadline: s.nextAt, now: ctx.now,
  };
  if (g) {
    const mine = g.player(forId);
    Object.assign(v, {
      gamePhase: g.phase, round: g.round, rows: g.rows,
      hand: mine ? mine.hand : [], myChoice: g.chosen[forId] ?? null,
      turnCards: g.phase === 'choosing' ? [] : g.turnCards,
      cursor: g.cursor, waitingFor: g.waitingFor, lastEvent: g.lastEvent, winners: g.winners,
    });
  }
  return v;
}

/** Voer een client-bericht uit op de state. Gooit Error bij ongeldige actie. */
function apply(s, me, body, ctx) {
  const host = () => {
    if (s.hostId !== me.id) throw new Error('Alleen de host kan dit');
  };
  const g = s.game;
  switch (body.t) {
    case 'poll':
    case 'resume':
      return;
    case 'addBot': {
      host();
      if (s.phase !== 'lobby') throw new Error('Spel is al gestart');
      if (s.members.length >= 10) throw new Error('Kamer is vol');
      const used = new Set(s.members.map((x) => x.name));
      const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + s.members.length;
      s.members.push({ id: crypto.randomUUID(), token: null, name, bot: true });
      return;
    }
    case 'kick': {
      host();
      if (s.phase !== 'lobby') throw new Error('Spel is al gestart');
      if (body.id !== me.id) s.members = s.members.filter((x) => x.id !== body.id);
      return;
    }
    case 'target':
      host();
      if (s.phase !== 'lobby') throw new Error('Spel is al gestart');
      s.targetScore = [30, 45, 66, 100].includes(body.v) ? body.v : 66;
      return;
    case 'start':
      host();
      if (s.phase !== 'lobby') throw new Error('Al gestart');
      if (s.members.length < 2) throw new Error('Minimaal 2 spelers (voeg desnoods een bot toe)');
      s.phase = 'game';
      s.game = new Game(s.members.map((m) => ({ id: m.id })), { targetScore: s.targetScore });
      s.game.startRound();
      schedule(s, ctx.now, T.TURN, 'force');
      return;
    case 'play':
      if (!g) throw new Error('Spel is niet gestart');
      g.submit(me.id, body.card);
      return;
    case 'pickRow':
      if (!g) throw new Error('Spel is niet gestart');
      schedule(s, ctx.now, takeMs(g.chooseRow(me.id, body.row).points), 'step');
      return;
    case 'stop':
      host();
      if (s.phase !== 'game') throw new Error('Er loopt geen spel');
      s.game = null;
      s.phase = 'lobby';
      s.nextAt = s.nextAction = null;
      return;
    case 'rematch':
      host();
      if (!g || g.phase !== 'gameOver') throw new Error('Spel is nog bezig');
      s.game = null;
      s.phase = 'lobby';
      s.nextAt = s.nextAction = null;
      return;
    case 'leave': {
      if (s.phase === 'lobby') s.members = s.members.filter((x) => x !== me);
      else me.bot = true; // een bot neemt het over
      if (s.hostId === me.id) {
        const next = s.members.find((x) => !x.bot);
        if (next) s.hostId = next.id;
      }
      return;
    }
    default:
      throw new Error('Onbekende actie');
  }
}

module.exports = { newRoom, apply, tick, view, hydrate, cleanName, T };
