'use strict';
// Opslag van kamers. Redis (Upstash REST, werkt op Vercel) of geheugen (lokaal/tests).
const TTL = 6 * 3600;
const CAS = `local c=redis.call('GET',KEYS[1])
if (not c and ARGV[1]=='0') or (c and cjson.decode(c).version==tonumber(ARGV[1])) then
redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) return 1 end return 0`;

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

function redisStore(url, token) {
  const call = async (path, body) => {
    const r = await fetch(url + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('Opslag niet bereikbaar');
    return r.json();
  };
  const rk = (c) => `take5:room:${c}`;
  const sk = (c) => `take5:seen:${c}`;
  return {
    async poll(code, id, now) {
      const cmds = [];
      if (id) cmds.push(['HSET', sk(code), id, String(now)], ['EXPIRE', sk(code), String(TTL)]);
      cmds.push(['HGETALL', sk(code)], ['GET', rk(code)]);
      const res = await call('/pipeline', cmds);
      const flat = res[res.length - 2].result || [];
      const seen = {};
      for (let i = 0; i < flat.length; i += 2) seen[flat[i]] = +flat[i + 1];
      const raw = res[res.length - 1].result;
      return { state: raw ? JSON.parse(raw) : null, seen };
    },
    async cas(code, expected, obj) {
      const r = await call('', ['EVAL', CAS, '1', rk(code), String(expected), JSON.stringify(obj), String(TTL)]);
      return r.result === 1;
    },
  };
}

function defaultStore() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return redisStore(url.replace(/\/$/, ''), token);
  if (process.env.VERCEL) throw new Error('Geen Redis gekoppeld (UPSTASH_REDIS_REST_URL / _TOKEN)');
  return memoryStore();
}

module.exports = { memoryStore, redisStore, defaultStore };
