'use strict';
const { handle } = require('../server/api');
const { defaultStore } = require('../server/store');

let store;
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST vereist' });
  try {
    store = store || defaultStore();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const { status, json } = await handle(store, body);
  res.status(status).json(json);
};
