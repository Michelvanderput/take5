'use strict';
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let S = null; // laatste state van de server
let selected = null;
let lastSeq = 0;
let session = null;
try { session = JSON.parse(localStorage.getItem('take5') || 'null'); } catch {}
let pendingName = localStorage.getItem('take5name') || '';

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

async function post(m) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...m, ...(session || {}) }),
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
  const changed = !S || JSON.stringify(S) !== JSON.stringify(j.state);
  S = j.state;
  if (changed) render();
}

function fail(e) {
  if (e instanceof TypeError) return; // netwerk even weg: volgende poll probeert opnieuw
  toast(e.message);
  if (e.message === 'Sessie verlopen' || e.message === 'Kamer niet gevonden') clearSession();
}

function clearSession() {
  session = null;
  S = null;
  localStorage.removeItem('take5');
  render();
}

function send(m) {
  return post(m).then(onResponse).catch(fail);
}

// Elke ~0,8 s de stand ophalen (Vercel kent geen WebSockets).
setInterval(() => {
  if (!session || busy) return;
  busy = true;
  post({ t: 'poll' }).then(onResponse).catch(fail).finally(() => (busy = false));
}, 800);

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
    moo() { tone('sawtooth', 210, 140, 0.55, 0.07, 0, 8); tone('sine', 105, 70, 0.55, 0.12); },
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
  const { dur = 800, delay = 0, sel, lift = -18, rot = -8, onland } = o;
  const tr = toEl.getBoundingClientRect();
  const dx = from.left - tr.left;
  const dy = from.top - tr.top;
  const s0 = from.width / tr.width;
  Object.assign(ghost.style, {
    position: 'fixed', left: tr.left + 'px', top: tr.top + 'px', width: tr.width + 'px', height: tr.height + 'px',
    margin: 0, zIndex: 30, pointerEvents: 'none', willChange: 'transform',
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
      el.classList.remove('land'); void el.offsetWidth; el.classList.add('land');
    }
    if (onland) onland();
  };
  ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s0}) rotate(${rot}deg)`, boxShadow: '0 4px 10px rgba(0,0,0,.4)' },
    { transform: `translate(${dx * 0.22}px, ${dy * 0.22 + lift}px) scale(1.2) rotate(3deg)`, boxShadow: '0 30px 40px -8px rgba(0,0,0,.7)', offset: 0.72 },
    { transform: 'none', boxShadow: '0 6px 16px -6px rgba(0,0,0,.55)' },
  ], { duration: dur, delay, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'both' }).finished.then(end, end);
}

const elFrom = (html) => { const t = document.createElement('div'); t.innerHTML = html.trim(); return t.firstElementChild; };

/** Een gepakte rij vliegt naar de speler; +punten zweeft omhoog. */
function takeRow(ev, rects) {
  const chip = app.querySelector(`.pl[data-pid="${ev.playerId}"] .avatar`);
  if (!chip) return;
  const cr = chip.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  (rects || []).forEach((r, i) => {
    const g = elFrom(cardHtml(ev.taken[i] ?? ev.taken[0]));
    g.style.setProperty('--w', r.width + 'px');
    Object.assign(g.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: 0, zIndex: 31, pointerEvents: 'none' });
    document.body.appendChild(g);
    const rotz = (Math.random() - 0.5) * 60;
    g.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(0, -14px) scale(1.08) rotate(${rotz / 3}deg)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${cx - r.left - r.width / 2}px, ${cy - r.top - r.height / 2}px) scale(.18) rotate(${rotz}deg)`, opacity: 0.1 },
    ], { duration: 750, delay: i * 70, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' }).finished.then(() => g.remove(), () => g.remove());
  });
  const total = 750 + (rects ? rects.length * 70 : 0) - 80;
  setTimeout(() => {
    chip.parentElement.classList.remove('hit'); void chip.offsetWidth; chip.parentElement.classList.add('hit');
    const f = document.createElement('div');
    f.className = 'floatpts';
    f.innerHTML = `+${ev.points} ${cowSvg()}`;
    f.style.left = cx + 'px'; f.style.top = cy + 'px';
    document.body.appendChild(f);
    f.addEventListener('animationend', () => f.remove());
    sfx.moo();
    buzz([40, 50, 90]);
  }, Math.max(0, total * 0.7));
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

function confetti() {
  if (reduced()) return;
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 40, pointerEvents: 'none' });
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const x = cv.getContext('2d');
  const cols = ['#34d399', '#22d3ee', '#fbbf24', '#ef4444', '#a855f7', '#ffffff'];
  const ps = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.55, vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 18 - 6, w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    c: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  const loop = (t) => {
    x.clearRect(0, 0, cv.width, cv.height);
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
  return `<div class="card p${p} ${cls}" data-card="${n}"><span class="num">${n}</span><span class="cows">${cowSvg(p)}</span></div>`;
}

function cardBack(pid, extra = '') {
  return `<div class="card sm back ${extra}" data-pid="${pid}">${cowSvg()}</div>`;
}

function setMain(cls) {
  app.className = cls;
}

function render() {
  if (!S) return renderHome();
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderHome() {
  setMain('home');
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
          <input id="code" placeholder="ABCD" maxlength="4" style="text-transform:uppercase;letter-spacing:.25em;text-align:center;font-weight:700">
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
  document.getElementById('code').onkeydown = (e) => e.key === 'Enter' && document.getElementById('join').click();
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
        ${host && p.id !== S.you ? `<button class="sec sm" data-kick="${p.id}" title="Verwijder uit kamer">✕ Verwijder</button>` : ''}</div>`).join('')}</div>
    </div>
    <div class="panel">
      ${host ? `<div class="row-flex">
        <label class="muted">Spel eindigt bij&nbsp;
          <select id="target">${[30, 45, 66, 100].map((v) => `<option ${v === S.targetScore ? 'selected' : ''}>${v}</option>`).join('')}</select> koeienkoppen</label>
        <button id="start" class="lg" style="margin-left:auto">Start spel ▶</button></div>`
        : `<p class="muted" style="margin:0">⏳ Wachten tot de host het spel start… (eindscore ${S.targetScore})</p>`}
    </div>
    <p style="text-align:center"><button class="sec sm" id="leave">Verlaat kamer</button></p>`;
  document.getElementById('copy').onclick = () => {
    const url = `${location.origin}/?code=${S.code}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link gekopieerd'), () => prompt('Kopieer link', url));
  };
  document.getElementById('leave').onclick = () => send({ t: 'leave' });
  if (host) {
    document.getElementById('bot').onclick = () => send({ t: 'addBot' });
    document.getElementById('start').onclick = () => send({ t: 'start' });
    document.getElementById('target').onchange = (e) => send({ t: 'target', v: +e.target.value });
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => send({ t: 'kick', id: b.dataset.kick })));
  }
}

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
  if (g === 'choosing') status = S.myChoice ? 'Kaart gekozen — wachten op de anderen…' : 'Kies een kaart uit je hand';
  else if (g === 'resolving') status = 'Kaarten worden neergelegd…';
  else if (g === 'chooseRow') {
    alert = needMyRow;
    status = needMyRow ? 'Je kaart is te laag — kies een rij om op te ruimen!' : `${esc(name(S.waitingFor))} moet een rij kiezen…`;
  } else if (g === 'roundEnd') status = 'Ronde afgelopen — de volgende start zo…';
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

  const secs = S.deadline && (g === 'choosing' || needMyRow) ? Math.max(0, Math.round((S.deadline - Date.now()) / 1000)) : null;

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
    ${S.hand.length ? `<div class="dock"><div class="inner">
      <button id="play" class="lg" ${selected && canPlay ? '' : 'disabled'} ${canPlay ? '' : 'style="visibility:hidden" tabindex="-1"'}>${selected ? `Speel ${selected}` : 'Kies een kaart'}</button>
      ${handHtml}</div></div>` : ''}`;

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
        fly(ghost, from, target, { sel, delay: ev.taken ? 300 : 0, onland: () => { sfx.land(); buzz(12); } });
        sfx.whoosh(ev.taken ? 0.3 : 0);
      }
      if (ev.taken) takeRow(ev, takenRects);
    }
    if (needMyRow && !prev.myRow) { sfx.alert(); buzz([60, 60, 60]); }
    if (g === 'gameOver' && !prev.over) { sfx.win(); confetti(); buzz([40, 40, 40, 40, 120]); }
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
    const s = Math.max(0, Math.round((S.deadline - Date.now()) / 1000));
    el.textContent = `⏱ ${s}s`;
    el.classList.toggle('hot', s <= 10);
  }
}, 1000);

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
  if (urlCode) setTimeout(() => { const c = document.getElementById('code'); if (c) c.value = urlCode.toUpperCase(); }, 0);
}
