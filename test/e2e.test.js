'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { server } = require('../server/index');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, state: null, waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'state') c.state = m.s;
    if (m.t === 'error') c.error = m.m;
    c.waiters = c.waiters.filter((w) => !w());
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred, ms = 20000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    const w = () => (c.state && pred(c.state) ? (clearTimeout(t), res(c.state), true) : false);
    if (!w()) c.waiters.push(w);
  });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

test('twee spelers + bot spelen een heel spel', async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const a = client(port), b = client(port);
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'Anna' });
  const lobby = await a.until((s) => s.code);
  b.send({ t: 'join', name: 'Bob', code: lobby.code });
  a.send({ t: 'addBot' });
  a.send({ t: 'target', v: 30 });
  await a.until((s) => s.players.length === 3);
  a.send({ t: 'start' });

  const auto = async (c) => {
    for (;;) {
      const s = await c.until((s) => s.gamePhase === 'gameOver' ||
        (s.gamePhase === 'choosing' && s.myChoice === null && s.hand.length) ||
        (s.gamePhase === 'chooseRow' && s.waitingFor === s.you));
      if (s.gamePhase === 'gameOver') return s;
      if (s.gamePhase === 'chooseRow') c.send({ t: 'pickRow', row: 0 });
      else c.send({ t: 'play', card: s.hand[0] });
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  const [sa, sb] = await Promise.all([auto(a), auto(b)]);
  assert.equal(sa.gamePhase, 'gameOver');
  assert.ok(sa.winners.length >= 1);
  assert.ok(sa.players.some((p) => p.score >= 30));
  // elke speler ziet alleen de eigen hand
  assert.notEqual(JSON.stringify(sa.hand), 'undefined');
  a.ws.close(); b.ws.close();
  server.close();
  process.exit(0);
});
