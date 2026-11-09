'use strict';
process.env.STEP_MS = '5';
const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../server/api');
const { memoryStore } = require('../server/store');

// Hulpmiddelen: een "client" die zich gedraagt als de browser (code, token, pid + actie).
function world() {
  const store = memoryStore();
  let now = 1_000_000;
  const api = async (who, body) => {
    const r = await handle(store, { ...(who && { code: who.code, token: who.token, pid: who.id }), ...body }, now);
    return { ok: r.status === 200, ...r.json };
  };
  const must = async (who, body) => {
    const r = await api(who, body);
    assert.ok(r.ok, `${body.t} faalde: ${r.error}`);
    return r;
  };
  const fail = async (who, body, re) => {
    const r = await api(who, body);
    assert.ok(!r.ok, `${body.t} had moeten falen`);
    if (re) assert.match(r.error, re);
  };
  const make = async (name) => {
    const r = await must(null, { t: 'create', name });
    return { code: r.code, token: r.token, id: r.id, name };
  };
  const join = async (host, name) => {
    const r = await must(null, { t: 'join', code: host.code, name });
    return { code: host.code, token: r.token, id: r.id, name };
  };
  const state = async (who) => (await must(who, { t: 'poll' })).state;
  const tick = (ms) => { now += ms; };
  return { store, api, must, fail, make, join, state, tick, now: () => now };
}

test('kamer maken en deelnemen', async () => {
  const w = world();
  const host = await w.make('Anna');
  assert.match(host.code, /^[A-Z]{4}$/);
  let s = await w.state(host);
  assert.equal(s.phase, 'lobby');
  assert.equal(s.hostId, host.id);
  assert.equal(s.players.length, 1);

  const bob = await w.join(host, 'Bob');
  s = await w.state(host);
  assert.deepEqual(s.players.map((p) => p.name), ['Anna', 'Bob']);
  // code is niet hoofdlettergevoelig
  const cas = await w.must(null, { t: 'join', code: host.code.toLowerCase(), name: 'Cas' });
  assert.ok(cas.token);
  // naam wordt schoongemaakt en afgekapt, lege naam wordt 'Speler'
  const raar = await w.must(null, { t: 'join', code: host.code, name: '<b>X</b>'.repeat(10) });
  assert.ok(raar.state.players.every((p) => p.name.length <= 20 && !/[<>]/.test(p.name)));
  const lang = await w.must(null, { t: 'join', code: host.code, name: 'Wilhelmina-Alexandra Extra' });
  assert.ok(lang.state.players.some((p) => p.name === 'Wilhelmina-Alexandra'), 'tot 20 tekens blijft staan');
  const leeg = await w.must(null, { t: 'join', code: host.code, name: '   ' });
  assert.ok(leeg.state.players.some((p) => p.name === 'Speler'));
  assert.ok(bob.token);
});

test('foute code, foute sessie, geen host-rechten', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.fail(null, { t: 'join', code: 'ZZZZ', name: 'X' }, /niet gevonden/);
  await w.fail(null, { t: 'join', code: '12', name: 'X' }, /niet gevonden/);
  await w.fail({ ...bob, token: 'fout' }, { t: 'poll' }, /Sessie verlopen/);
  await w.fail(null, { t: 'poll', code: host.code, token: 'x' }, /Sessie verlopen/);
  // alleen de host mag dit
  for (const body of [{ t: 'addBot' }, { t: 'kick', id: host.id }, { t: 'target', v: 30 }, { t: 'start' }, { t: 'stop' }, { t: 'rematch' }]) {
    await w.fail(bob, body, /host|Alleen/);
  }
  await w.fail(host, { t: 'bestaatniet' }, /Onbekende/);
});

test('maximaal 10 spelers', async () => {
  const w = world();
  const host = await w.make('Anna');
  for (let i = 1; i < 10; i++) await w.join(host, 'P' + i);
  assert.equal((await w.state(host)).players.length, 10);
  await w.fail(null, { t: 'join', code: host.code, name: 'Elf' }, /vol/);
  await w.fail(host, { t: 'addBot' }, /vol/);
});

test('bots toevoegen en verwijderen, spelers verwijderen', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.must(host, { t: 'addBot' });
  await w.must(host, { t: 'addBot' });
  let s = await w.state(host);
  assert.equal(s.players.filter((p) => p.bot).length, 2);
  assert.ok(s.players.filter((p) => p.bot).every((p) => p.ready), 'bots zijn altijd ready');

  const bot = s.players.find((p) => p.bot);
  await w.must(host, { t: 'kick', id: bot.id });
  s = await w.state(host);
  assert.equal(s.players.filter((p) => p.bot).length, 1);

  await w.must(host, { t: 'kick', id: bob.id });
  s = await w.state(host);
  assert.ok(!s.players.some((p) => p.id === bob.id));
  await w.fail(bob, { t: 'poll' }, /Sessie verlopen/); // Bob is eruit

  // jezelf verwijderen doet niets
  await w.must(host, { t: 'kick', id: host.id });
  assert.ok((await w.state(host)).players.some((p) => p.id === host.id));
});

test('ready, eindscore en starten', async () => {
  const w = world();
  const host = await w.make('Anna');
  await w.fail(host, { t: 'start' }, /Minimaal 2/);
  const bob = await w.join(host, 'Bob');
  await w.fail(host, { t: 'start' }, /Wachten op/);
  await w.must(host, { t: 'ready', v: true });
  await w.fail(host, { t: 'start' }, /Wachten op Bob/);
  await w.must(bob, { t: 'ready' }); // zonder waarde = omschakelen
  assert.equal((await w.state(bob)).players.find((p) => p.id === bob.id).ready, true);
  await w.must(bob, { t: 'ready', v: false });
  await w.fail(host, { t: 'start' }, /Wachten op Bob/);
  await w.must(bob, { t: 'ready', v: true });

  await w.must(host, { t: 'target', v: 30 });
  assert.equal((await w.state(host)).targetScore, 30);
  await w.must(host, { t: 'target', v: 7 }); // ongeldig -> standaard
  assert.equal((await w.state(host)).targetScore, 66);

  const r = await w.must(host, { t: 'start' });
  assert.equal(r.state.phase, 'game');
  assert.equal(r.state.gamePhase, 'choosing');
  assert.equal(r.state.hand.length, 10);
  assert.equal(r.state.rows.length, 4);
});

test('tijdens het spel: niemand erbij, geen aanpassingen, kaartregels', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.must(host, { t: 'ready', v: true }); await w.must(bob, { t: 'ready', v: true });
  await w.must(host, { t: 'start' });

  await w.fail(null, { t: 'join', code: host.code, name: 'Laat' }, /al begonnen/);
  await w.fail(host, { t: 'addBot' }, /al gestart/);
  await w.fail(host, { t: 'kick', id: bob.id }, /al gestart/);
  await w.fail(host, { t: 'target', v: 30 }, /al gestart/);
  await w.fail(host, { t: 'start' }, /Al gestart/);
  await w.fail(host, { t: 'ready', v: true }, /al gestart/);

  const s = await w.state(host);
  await w.fail(host, { t: 'play', card: 999 }, /niet in hand/);
  await w.must(host, { t: 'play', card: s.hand[0] });
  await w.fail(host, { t: 'play', card: s.hand[1] }, /Al gekozen/);

  // privacy: je ziet alleen je eigen hand, nooit tokens van anderen
  const sb = await w.state(bob);
  const json = JSON.stringify(sb);
  assert.ok(!json.includes(host.token) && !json.includes(bob.token));
  assert.ok(sb.hand.every((c) => !s.hand.includes(c)), 'handen zijn verschillend');
  assert.equal(sb.players.find((p) => p.id === host.id).hasChosen, true);
  assert.equal(sb.myChoice, null);
});

test('spel stoppen: terug naar lobby, iedereen opnieuw ready', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.must(host, { t: 'ready', v: true }); await w.must(bob, { t: 'ready', v: true });
  await w.must(host, { t: 'start' });
  await w.fail(host, { t: 'rematch' }, /nog bezig/);
  await w.must(host, { t: 'stop' });
  let s = await w.state(bob);
  assert.equal(s.phase, 'lobby');
  assert.ok(s.players.every((p) => !p.ready));
  await w.fail(host, { t: 'stop' }, /geen spel/);
  await w.fail(host, { t: 'start' }, /Wachten op/);
  await w.must(host, { t: 'ready', v: true }); await w.must(bob, { t: 'ready', v: true });
  s = (await w.must(host, { t: 'start' })).state;
  assert.equal(s.phase, 'game');
});

test('verlaten: lobby, midden in het spel, host-overdracht', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  const cas = await w.join(host, 'Cas');
  // lobby: speler verdwijnt
  await w.must(cas, { t: 'leave' });
  assert.equal((await w.state(host)).players.length, 2);
  // host verlaat de lobby: Bob wordt host
  const cas2 = await w.join(host, 'Cas2');
  await w.must(host, { t: 'leave' });
  let s = await w.state(bob);
  assert.equal(s.hostId, bob.id);
  assert.equal(s.players.length, 2);
  // in het spel: bot neemt over
  await w.must(bob, { t: 'ready', v: true }); await w.must(cas2, { t: 'ready', v: true });
  await w.must(bob, { t: 'start' });
  await w.must(cas2, { t: 'leave' });
  s = await w.state(bob);
  assert.equal(s.players.find((p) => p.name === 'Cas2').bot, true);
  assert.equal(s.phase, 'game');
});

test('afwezige speler wordt na 12 s automatisch gespeeld; terugkomen kan', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.must(host, { t: 'ready', v: true }); await w.must(bob, { t: 'ready', v: true });
  await w.must(host, { t: 'start' });
  const s0 = await w.state(host);
  await w.must(host, { t: 'play', card: s0.hand[0] });
  w.tick(13000); // Bob doet 13 s niets
  let s = await w.state(host);
  assert.equal(s.players.find((p) => p.id === bob.id).connected, false);
  assert.notEqual(s.gamePhase, 'choosing', 'het spel wacht niet op Bob');
  // Bob komt terug (nieuwe pagina, zelfde sessie) en ziet gewoon het spel
  const back = await w.must(bob, { t: 'resume' });
  assert.equal(back.state.phase, 'game');
  assert.equal(back.state.you, bob.id);
});

test('heel spel tot het einde, dan nog een keer (rematch)', async () => {
  const w = world();
  const host = await w.make('Anna');
  await w.must(host, { t: 'addBot' }); await w.must(host, { t: 'addBot' });
  await w.must(host, { t: 'target', v: 30 });
  await w.must(host, { t: 'ready', v: true });
  await w.must(host, { t: 'start' });
  let s;
  for (let i = 0; i < 4000; i++) {
    w.tick(1500);
    s = await w.state(host);
    if (s.gamePhase === 'gameOver') break;
    if (s.gamePhase === 'choosing' && s.myChoice === null) await w.must(host, { t: 'play', card: s.hand[0] });
    else if (s.gamePhase === 'chooseRow' && s.waitingFor === s.you) await w.must(host, { t: 'pickRow', row: 0 });
  }
  assert.equal(s.gamePhase, 'gameOver');
  assert.ok(s.winners.length >= 1);
  const min = Math.min(...s.players.map((p) => p.score));
  assert.ok(s.winners.every((id) => s.players.find((p) => p.id === id).score === min));
  assert.ok(s.players.some((p) => p.score >= 30));
  await w.must(host, { t: 'rematch' });
  s = await w.state(host);
  assert.equal(s.phase, 'lobby');
  assert.ok(s.players.filter((p) => !p.bot).every((p) => !p.ready));
});

test('chat', async () => {
  const w = world();
  const host = await w.make('Anna');
  const bob = await w.join(host, 'Bob');
  await w.fail(null, { t: 'chat', code: host.code, token: 'x', text: 'hoi' }, /Sessie/);

  await w.must(host, { t: 'chat', text: '  hoi   Bob  ' });
  let s = await w.state(bob);
  assert.equal(s.chat.length, 1);
  assert.deepEqual([s.chat[0].name, s.chat[0].text, s.chat[0].id], ['Anna', 'hoi Bob', host.id]);

  await w.must(host, { t: 'chat', text: '   ' }); // leeg = genegeerd
  assert.equal((await w.state(bob)).chat.length, 1);

  w.tick(100);
  await w.fail(host, { t: 'chat', text: 'spam' }, /Rustig/); // te snel
  w.tick(1000);
  await w.must(host, { t: 'chat', text: 'x'.repeat(500) });
  assert.equal((await w.state(bob)).chat.at(-1).text.length, 200);

  w.tick(1000);
  await w.must(bob, { t: 'chat', text: 'a\u0000b\nc<script>' });
  const last = (await w.state(host)).chat.at(-1);
  assert.equal(last.name, 'Bob');
  assert.equal(last.text, 'a b c<script>'); // tekst blijft tekst; de browser zet hem veilig neer
  const nrs = (await w.state(host)).chat.map((m) => m.n);
  assert.deepEqual(nrs, [...nrs].sort((a, b) => a - b));

  // maximaal 50 berichten bewaard
  for (let i = 0; i < 60; i++) { w.tick(1000); await w.must(i % 2 ? host : bob, { t: 'chat', text: 'm' + i }); }
  s = await w.state(host);
  assert.equal(s.chat.length, 50);
  assert.equal(s.chat.at(-1).text, 'm59');

  // chat werkt ook tijdens het spel
  await w.must(host, { t: 'ready', v: true }); await w.must(bob, { t: 'ready', v: true });
  await w.must(host, { t: 'start' });
  w.tick(1000);
  await w.must(bob, { t: 'chat', text: 'goed bezig' });
  assert.equal((await w.state(host)).chat.at(-1).text, 'goed bezig');
});
