'use strict';
const crypto = require('crypto');
const { newRoom, apply, tick, view, hydrate, cleanName } = require('./room');

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
  return c;
}

/** Verwerkt één client-request. Geeft {status, json} terug. */
async function handle(store, body, now = Date.now()) {
  try {
    if (!body || typeof body !== 'object') throw new Error('Ongeldig verzoek');
    if (body.t === 'create') {
      for (let i = 0; i < 20; i++) {
        const code = makeCode();
        const { state, member } = newRoom(code, body.name);
        const probe = await store.poll(code, member.id, now);
        if (probe.state) continue;
        state.version = 1;
        if (!(await store.cas(code, 0, state))) continue;
        const ctx = { now, seen: { [member.id]: now } };
        return ok({ code, token: member.token, id: member.id, state: view(state, member.id, ctx) });
      }
      throw new Error('Kon geen kamer maken');
    }
    const code = String(body.code || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) throw new Error('Kamer niet gevonden');

    for (let attempt = 0; attempt < 6; attempt++) {
      const { state: s, seen } = await store.poll(code, body.t === 'join' || typeof body.id !== 'string' ? null : body.id.slice(0, 40), now);
      if (!s) throw new Error('Kamer niet gevonden');
      if (s.game) s.game = hydrate(s.game);
      const before = JSON.stringify(s);
      let me = s.members.find((m) => m.token && m.token === body.token);
      if (body.t === 'join') {
        if (s.phase !== 'lobby') throw new Error('Het spel is al begonnen');
        if (s.members.length >= 10) throw new Error('Kamer is vol (max 10)');
        me = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: cleanName(body.name), bot: false };
        s.members.push(me);
        seen[me.id] = now;
        await store.poll(code, me.id, now); // presence
      } else if (!me) {
        throw new Error('Sessie verlopen');
      } else {
        seen[me.id] = now;
      }
      const ctx = { now, seen };
      if (body.t !== 'join') apply(s, me, body, ctx);
      tick(s, ctx);
      if (JSON.stringify(s) !== before) {
        const v = s.version;
        s.version = v + 1;
        if (!(await store.cas(code, v, s))) continue; // iemand was ons voor: opnieuw
      }
      const res = { code, id: me.id, state: view(s, me.id, ctx) };
      if (body.t === 'join') res.token = me.token;
      if (body.t === 'leave') res.left = true;
      return ok(res);
    }
    throw new Error('Het is druk, probeer opnieuw');
  } catch (e) {
    return { status: 400, json: { error: e.message } };
  }
}

const ok = (json) => ({ status: 200, json });

module.exports = { handle };
