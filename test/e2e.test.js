'use strict';
process.env.STEP_MS = '5';
const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../server/api');
const { memoryStore, sqlStore } = require('../server/store');

async function stopTest(store) {
  const call = async (p, body) => (await handle(store, { ...(p && { code: p.code, token: p.token, pid: p.id }), ...body }));
  const a = (await call(null, { t: 'create', name: 'Anna' })).json;
  const b = (await call(null, { t: 'join', code: a.code, name: 'Bob' })).json;
  const pa = { code: a.code, token: a.token, id: a.id };
  const pb = { code: a.code, token: b.token, id: b.id };
  assert.equal((await call(pa, { t: 'start' })).status, 400); // nog niet iedereen ready
  await call(pa, { t: 'ready', v: true }); await call(pb, { t: 'ready', v: true });
  await call(pa, { t: 'start' });
  assert.equal((await call(pb, { t: 'stop' })).status, 400); // alleen host
  assert.equal((await call(pa, { t: 'stop' })).status, 200);
  const s = (await call(pb, { t: 'poll' })).json.state;
  assert.equal(s.phase, 'lobby');
  assert.ok(s.players.every((p) => !p.ready)); // na stoppen opnieuw ready worden
  await call(pa, { t: 'ready', v: true }); await call(pb, { t: 'ready', v: true });
  await call(pa, { t: 'start' });
  const l = await call(pb, { t: 'leave' }); // midden in het spel: bot neemt over
  assert.equal(l.status, 200);
  const s2 = (await call(pa, { t: 'poll' })).json.state;
  assert.ok(s2.players.find((p) => p.name === 'Bob').bot);
}

async function kickTest(store) {
  // zoals de browser het stuurt: eigen id als `pid`, het doelwit als `id`
  const a = (await handle(store, { t: 'create', name: 'Anna' })).json;
  const b = (await handle(store, { t: 'join', code: a.code, name: 'Bob' })).json;
  const me = { code: a.code, token: a.token, pid: a.id };
  const r = await handle(store, { ...me, t: 'kick', id: b.id });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.players.length, 1);
  assert.equal((await handle(store, { t: 'poll', code: a.code, token: b.token, pid: b.id })).status, 400); // Bob is eruit
}

test('host kan spelers verwijderen (zoals de browser het stuurt)', () => kickTest(memoryStore()));
test('host kan spel stoppen, speler kan verlaten', () => stopTest(memoryStore()));

async function run(store) {
  const call = async (p, body) => {
    const r = await handle(store, { ...(p && { code: p.code, token: p.token, pid: p.id }), ...body });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const a = await call(null, { t: 'create', name: 'Anna' });
  const pa = { code: a.code, token: a.token, id: a.id };
  const b = await call(null, { t: 'join', code: a.code, name: 'Bob' });
  const pb = { code: a.code, token: b.token, id: b.id };
  await call(pa, { t: 'addBot' });
  await call(pa, { t: 'target', v: 30 });
  assert.equal((await call(pb, { t: 'poll' })).state.players.length, 3);
  assert.equal((await handle(store, { t: 'start', ...pb })).status, 400); // geen host
  await call(pa, { t: 'ready', v: true }); await call(pb, { t: 'ready', v: true });
  await call(pa, { t: 'start' });

  let s;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const p of [pa, pb]) {
      s = (await call(p, { t: 'poll' })).state;
      if (s.gamePhase === 'gameOver') break;
      assert.ok(!(s.gamePhase === 'choosing' && s.hand.length === 1), 'laatste kaart moet automatisch gespeeld worden');
      if (s.gamePhase === 'choosing' && s.myChoice === null) await call(p, { t: 'play', card: s.hand[0] });
      else if (s.gamePhase === 'chooseRow' && s.waitingFor === s.you) await call(p, { t: 'pickRow', row: 0 });
    }
    if (s.gamePhase === 'gameOver') break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(s.gamePhase, 'gameOver');
  assert.ok(s.winners.length >= 1);
  assert.ok(s.players.some((p) => p.score >= 30));
  // je ziet alleen je eigen hand, nooit andermans token/hand
  assert.ok(!JSON.stringify(s).includes(b.token));
  assert.equal((await handle(store, { t: 'poll', code: a.code, token: 'fout' })).status, 400);
}

test('heel spel via de API (geheugen)', () => run(memoryStore()));

// Optioneel tegen echte Postgres: TEST_PG_URL=postgres://... npm test
test('heel spel via de API (Postgres)', { skip: !process.env.TEST_PG_URL }, async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.TEST_PG_URL });
  await c.connect();
  await run(sqlStore(async (t, p) => (await c.query(t, p)).rows));
  await c.end();
});
