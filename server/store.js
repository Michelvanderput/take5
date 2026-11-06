'use strict';
// Opslag van kamers: Postgres (Vercel/Neon) of geheugen (lokaal/tests).
function memoryStore() {
  const rooms = new Map();
  const seen = new Map();
  return {
    async poll(code, id, now) {
      const s = seen.get(code) || {};
      if (id) s[id] = now;
      seen.set(code, s);
      const raw = rooms.get(code);
      return { state: raw ? JSON.parse(raw) : null, seen: { ...s } };
    },
    async cas(code, expected, obj) {
      const raw = rooms.get(code);
      const cur = raw ? JSON.parse(raw).version : 0;
      if (cur !== expected) return false;
      rooms.set(code, JSON.stringify(obj));
      return true;
    },
  };
}

// Postgres (bijv. Neon via de Vercel Marketplace). `query(text, params) => rows`.
function sqlStore(query) {
  let ready;
  const init = () =>
    (ready ||= (async () => {
      await query('CREATE TABLE IF NOT EXISTS take5_rooms (code text PRIMARY KEY, version int NOT NULL, state jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
      await query('CREATE TABLE IF NOT EXISTS take5_seen (code text NOT NULL, id text NOT NULL, ts bigint NOT NULL, PRIMARY KEY (code, id))');
    })().catch((e) => { ready = null; throw e; }));
  return {
    async poll(code, id, now) {
      await init();
      const [, seenRows, roomRows] = await Promise.all([
        id
          ? query('INSERT INTO take5_seen (code, id, ts) VALUES ($1,$2,$3) ON CONFLICT (code, id) DO UPDATE SET ts = EXCLUDED.ts', [code, id, now])
          : null,
        query('SELECT id, ts FROM take5_seen WHERE code = $1', [code]),
        query('SELECT state FROM take5_rooms WHERE code = $1', [code]),
      ].map((p) => p || Promise.resolve([]))).then((r) => [r[0], r[1], r[2]]);
      const seen = {};
      for (const r of seenRows) seen[r.id] = +r.ts;
      if (id) seen[id] = now;
      const st = roomRows[0] && roomRows[0].state;
      return { state: st ? (typeof st === 'string' ? JSON.parse(st) : st) : null, seen };
    },
    async cas(code, expected, obj) {
      await init();
      const json = JSON.stringify(obj);
      if (expected === 0) {
        // oude kamers opruimen, dan nieuwe invoegen
        await query("DELETE FROM take5_rooms WHERE updated < now() - interval '6 hours'");
        await query("DELETE FROM take5_seen s WHERE NOT EXISTS (SELECT 1 FROM take5_rooms r WHERE r.code = s.code)");
        const r = await query('INSERT INTO take5_rooms (code, version, state) VALUES ($1,$2,$3::jsonb) ON CONFLICT (code) DO NOTHING RETURNING code', [code, obj.version, json]);
        return r.length === 1;
      }
      const r = await query('UPDATE take5_rooms SET version=$3, state=$4::jsonb, updated=now() WHERE code=$1 AND version=$2 RETURNING code', [code, expected, obj.version, json]);
      return r.length === 1;
    },
  };
}

function defaultStore() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url) {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    return sqlStore((text, params) => sql.query(text, params));
  }
  if (process.env.VERCEL) throw new Error('Geen database gekoppeld (DATABASE_URL ontbreekt)');
  return memoryStore();
}

module.exports = { memoryStore, sqlStore, defaultStore };
