'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, sumPoints } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const STEP_MS = +process.env.STEP_MS || 1100; // pauze tussen het neerleggen van kaarten (animatie)
const TURN_MS = 60000; // bedenktijd per beurt
const ROW_MS = 30000; // bedenktijd om een rij te kiezen
const ROUND_BREAK_MS = 9000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.normalize(path.join(PUBLIC, file));
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404).end('Niet gevonden');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4096 });

/** @type {Map<string, Room>} */
const rooms = new Map();

const BOT_NAMES = ['Koe Klaas', 'Bella', 'Dolly', 'Muu-ke', 'Gerda', 'Stier Piet', 'Lotte', 'Daisy', 'Henk'];

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(c)) return c;
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.members = []; // {id, token, name, bot, ws, connected}
    this.hostId = null;
    this.game = null;
    this.phase = 'lobby'; // lobby | game
    this.targetScore = 66;
    this.timer = null;
    this.deadline = null;
    this.lastActivity = Date.now();
  }

  member(id) {
    return this.members.find((m) => m.id === id);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  after(ms, fn) {
    this.clearTimer();
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }, ms);
  }

  // Bots en afwezige spelers worden automatisch gespeeld.
  isAuto(id) {
    const m = this.member(id);
    return !m || m.bot || !m.connected;
  }

  pickCard(playerId) {
    const hand = this.game.player(playerId).hand;
    return hand[Math.floor(Math.random() * hand.length)];
  }

  startGame() {
    this.phase = 'game';
    this.game = new Game(this.members.map((m) => ({ id: m.id })), { targetScore: this.targetScore });
    this.game.startRound();
    this.afterChoosingStart();
  }

  afterChoosingStart() {
    const g = this.game;
    for (const p of g.players) {
      if (this.isAuto(p.id) && g.chosen[p.id] === undefined) {
        // kleine vertraging zodat het niet instant lijkt
        g.chosen[p.id] = this.pickCard(p.id);
      }
    }
    if (g.allChosen()) return this.beginResolve();
    this.after(TURN_MS, () => this.forceChoices());
    this.broadcast();
  }

  forceChoices() {
    const g = this.game;
    if (g.phase !== 'choosing') return;
    for (const p of g.players) {
      if (g.chosen[p.id] === undefined) g.chosen[p.id] = this.pickCard(p.id);
    }
    this.beginResolve();
  }

  beginResolve() {
    this.game.reveal();
    this.broadcast();
    this.after(STEP_MS, () => this.step());
  }

  step() {
    const g = this.game;
    const ev = g.step();
    switch (ev.type) {
      case 'needRow':
        if (this.isAuto(ev.playerId)) {
          this.after(STEP_MS, () => this.autoRow(ev.playerId));
        } else {
          this.after(ROW_MS, () => this.autoRow(ev.playerId));
        }
        break;
      case 'place':
      case 'sixth':
      case 'take':
        this.after(STEP_MS, () => this.step());
        break;
      case 'turnEnd':
        this.broadcast();
        return this.afterChoosingStart();
      case 'roundEnd':
        this.after(ROUND_BREAK_MS, () => {
          g.startRound();
          this.afterChoosingStart();
        });
        break;
      case 'gameOver':
        this.clearTimer();
        break;
    }
    this.broadcast();
  }

  autoRow(playerId) {
    const g = this.game;
    if (g.phase !== 'chooseRow' || g.waitingFor !== playerId) return;
    g.chooseRow(playerId, g.cheapestRow());
    this.broadcast();
    this.after(STEP_MS, () => this.step());
  }

  // ---- weergave ----
  view(forId) {
    const g = this.game;
    const players = this.members.map((m) => {
      const gp = g && g.player(m.id);
      return {
        id: m.id,
        name: m.name,
        bot: m.bot,
        connected: m.connected,
        score: gp ? gp.score : 0,
        roundPoints: gp ? sumPoints(gp.pile) : 0,
        handCount: gp ? gp.hand.length : 0,
        hasChosen: g ? g.chosen[m.id] !== undefined || g.phase !== 'choosing' : false,
      };
    });
    const v = {
      code: this.code,
      you: forId,
      hostId: this.hostId,
      phase: this.phase,
      targetScore: this.targetScore,
      players,
      deadline: this.deadline,
    };
    if (g) {
      Object.assign(v, {
        gamePhase: g.phase,
        round: g.round,
        rows: g.rows,
        hand: g.player(forId) ? g.player(forId).hand : [],
        myChoice: g.chosen[forId] ?? null,
        turnCards: g.phase === 'choosing' ? [] : g.turnCards,
        cursor: g.cursor,
        waitingFor: g.waitingFor,
        lastEvent: g.lastEvent,
        winners: g.winners,
      });
    }
    return v;
  }

  broadcast() {
    this.lastActivity = Date.now();
    for (const m of this.members) {
      if (m.ws && m.ws.readyState === 1) m.ws.send(JSON.stringify({ t: 'state', s: this.view(m.id) }));
    }
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function cleanName(n) {
  return String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Speler';
}

wss.on('connection', (ws) => {
  let room = null;
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const err = (m) => send(ws, { t: 'error', m });

  const attach = (r, m) => {
    room = r;
    me = m;
    m.ws = ws;
    m.connected = true;
    send(ws, { t: 'joined', code: r.code, token: m.token, id: m.id });
    r.broadcast();
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handle(msg);
    } catch (e) {
      err(e.message);
    }
  });

  function handle(msg) {
    switch (msg.t) {
      case 'create': {
        const r = new Room(makeCode());
        rooms.set(r.code, r);
        const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(msg.name), bot: false };
        r.members.push(m);
        r.hostId = m.id;
        return attach(r, m);
      }
      case 'join': {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        if (!r) throw new Error('Kamer niet gevonden');
        if (r.phase !== 'lobby') throw new Error('Het spel is al begonnen');
        if (r.members.length >= 10) throw new Error('Kamer is vol (max 10)');
        const m = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(msg.name), bot: false };
        r.members.push(m);
        return attach(r, m);
      }
      case 'resume': {
        const r = rooms.get(String(msg.code || '').toUpperCase());
        const m = r && r.members.find((x) => x.token === msg.token);
        if (!m) throw new Error('Sessie verlopen');
        if (m.ws && m.ws !== ws) m.ws.close();
        return attach(r, m);
      }
    }
    if (!room || !me) throw new Error('Niet in een kamer');
    const g = room.game;
    switch (msg.t) {
      case 'addBot': {
        if (room.hostId !== me.id || room.phase !== 'lobby') throw new Error('Niet toegestaan');
        if (room.members.length >= 10) throw new Error('Kamer is vol');
        const used = new Set(room.members.map((x) => x.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot' + room.members.length;
        room.members.push({ id: crypto.randomUUID(), token: null, name, bot: true, connected: true });
        return room.broadcast();
      }
      case 'kick': {
        if (room.hostId !== me.id || room.phase !== 'lobby') throw new Error('Niet toegestaan');
        const k = room.member(msg.id);
        if (!k || k.id === me.id) return;
        room.members = room.members.filter((x) => x !== k);
        if (k.ws) {
          send(k.ws, { t: 'kicked' });
          k.ws.close();
        }
        return room.broadcast();
      }
      case 'target': {
        if (room.hostId !== me.id || room.phase !== 'lobby') throw new Error('Niet toegestaan');
        room.targetScore = [30, 45, 66, 100].includes(msg.v) ? msg.v : 66;
        return room.broadcast();
      }
      case 'start': {
        if (room.hostId !== me.id) throw new Error('Alleen de host kan starten');
        if (room.phase !== 'lobby') throw new Error('Al gestart');
        if (room.members.length < 2) throw new Error('Minimaal 2 spelers (voeg desnoods een bot toe)');
        return room.startGame();
      }
      case 'play': {
        if (!g) throw new Error('Spel is niet gestart');
        const all = g.submit(me.id, msg.card);
        if (all) {
          room.clearTimer();
          return room.beginResolve();
        }
        return room.broadcast();
      }
      case 'pickRow': {
        if (!g) throw new Error('Spel is niet gestart');
        g.chooseRow(me.id, msg.row);
        room.broadcast();
        return room.after(STEP_MS, () => room.step());
      }
      case 'rematch': {
        if (room.hostId !== me.id || !g || g.phase !== 'gameOver') throw new Error('Niet toegestaan');
        room.game = null;
        room.phase = 'lobby';
        return room.broadcast();
      }
      case 'leave':
        return leave(true);
    }
  }

  function leave(explicit) {
    if (!room || !me) return;
    const r = room;
    const m = me;
    room = me = null;
    if (m.ws === ws) {
      m.connected = false;
      m.ws = null;
    }
    if (r.phase === 'lobby' || explicit) {
      if (r.phase === 'lobby') r.members = r.members.filter((x) => x !== m);
      else m.bot = true; // vertrokken speler wordt overgenomen door een bot
    }
    const humans = r.members.filter((x) => !x.bot);
    if (r.phase === 'lobby' && humans.length === 0) {
      rooms.delete(r.code);
      return;
    }
    if (r.hostId === m.id) {
      const next = humans.find((x) => x.connected) || humans[0];
      if (next) r.hostId = next.id;
    }
    r.broadcast();
    // Wachten we op iemand die net weg is? Dan automatisch doorgaan.
    const g = r.game;
    if (g && g.phase === 'choosing' && r.isAuto(m.id) && g.chosen[m.id] === undefined) {
      g.chosen[m.id] = r.pickCard(m.id);
      if (g.allChosen()) {
        r.clearTimer();
        r.beginResolve();
      }
    } else if (g && g.phase === 'chooseRow' && g.waitingFor === m.id) {
      r.after(STEP_MS, () => r.autoRow(m.id));
    }
  }

  ws.on('close', () => leave(false));
});

// Heartbeat + opruimen van oude kamers.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  for (const [code, r] of rooms) {
    const anyone = r.members.some((m) => m.connected && !m.bot);
    if (!anyone && Date.now() - r.lastActivity > 30 * 60 * 1000) {
      r.clearTimer();
      rooms.delete(code);
    }
  }
}, 30000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Take 5! draait op http://localhost:${PORT}`));
}

module.exports = { server, rooms };
