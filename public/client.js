'use strict';
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let S = null; // laatste state van de server
let selected = null;
let lastSeq = 0;
let session = null;
try { session = JSON.parse(localStorage.getItem('take5') || 'null'); } catch {}
let pendingName = localStorage.getItem('take5name') || '';
let pendingCode = '';

const points = (n) => (n === 55 ? 7 : n % 11 === 0 ? 5 : n % 10 === 0 ? 3 : n % 5 === 0 ? 2 : 1);
const sum = (a) => a.reduce((s, c) => s + points(c), 0);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(m) {
  toastEl.textContent = m;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (toastEl.hidden = true), 3000);
}

const API = '/api/game';
let busy = false;
let lastCmp = '';

async function post(m) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...m, ...(session ? { code: session.code, token: session.token, pid: session.id } : {}) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Fout');
  return j;
}

function onResponse(j) {
  if (j.token) {
    session = { code: j.code, token: j.token, id: j.id };
    localStorage.setItem('take5', JSON.stringify(session));
  }
  if (j.left) return clearSession();
  if (S && S.code === j.state.code && j.state.v < S.v) return; // oud antwoord
  const cmp = JSON.stringify({ ...j.state, now: 0 });
  const changed = !S || cmp !== lastCmp;
  lastCmp = cmp;
  S = j.state;
  if (S.now) skew = S.now - Date.now();
  if (changed) render();
  if (!busy) schedulePoll();
}

function fail(e) {
  if (e instanceof TypeError) return; // netwerk even weg: volgende poll probeert opnieuw
  toast(e.message);
  if (e.message === 'Sessie verlopen' || (session && e.message === 'Kamer niet gevonden')) clearSession();
}

function clearSession() {
  session = null;
  S = null;
  lastCmp = '';
  localStorage.removeItem('take5');
  render();
}

function send(m) {
  return post(m).then(onResponse).catch(fail);
}

// Stand ophalen (Vercel kent geen WebSockets). Tempo past zich aan, en bij een lopende
// animatie vragen we precies op het moment dat de volgende stap klaar is.
let skew = 0; // verschil tussen server- en clientklok
let pollTimer = null;
const serverNow = () => Date.now() + skew;
function nextDelay() {
  if (!S) return 1000;
  const g = S.gamePhase;
  let d = S.phase !== 'game' ? 1000 : g === 'resolving' || g === 'chooseRow' || g === 'roundEnd' ? 450 : 700;
  if (S.phase === 'game' && g === 'resolving' && S.deadline) d = Math.min(d, Math.max(60, S.deadline - serverNow() + 50));
  return d;
}
function schedulePoll(ms = nextDelay()) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollNow, ms);
}
async function pollNow() {
  if (!session) return schedulePoll(1000);
  if (busy) return schedulePoll(150);
  busy = true;
  try { onResponse(await post({ t: 'poll' })); } catch (e) { fail(e); } finally { busy = false; schedulePoll(); }
}
schedulePoll(800);

// ---------- geluid, trillen, effecten ----------
const sfx = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('take5mute') === '1'; } catch {}
  const ac = () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (type, f0, f1, dur, vol = 0.12, delay = 0, vib = 0) => {
    const a = muted ? null : ac();
    if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    if (vib) {
      const l = a.createOscillator(); const lg = a.createGain();
      l.frequency.value = 6; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const noise = (dur, vol, f0, f1, delay = 0) => {
    const a = muted ? null : ac();
    if (!a) return;
    const t = a.currentTime + delay;
    const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(); s.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  };
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('take5mute', muted ? '1' : '0'); } catch {} if (!muted) this.tick(); return muted; },
    unlock: ac,
    tick() { tone('triangle', 900, 700, 0.06, 0.06); },
    flip(delay = 0) { noise(0.07, 0.25, 3500, 1800, delay); tone('triangle', 520, 380, 0.05, 0.05, delay); },
    whoosh(delay = 0) { noise(0.32, 0.3, 500, 3200, delay); },
    land(delay = 0) { tone('sine', 150, 55, 0.16, 0.28, delay); noise(0.05, 0.22, 2500, 900, delay); },
    moo(l = 2) { const d = 0.5 + l * 0.14; tone('sawtooth', 230 - l * 14, 120 - l * 8, d, 0.05 + l * 0.012, 0, 8 + l * 2); tone('sine', 110 - l * 6, 60, d, 0.1 + l * 0.015); },
    // zware klap: hoe hoger het niveau, hoe dieper, langer en vuiler
    slam(l = 2) {
      tone('sine', 140 - l * 8, 28, 0.22 + l * 0.1, Math.min(0.55, 0.26 + l * 0.07));
      noise(0.1 + l * 0.05, Math.min(0.6, 0.25 + l * 0.08), 4000, 300);
      if (l >= 3) { tone('sawtooth', 90, 30, 0.35 + l * 0.05, 0.1 + l * 0.02, 0.02); noise(0.4, 0.22, 1200, 120, 0.05); }
      if (l >= 5) { tone('square', 60, 25, 0.6, 0.12, 0.08); noise(0.7, 0.25, 800, 80, 0.1); }
    },
    score(i = 0) { tone('triangle', 520 + i * 90, 520 + i * 90, 0.14, 0.07, i * 0.09); },
    ding() { tone('sine', 880, 880, 0.18, 0.1); tone('sine', 1320, 1320, 0.3, 0.07, 0.09); },
    alert() { tone('square', 440, 440, 0.1, 0.06); tone('square', 440, 440, 0.1, 0.06, 0.16); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.35, 0.1, i * 0.11)); },
  };
})();
const buzz = (p) => { if (!sfx.muted && navigator.vibrate) { try { navigator.vibrate(p); } catch {} } };
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const flights = new Map(); // id -> selector van een doelkaart die verborgen blijft tot de vlucht klaar is
let flightId = 0;
let prev = { code: null, round: 0, chosen: {}, revealKey: '', phase: '', scores: {}, over: false, myRow: false };
let playRect = null;

function rehide() {
  for (const sel of flights.values()) {
    const e = app.querySelector(sel);
    if (e) e.style.visibility = 'hidden';
  }
}

/** Vlieg `ghost` (een kloon boven de pagina) van rechthoek `from` naar element `toEl`. */
function fly(ghost, from, toEl, o = {}) {
  const { dur = 800, delay = 0, sel, lift = -18, rot = -8, onland, slam = 0, z = 30 } = o;
  const tr = toEl.getBoundingClientRect();
  const dx = from.left - tr.left;
  const dy = from.top - tr.top;
  const s0 = from.width / tr.width;
  Object.assign(ghost.style, {
    position: 'fixed', left: tr.left + 'px', top: tr.top + 'px', width: tr.width + 'px', height: tr.height + 'px',
    margin: 0, zIndex: z, pointerEvents: 'none', willChange: 'transform',
  });
  ghost.style.setProperty('--w', tr.width + 'px');
  document.body.appendChild(ghost);
  const id = ++flightId;
  if (sel) { flights.set(id, sel); toEl.style.visibility = 'hidden'; }
  const end = () => {
    ghost.remove();
    flights.delete(id);
    const el = sel ? app.querySelector(sel) : toEl;
    if (el) {
      el.style.visibility = '';
      el.classList.remove('land', 'slam'); void el.offsetWidth;
      if (slam) { el.style.setProperty('--lv', slam); el.classList.add('slam'); } else el.classList.add('land');
    }
    if (onland) onland(el);
  };
  const frames = slam
    ? [ // omhoog en dan met volle snelheid naar beneden
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${rot}deg)`, boxShadow: '0 4px 10px rgba(0,0,0,.4)', easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `translate(${dx * 0.2}px, ${dy * 0.2 + lift}px) scale(${1.25 + slam * 0.1}) rotate(${2 + slam}deg)`, boxShadow: '0 40px 50px -8px rgba(0,0,0,.75)', offset: 0.55, easing: 'cubic-bezier(.7,0,1,.6)' },
      { transform: 'none', boxShadow: '0 6px 16px -6px rgba(0,0,0,.55)' },
    ]
    : [
      { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${rot}deg)`, boxShadow: '0 4px 10px rgba(0,0,0,.4)' },
      { transform: `translate(${dx * 0.22}px, ${dy * 0.22 + lift}px) scale(1.2) rotate(3deg)`, boxShadow: '0 30px 40px -8px rgba(0,0,0,.7)', offset: 0.72 },
      { transform: 'none', boxShadow: '0 6px 16px -6px rgba(0,0,0,.55)' },
    ];
  ghost.animate(frames, { duration: dur, delay, easing: slam ? 'linear' : 'cubic-bezier(.22,.9,.3,1)', fill: 'both' }).finished.then(end, end);
}

const elFrom = (html) => { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstElementChild; };

// Niveaus volgen de punten: 5, 6, 7, 8, 9, 10+ (niveau 1..6). Onder de 5 punten: alleen een lichte landing.
const lvlOf = (pts) => (pts < 5 ? 0 : Math.min(pts, 10) - 4);
const strength = (L) => (L ? 1.6 + L * 0.7 : 1); // vloeiende sterkte voor alle effecten
// Korte, brutale kreten; {n} = naam van de speler die de rij pakt. Van vriendelijk (5 punten) naar hard (10+).
const SHOUTS = [
  [],
  ['Boem!', 'Ouch!', 'Jammer man!', 'Lekker voor je!'],
  ['Boem!', 'Lekker voor je, {n}!', 'Jammer man!', 'Sukkeltje!', 'Ouch!'],
  ['Hoe dom ben je!', 'Lekker voor je, {n}!', 'Sukkeltje!', 'Tantoe Sulletje!', 'Jammer man, dombo!', 'Loser!'],
  ['Wat kan je wel?!', 'Hoe dom ben je, sukkel!', 'Tantoe Sulletje!', 'Boem, dombo!', 'Ouch, kneus!', 'Loser!', 'Hond!'],
  ['Hoe dom ben je, dombo?!', 'Wat kan je wel, kneus?!', 'Lekker voor je, bitch!', 'Tantoe Sulletje!', 'Boem, bitch!', 'Fucking loser!', 'Loser, bitch!', 'Hond!'],
  ['Boem, bitch!', 'Hoe dom ben je, dombo?!', 'Wat kan je wel, kneus?!', 'Lekker voor je, bitch!', 'Tantoe Sulletje!', 'Hoppa bitch!', 'Fucking loser!', 'Fucking loser, {n}!', 'Loser, dombo!', 'Hond!'],
];
// Voorspelbaar 'toeval': dezelfde seed geeft bij elke speler dezelfde tekst, kanteling, vonken en schudbeweging.
const seeded = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// zeldzame jumpscare bij 10+ punten; alvast inladen zodat hij direct in beeld is
const MEME_CHANCE = 0.35;
try { new Image().src = 'scream.jpg'; } catch {}
const COLORS = ['#ef4444', '#f97316', '#fbbf24', '#ffffff', '#a855f7'];

/** De klap. L = niveau (0 = licht). Hoe hoger, hoe heftiger: schudden, flits, schokgolven, scherven, bas, trillen. */
function impact(L, rect, who = '', seed = 0) {
  const k = strength(L);
  const rnd = seeded(seed * 2654435761 + 12345);
  sfx.slam(k);
  buzz(L === 0 ? [20] : k < 2.8 ? [40, 30, 50] : k < 3.6 ? [60, 40, 90] : k < 4.6 ? [80, 40, 110, 40, 140] : [120, 50, 160, 50, 220]);
  if (L === 0 || reduced()) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // schermschudden (alles behalve de vaste kaartenbalk: een transform op #app zou die laten verspringen)
  const amp = 2 + k * 3.2;
  const steps = Math.round(8 + k * 3);
  const kf = Array.from({ length: steps }, (_, i) => {
    const f = 1 - i / steps;
    return { transform: `translate(${(rnd() - 0.5) * 2 * amp * f}px, ${(rnd() - 0.5) * 2 * amp * f}px) rotate(${(rnd() - 0.5) * k * 0.3 * f}deg)` };
  }).concat({ transform: 'none' });
  [...app.children].filter((e) => !e.classList.contains('dock') && !e.classList.contains('rscore'))
    .forEach((e) => e.animate(kf, { duration: 280 + k * 130, easing: 'linear' }));
  // rode flits
  const fl = document.createElement('div');
  fl.className = 'flash';
  fl.style.setProperty('--o', Math.min(0.55, 0.08 + k * 0.09));
  fl.style.setProperty('--x', cx + 'px'); fl.style.setProperty('--y', cy + 'px');
  fl.style.animationDuration = 500 + k * 140 + 'ms';
  document.body.appendChild(fl);
  fl.addEventListener('animationend', () => fl.remove());
  // schokgolven
  for (let i = 0; i < Math.min(3, 1 + Math.floor(k / 2)); i++) {
    const r = document.createElement('div');
    r.className = 'shock';
    Object.assign(r.style, { left: cx + 'px', top: cy + 'px', animationDelay: i * 110 + 'ms', animationDuration: 650 + k * 90 + 'ms' });
    r.style.setProperty('--s', 5 + k * 2.2);
    document.body.appendChild(r);
    r.addEventListener('animationend', () => r.remove());
  }
  // scherven / vonken
  const n = Math.round(k * 9 + 4);
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = 'spark';
    const ang = rnd() * Math.PI * 2;
    const dist = 50 + rnd() * (60 + k * 55);
    const sz = 4 + rnd() * (3 + k * 1.5);
    Object.assign(p.style, { left: cx + 'px', top: cy + 'px', width: sz + 'px', height: sz * (rnd() > 0.5 ? 1 : 2.2) + 'px', background: COLORS[(rnd() * COLORS.length) | 0] });
    document.body.appendChild(p);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    p.animate([
      { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 20}px)) rotate(${rnd() * 540}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 70 + k * 15}px)) rotate(${rnd() * 900}deg)`, opacity: 0 },
    ], { duration: 600 + rnd() * (400 + k * 120), easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }).finished.then(() => p.remove(), () => p.remove());
  }
  // schreeuw (altijd maar één tegelijk)
  document.querySelectorAll('.shout').forEach((e) => e.remove());
  const pool = SHOUTS[L];
  let txt = pool[(rnd() * pool.length) | 0].replace('{n}', who || 'jij');
  if (L >= 4) txt = txt.toUpperCase();
  const t = document.createElement('div');
  t.className = 'shout';
  t.textContent = txt;
  t.style.setProperty('--fs', 1.6 + k * 0.9 + 'rem');
  t.style.setProperty('--dur', 2.3 + L * 0.15 + 's');
  t.style.setProperty('--tilt', (rnd() > 0.5 ? 1 : -1) * (2 + k) + 'deg');
  document.body.appendChild(t);
  // echt meten: de tekst (incl. de 1,25x piek van de animatie) moet binnen het scherm blijven
  const maxW = innerWidth * 0.7;
  const w = t.offsetWidth; // layoutbreedte, zonder de schaal van de animatie
  if (w > maxW) t.style.setProperty('--fs', (1.6 + k * 0.9) * (maxW / w) + 'rem');
  t.addEventListener('animationend', () => t.remove());
  // heel af en toe (niveau 6, voor iedereen op hetzelfde moment): de schreeuwende kat
  if (L === 6 && rnd() < MEME_CHANCE) {
    document.querySelectorAll('.meme').forEach((e) => e.remove());
    const m = document.createElement('img');
    m.className = 'meme';
    m.src = 'scream.jpg';
    m.alt = '';
    m.style.setProperty('--dur', 2.3 + L * 0.15 + 's');
    m.style.setProperty('--tilt', (rnd() > 0.5 ? 1 : -1) * (3 + rnd() * 4) + 'deg');
    document.body.appendChild(m);
    m.addEventListener('animationend', () => m.remove());
  }
}

/** Na de klap: de gepakte rij vliegt naar de speler; +punten zweeft omhoog. `delay`: wacht op de klap. */
function takeRow(ev, rects, delay = 0, L = lvlOf(ev.points)) {
  const k = strength(L);
  const rnd = seeded(ev.seq * 977 + ev.card);
  const chip = app.querySelector(`.pl[data-pid="${ev.playerId}"] .avatar`);
  if (!chip) return;
  const cr = chip.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  const dur = 540 + 45 * k;
  const gap = 50 + 5 * k;
  (rects || []).forEach((r, i) => {
    const g = elFrom(cardHtml(ev.taken[i] ?? ev.taken[0]));
    g.style.setProperty('--w', r.width + 'px');
    Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, zIndex: 31, pointerEvents: 'none' });
    document.body.appendChild(g);
    const rotz = (rnd() - 0.5) * (40 + k * 30);
    g.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${(rnd() - 0.5) * k * 12}px, ${-10 - k * 5}px) scale(${1.05 + k * 0.03}) rotate(${rotz / 3}deg)`, opacity: 1, offset: 0.22 },
      { transform: `translate(${cx - r.left - r.width / 2}px, ${cy - r.top - r.height / 2}px) scale(.18) rotate(${rotz}deg)`, opacity: 0.1 },
    ], { duration: dur, delay: delay + i * gap, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' }).finished.then(() => g.remove(), () => g.remove());
  });
  const total = delay + dur + (rects ? rects.length * gap : 0) - 100;
  setTimeout(() => {
    chip.parentElement.classList.remove('hit'); void chip.offsetWidth;
    chip.parentElement.style.setProperty('--amp', 5 + k * 3 + 'px');
    chip.parentElement.classList.add('hit');
    const f = document.createElement('div');
    f.className = 'floatpts';
    f.style.fontSize = 1.9 + k * 0.5 + 'rem';
    f.innerHTML = `+${ev.points} ${cowSvg()}`;
    f.style.left = cx + 'px'; f.style.top = cy + 'px';
    document.body.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
    sfx.moo(k);
    buzz([40, 50, 90]);
  }, Math.max(0, total * 0.75));
}

function tweenScores() {
  app.querySelectorAll('b[data-score]').forEach((b) => {
    const pid = b.dataset.pid;
    const to = +b.dataset.score;
    const from = prev.scores[pid];
    prev.scores[pid] = to;
    if (from === undefined || from === to || reduced()) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      b.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && b.isConnected) requestAnimationFrame(step);
    };
    b.textContent = from;
    requestAnimationFrame(step);
  });
}

function confetti(seed = 1) {
  if (reduced()) return;
  const rnd = seeded(seed * 4099 + 7);
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 40, pointerEvents: 'none' });
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  document.body.appendChild(cv);
  const x = cv.getContext('2d');
  x.scale(dpr, dpr);
  const cols = ['#34d399', '#22d3ee', '#fbbf24', '#ef4444', '#a855f7', '#ffffff'];
  const ps = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (rnd() - 0.5) * 200, y: innerHeight * 0.55, vx: (rnd() - 0.5) * 16,
    vy: -rnd() * 18 - 6, w: 6 + rnd() * 6, h: 4 + rnd() * 5, r: rnd() * 6, vr: (rnd() - 0.5) * 0.4,
    c: cols[(rnd() * cols.length) | 0],
  }));
  const t0 = performance.now();
  const loop = (t) => {
    x.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.45; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore();
    }
    if (t - t0 < 3500) requestAnimationFrame(loop); else cv.remove();
  };
  requestAnimationFrame(loop);
}

// ---------- rendering ----------
const cowSvg = (n = 1) => '<svg class="cow"><use href="#cow"/></svg>'.repeat(n);
const hue = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const avatar = (name) => `<span class="avatar" style="--h:${hue(name)}">${esc([...name][0] || '?').toUpperCase()}</span>`;

function cardHtml(n, cls = '') {
  const p = points(n);
  return `<div class="card p${p} ${cls}" data-card="${n}"><span class="num">${n}</span><span class="cows ${p > 2 ? 'cnt' : ''}">${p > 2 ? `${cowSvg()}<b>${p}</b>` : cowSvg(p)}</span></div>`;
}

function cardBack(pid, extra = '') {
  return `<div class="card sm back ${extra}" data-pid="${pid}">${cowSvg()}</div>`;
}

function setMain(cls) {
  if (app.className !== cls && app.animate && !reduced()) {
    app.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  app.className = cls;
}

function render() {
  if (!S) return renderHome();
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderHome() {
  setMain('home');
  document.documentElement.classList.remove('noscroll');
  app.innerHTML = `
    <section class="hero">
      <h1><span class="grad-text">Take 5!</span></h1>
      <p>Het razendsnelle kaartspel waarin je niet de 6e kaart wilt leggen. Speel online met 2 tot 10 vrienden, ieder op het eigen scherm.</p>
    </section>
    <div class="namebox"><input id="name" placeholder="Jouw naam" maxlength="16" value="${esc(pendingName)}" autocomplete="nickname"></div>
    <div class="grid2">
      <div class="panel">
        <h3>Nieuw spel</h3>
        <p class="muted">Maak een kamer en deel de code met je vrienden.</p>
        <button id="create" class="lg">Kamer maken</button>
      </div>
      <div class="panel">
        <h3>Meedoen</h3>
        <p class="muted">Heb je een code gekregen? Vul hem hier in.</p>
        <div class="field">
          <input id="code" placeholder="ABCD" maxlength="4" value="${esc(pendingCode)}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="go" aria-label="Kamercode" style="text-transform:uppercase;letter-spacing:.25em;text-align:center;font-weight:700">
          <button id="join" class="lg">Deelnemen</button>
        </div>
      </div>
    </div>`;
  const name = () => {
    pendingName = document.getElementById('name').value.trim();
    localStorage.setItem('take5name', pendingName);
    return pendingName || 'Speler';
  };
  document.getElementById('create').onclick = () => send({ t: 'create', name: name() });
  document.getElementById('join').onclick = () =>
    send({ t: 'join', name: name(), code: document.getElementById('code').value });
  const codeEl = document.getElementById('code');
  codeEl.oninput = () => {
    codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    pendingCode = codeEl.value;
  };
  document.getElementById('name').oninput = (e) => { pendingName = e.target.value; };
  // let op: een handler die `false` teruggeeft blokkeert de toets; daarom met accolades en zonder return
  codeEl.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('join').click(); };
}

function playersHtml(waiting) {
  return `<div class="players">${S.players.map((p) => {
    const dot = !p.connected ? '' : waiting ? `<i class="dot ${p.hasChosen ? 'ok' : 'think'}"></i>` : '';
    const pct = Math.min(100, Math.round(((p.score + 0) / S.targetScore) * 100));
    return `<div class="pl ${p.id === S.you ? 'me' : ''} ${p.connected ? '' : 'off'}" data-pid="${p.id}">
      <span class="avatar" style="--h:${hue(p.name)}">${esc([...p.name][0] || '?').toUpperCase()}${dot}</span>
      <span class="nm">${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === S.hostId ? ' 👑' : ''}</span>
      <span class="sc"><b data-pid="${p.id}" data-score="${p.score}">${p.score}</b>${p.roundPoints ? ` <span style="color:var(--t5)">+${p.roundPoints}</span>` : ''} ${cowSvg()}</span>
      <span class="bar"><i class="${pct >= 75 ? 'hi' : ''}" style="width:${pct}%"></i></span></div>`;
  }).join('')}</div>`;
}

function renderLobby() {
  setMain('lobby');
  const me = S.players.find((p) => p.id === S.you) || {};
  const waiting = S.players.filter((p) => !p.ready);
  const allReady = waiting.length === 0;
  const readyCount = S.players.length - waiting.length;
  document.documentElement.classList.remove('noscroll');
  lastSeq = 0;
  prev = { ...prev, round: 0, chosen: {}, revealKey: '', phase: '', over: false, myRow: false, scores: {} };
  selected = null;
  const host = S.hostId === S.you;
  app.innerHTML = `
    <section class="hero" style="padding-bottom:6px"><h1><span class="grad-text">Take 5!</span></h1></section>
    <div class="panel codebox">
      <div class="muted">Deel deze code met je vrienden</div>
      <div class="code">${S.code}</div>
      <button class="sec" id="copy">🔗 Kopieer uitnodigingslink</button>
    </div>
    <div class="panel">
      <div class="row-flex"><h3>Spelers</h3><span class="tag">${S.players.length}/10</span>
        ${host ? '<button class="sec sm" id="bot" style="margin-left:auto">🤖 Bot toevoegen</button>' : ''}</div>
      <div class="plist">${S.players.map((p) => `<div class="pitem">${avatar(p.name)}
        <span class="nm">${esc(p.name)}</span>
        ${p.id === S.hostId ? '<span class="tag">👑 host</span>' : ''}${p.bot ? '<span class="tag">bot</span>' : ''}${p.id === S.you ? '<span class="tag">jij</span>' : ''}
        <span class="rdy ${p.ready ? 'on' : ''}">${p.ready ? '✓ Ready' : 'wacht…'}</span>
        ${host && p.id !== S.you ? `<button class="sec sm" data-kick="${p.id}" title="Verwijder uit kamer">✕ Verwijder</button>` : ''}</div>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="row-flex">
        <button id="ready" class="lg ${me.ready ? 'on' : ''}">${me.ready ? '✓ Je bent ready' : 'Ik ben ready'}</button>
        <span class="muted">${readyCount}/${S.players.length} ready</span>
        ${host ? `<label class="muted" style="margin-left:auto">Eindscore&nbsp;
          <select id="target">${[30, 45, 66, 100].map((v) => `<option ${v === S.targetScore ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      </div>
      ${host
        ? `<div class="row-flex" style="margin-top:12px"><button id="start" class="lg" ${allReady && S.players.length >= 2 ? '' : 'disabled'}>Start spel ▶</button>
           <span class="muted">${S.players.length < 2 ? 'Minimaal 2 spelers (voeg een bot toe)' : allReady ? 'Iedereen is ready!' : `Wachten op: ${esc(waiting.map((p) => p.name).join(', '))}`}</span></div>`
        : `<p class="muted" style="margin:12px 0 0">${allReady ? '⏳ Wachten tot de host het spel start…' : `Wachten op: ${esc(waiting.map((p) => p.name).join(', '))}`} (eindscore ${S.targetScore})</p>`}
    </div>
    <p style="text-align:center"><button class="sec sm" id="leave">Verlaat kamer</button></p>`;
  document.getElementById('copy').onclick = () => {
    const url = `${location.origin}/?code=${S.code}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link gekopieerd'), () => prompt('Kopieer link', url));
  };
  document.getElementById('leave').onclick = () => send({ t: 'leave' });
  document.getElementById('ready').onclick = () => { sfx.tick(); buzz(10); send({ t: 'ready', v: !me.ready }); };
  if (host) {
    document.getElementById('bot').onclick = () => send({ t: 'addBot' });
    document.getElementById('start').onclick = () => send({ t: 'start' });
    document.getElementById('target').onchange = (e) => send({ t: 'target', v: +e.target.value });
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => send({ t: 'kick', id: b.dataset.kick })));
  }
}

/** Meet of het spel in beeld past en verklein de kaarten tot dat zo is: nooit een scrollbalk in het spel. */
function fitGame() {
  const root = document.documentElement;
  root.classList.remove('noscroll');
  const dock = app.querySelector('.dock');
  const cap = Math.min(66, innerWidth * 0.135);
  const fitting = !(S && S.gamePhase === 'gameOver');
  const dpr = window.devicePixelRatio || 1;
  const snap = (v) => Math.floor(v * dpr) / dpr; // hele fysieke pixels
  let cw = snap(cap);
  for (let i = 0; i < 10; i++) {
    root.style.setProperty('--cw', cw + 'px');
    root.style.setProperty('--dock-h', (dock ? dock.offsetHeight + 6 : 16) + 'px');
    if (!fitting) return;
    const over = root.scrollHeight - innerHeight;
    if (over <= 0) break;
    const next = snap(Math.max(30, cw - Math.max(0.6, over / 6.8)));
    if (next === cw) break;
    cw = next;
  }
  if (fitting && root.scrollHeight <= innerHeight) root.classList.add('noscroll');
}
addEventListener('resize', () => { if (app.classList.contains('game') && S) fitGame(); });

function renderGame() {
  setMain('game');
  const g = S.gamePhase;
  const name = (id) => (S.players.find((p) => p.id === id) || {}).name || '?';
  const ev = S.lastEvent;
  const first = prev.code !== S.code;
  const anim = !first && !reduced();
  const fresh = !!ev && ev.seq !== lastSeq;
  if (ev) lastSeq = ev.seq;
  const needMyRow = g === 'chooseRow' && S.waitingFor === S.you;
  const newRound = !first && S.round !== prev.round && g === 'choosing';

  // posities van de oude rij vastleggen, vóór de DOM wordt vervangen (voor de "rij nemen"-animatie)
  let takenRects = null;
  if (anim && fresh && ev.taken) {
    takenRects = [...app.querySelectorAll(`.brow[data-row="${ev.row}"] .card:not(.empty)`)].map((e) => e.getBoundingClientRect());
  }

  let status = '';
  let alert = false;
  if (g === 'choosing') status = S.myChoice ? 'Gekozen — even wachten…' : 'Kies een kaart uit je hand';
  else if (g === 'resolving') status = 'Kaarten worden neergelegd…';
  else if (g === 'chooseRow') {
    alert = needMyRow;
    status = needMyRow ? 'Te laag! Kies een rij om te nemen' : `${esc(name(S.waitingFor))} moet een rij kiezen…`;
  } else if (g === 'roundEnd') status = 'Ronde voorbij — volgende start zo…';
  else if (g === 'gameOver') status = '🏆 Spel afgelopen!';

  let evText = '';
  if (ev) {
    if (ev.type === 'sixth') evText = `${esc(name(ev.playerId))} legt de 6e kaart en neemt ${ev.points} ${cowSvg()}`;
    else if (ev.type === 'take') evText = `${esc(name(ev.playerId))} neemt een rij: ${ev.points} ${cowSvg()}`;
  }

  const rowsHtml = S.rows.map((row, i) => {
    const cls = ['brow', needMyRow ? 'pick' : '', row.length >= 5 ? 'full' : '', ev && ev.row === i ? 'last' : ''].join(' ');
    let cells = '';
    for (let k = 0; k < 5; k++) {
      cells += row[k] !== undefined
        ? cardHtml(row[k], anim && fresh && ev.row === i && row[k] === ev.card ? 'fly' : '')
        : '<div class="card empty"></div>';
    }
    return `<div class="${cls}" data-row="${i}"><span class="lane">${i + 1}</span>${cells}<span class="tot">${cowSvg()} ${sum(row)}</span></div>`;
  }).join('');

  // tafel: tijdens kiezen gesloten kaarten, daarna omgedraaid op volgorde
  const revealKey = S.turnCards.map((t) => t.card).join(',');
  const freshReveal = anim && revealKey && revealKey !== prev.revealKey;
  let tray = '';
  if (g === 'choosing') {
    tray = `<div class="tray">${S.players.map((p) => {
      const inner = p.id === S.you && S.myChoice
        ? cardHtml(S.myChoice, 'sm mine')
        : p.hasChosen ? cardBack(p.id) : '<div class="card sm empty"></div>';
      return `<div class="it">${inner}<span class="who">${esc(p.name)}</span></div>`;
    }).join('')}</div>`;
  } else if (S.turnCards.length) {
    tray = `<div class="tray">${S.turnCards.map((t, i) => {
      const now = i === S.cursor && !t.done;
      const cls = `sm ${freshReveal ? 'flipin' : ''}`;
      const style = freshReveal ? ` style="animation-delay:${i * 90}ms"` : '';
      return `<div class="it ${t.done ? 'done' : ''} ${now ? 'now' : ''}" ${style}>${cardHtml(t.card, cls)}<span class="who">${esc(name(t.playerId))}</span></div>`;
    }).join('')}</div>`;
  }

  const canPlay = g === 'choosing' && !S.myChoice;
  const handCards = S.hand.filter((c) => c !== S.myChoice);
  const handHtml = handCards.length
    ? `<div class="hand ${canPlay ? '' : 'locked'}">${handCards.map((c, i) =>
      cardHtml(c, `${c === selected ? 'sel' : ''} ${newRound ? 'deal' : ''}`).replace('<div class="card', `<div style="${newRound ? `animation-delay:${i * 55}ms` : ''}" class="card`)).join('')}</div>`
    : '';

  let over = '';
  if (g === 'gameOver') {
    const rank = S.players.slice().sort((a, b) => a.score - b.score);
    over = `<div class="panel" style="margin-top:14px"><h2 class="grad-text" style="font-size:1.8rem">🏆 ${S.winners.map((id) => esc(name(id))).join(' & ')} wint!</h2>
      <div class="podium">${rank.map((p, i) => `<div class="prow ${S.winners.includes(p.id) ? 'win' : ''}"><span class="rk">${i + 1}</span>${avatar(p.name)}<span class="nm">${esc(p.name)}</span><span class="pts">${p.score} ${cowSvg()}</span></div>`).join('')}</div>
      ${S.hostId === S.you ? '<button id="rematch" class="lg">Nog een keer ↺</button>' : '<p class="muted">Wachten op de host…</p>'}</div>`;
  }

  // tussenstand tijdens de pauze tussen twee rondes
  const freshRoundEnd = g === 'roundEnd' && prev.phase !== 'roundEnd' && !first;
  let board = '';
  if (g === 'roundEnd') {
    const worst = Math.max(...S.players.map((p) => p.roundPoints));
    const ranked = S.players.slice().sort((a, b) => a.score - b.score);
    const left = Math.max(0, Math.ceil((S.deadline - serverNow()) / 1000));
    board = `<div class="rscore"><div class="rs-card">
      <div class="rs-head"><h3>Tussenstand</h3><span class="pill">na ronde ${S.round}</span></div>
      <div class="rs-list">${ranked.map((p, i) => {
        const before = p.score - p.roundPoints;
        const pct = (v) => Math.min(100, Math.round((v / S.targetScore) * 100));
        const tag = p.roundPoints === 0 ? '<span class="rs-tag good">schoon! 🎉</span>'
          : p.roundPoints === worst && worst > 0 ? '<span class="rs-tag bad">meeste koeien</span>' : '';
        return `<div class="rs-row ${i === 0 ? 'lead' : ''} ${p.id === S.you ? 'me' : ''}" style="--i:${i}">
          <span class="rk">${i === 0 ? '👑' : i + 1}</span>${avatar(p.name)}
          <span class="nm">${esc(p.name)}${tag}</span>
          <span class="add ${p.roundPoints ? '' : 'zero'}">+${p.roundPoints}</span>
          <b class="tot" data-from="${freshRoundEnd ? before : p.score}" data-to="${p.score}">${freshRoundEnd ? before : p.score}</b>
          <span class="bar"><i class="${pct(p.score) >= 75 ? 'hi' : ''}" data-w="${pct(p.score)}" style="width:${freshRoundEnd ? pct(before) : pct(p.score)}%"></i></span>
        </div>`;
      }).join('')}</div>
      <div class="rs-foot">Volgende ronde start over <b id="rcount">${left}</b>s</div>
    </div></div>`;
  }

  const secs = S.deadline && (g === 'choosing' || needMyRow) ? Math.max(0, Math.round((S.deadline - serverNow()) / 1000)) : null;

  app.innerHTML = `
    <div class="topbar">
      <span class="pill"><b>Ronde ${S.round}</b></span>
      <span class="pill">eindigt bij ${S.targetScore} ${cowSvg()}</span>
      <span class="pill" style="margin-left:auto"><span class="lbl">Kamer </span>${S.code}</span>
      <button class="sec sm" id="quit" title="${S.hostId === S.you ? 'Stop spel' : 'Verlaat spel'}">${S.hostId === S.you ? '⏹' : '🚪'}<span class="lbl"> ${S.hostId === S.you ? 'Stop spel' : 'Verlaat spel'}</span></button>
      <span class="pill timer ${secs !== null && secs <= 10 ? 'hot' : ''}" id="timer" ${secs === null ? 'style="visibility:hidden"' : ''}>⏱ ${secs ?? 0}s</span>
    </div>
    ${playersHtml(g === 'choosing')}
    <div class="status"><span class="main ${alert ? 'alert' : ''}">${status}</span>${evText ? `<span class="sub">${evText}</span>` : ''}</div>
    <div class="stage"><div class="board">${rowsHtml}</div>
    ${tray || '<div class="tray"></div>'}</div>
    ${over}
    ${board}
    ${S.hand.length ? `<div class="dock"><div class="inner">
      <button id="play" class="lg" ${selected && canPlay ? '' : 'disabled'} ${canPlay ? '' : 'style="visibility:hidden" tabindex="-1"'}>${selected ? `Speel ${selected}` : 'Kies een kaart'}</button>
      ${handHtml}</div></div>` : ''}`;

  fitGame();
  rehide();
  if (S.myChoice === null && selected !== null && !S.hand.includes(selected)) selected = null;
  if (canPlay) {
    app.querySelectorAll('.hand .card').forEach((el) => (el.onclick = () => { selected = +el.dataset.card; sfx.tick(); buzz(8); renderGame(); }));
  }
  const pb = document.getElementById('play');
  if (pb && canPlay) pb.onclick = () => playSelected();
  if (needMyRow) app.querySelectorAll('.brow').forEach((el) => (el.onclick = () => { buzz(15); send({ t: 'pickRow', row: +el.dataset.row }); }));
  const rm = document.getElementById('rematch');
  if (rm) rm.onclick = () => send({ t: 'rematch' });
  const q = document.getElementById('quit');
  if (q) q.onclick = () => {
    const host = S.hostId === S.you;
    if (confirm(host ? 'Het spel stoppen voor alle spelers?' : 'Het spel verlaten? Een bot neemt jouw plek over.')) {
      send({ t: host ? 'stop' : 'leave' });
    }
  };

  // ---- animaties en geluid ----
  if (anim) {
    // wie heeft er net gekozen? kaart vliegt naar de tafel
    for (const p of S.players) {
      if (g !== 'choosing' || !p.hasChosen || prev.chosen[p.id]) continue;
      if (p.id === S.you) {
        const slot = app.querySelector(`.tray .it .card.mine`);
        if (slot && playRect) {
          fly(elFrom(cardHtml(S.myChoice, 'sm')), playRect, slot, { dur: 620, rot: 0, lift: -10, sel: '.tray .it .card.mine', onland: () => { sfx.land(); buzz(14); } });
          sfx.whoosh();
        }
        playRect = null;
      } else {
        const slot = app.querySelector(`.tray .card.back[data-pid="${p.id}"]`);
        const av = app.querySelector(`.pl[data-pid="${p.id}"] .avatar`);
        if (slot && av) {
          const r = av.getBoundingClientRect();
          fly(elFrom(cardBack(p.id)), { left: r.left, top: r.top, width: r.width }, slot, { dur: 600, rot: 10, lift: 8, sel: `.tray .card.back[data-pid="${p.id}"]`, onland: () => sfx.tick() });
        }
      }
    }
    // omdraaien
    if (freshReveal) S.turnCards.forEach((_, i) => sfx.flip(i * 0.09));
    // nieuwe ronde delen / mijn beurt
    if (newRound) { for (let i = 0; i < Math.min(S.hand.length, 10); i++) sfx.flip(i * 0.055); sfx.ding(); }
    // kaart legt zich op de rij
    if (fresh && ev.card && (ev.type === 'place' || ev.type === 'sixth' || ev.type === 'take')) {
      const sel = `.brow[data-row="${ev.row}"] .card[data-card="${ev.card}"]`;
      const target = app.querySelector(sel);
      if (target) {
        const src = app.querySelector(`.tray .card[data-card="${ev.card}"]`);
        const tr = target.getBoundingClientRect();
        const from = src ? src.getBoundingClientRect() : { left: innerWidth / 2 - tr.width / 2, top: innerHeight + 30, width: tr.width };
        const ghost = target.cloneNode(true);
        ghost.classList.remove('fly');
        if (ev.taken) {
          // valt van hoog, klap, dan pas gaat de rij naar de speler; alles schaalt met de punten
          const L = lvlOf(ev.points);
          const k = strength(L);
          const dur = 560 + 45 * k;
          fly(ghost, from, target, {
            sel, dur, slam: k, z: 32, lift: -(30 + k * 24), rot: -6 - k * 3,
            onland: (el) => impact(L, (el || target).getBoundingClientRect(), name(ev.playerId), ev.seq * 31 + ev.card),
          });
          sfx.whoosh();
          takeRow(ev, takenRects, dur + 40, L);
        } else {
          fly(ghost, from, target, { sel, onland: () => { sfx.land(); buzz(12); } });
          sfx.whoosh();
        }
      }
    }
    if (freshRoundEnd) {
      sfx.ding();
      app.querySelectorAll('.rs-row').forEach((row, i) => {
        const to = +row.querySelector('.tot').dataset.to;
        const el = row.querySelector('.tot');
        const from = +el.dataset.from;
        const bar = row.querySelector('.bar i');
        setTimeout(() => {
          bar.style.width = bar.dataset.w + '%';
          const t0 = performance.now();
          const step = (t) => {
            const k = Math.min(1, (t - t0) / 1100);
            el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
            if (k < 1 && el.isConnected) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          if (to !== from) sfx.score(i);
        }, 500 + i * 120);
      });
    }
    if (needMyRow && !prev.myRow) { sfx.alert(); buzz([60, 60, 60]); }
    if (g === 'gameOver' && !prev.over) { sfx.win(); confetti([...S.code].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) + S.round); buzz([40, 40, 40, 40, 120]); }
  }
  if (first && g === 'choosing') { /* niets: geen animatie bij herladen */ }

  tweenScores();
  prev = {
    ...prev, code: S.code, round: S.round, phase: g, over: g === 'gameOver', myRow: needMyRow,
    revealKey: revealKey || (g === 'choosing' ? '' : prev.revealKey),
    chosen: Object.fromEntries(S.players.map((p) => [p.id, g === 'choosing' && p.hasChosen])),
  };
}

function playSelected() {
  if (selected === null || !S || S.gamePhase !== 'choosing' || S.myChoice) return;
  const el = app.querySelector('.hand .card.sel');
  playRect = el ? el.getBoundingClientRect() : null;
  const card = selected;
  selected = null;
  // meteen reageren: kaart ligt direct op tafel, het antwoord van de server volgt
  S = { ...S, myChoice: card, players: S.players.map((p) => (p.id === S.you ? { ...p, hasChosen: true } : p)) };
  renderGame();
  send({ t: 'play', card });
}

// timer-weergave bijwerken
setInterval(() => {
  const el = document.getElementById('timer');
  if (S && S.deadline && el) {
    const s = Math.max(0, Math.round((S.deadline - serverNow()) / 1000));
    el.textContent = `⏱ ${s}s`;
    el.classList.toggle('hot', s <= 10);
  }
  const rc = document.getElementById('rcount');
  if (S && S.deadline && rc) rc.textContent = Math.max(0, Math.ceil((S.deadline - serverNow()) / 1000));
}, 500);

// mute-knop
const muteBtn = document.createElement('button');
muteBtn.id = 'mute';
muteBtn.className = 'sec';
const paintMute = () => { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; muteBtn.title = sfx.muted ? 'Geluid aan' : 'Geluid uit'; };
muteBtn.onclick = () => { sfx.toggle(); paintMute(); };
paintMute();
document.body.appendChild(muteBtn);

// ---------- start ----------
const urlCode = new URLSearchParams(location.search).get('code');
if (session) {
  send({ t: 'resume' });
} else {
  render();
  if (urlCode) { pendingCode = urlCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); const c = document.getElementById('code'); if (c) c.value = pendingCode; }
}
