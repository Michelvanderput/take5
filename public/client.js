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

// ---------- rendering ----------
const cowSvg = (n = 1) => '<svg class="cow"><use href="#cow"/></svg>'.repeat(n);
const hue = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const avatar = (name) => `<span class="avatar" style="--h:${hue(name)}">${esc([...name][0] || '?').toUpperCase()}</span>`;

function cardHtml(n, cls = '') {
  const p = points(n);
  return `<div class="card p${p} ${cls}" data-card="${n}"><span class="num">${n}</span><span class="cows">${cowSvg(p)}</span></div>`;
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
    return `<div class="pl ${p.id === S.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
      <span class="avatar" style="--h:${hue(p.name)}">${esc([...p.name][0] || '?').toUpperCase()}${dot}</span>
      <span class="nm">${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === S.hostId ? ' 👑' : ''}</span>
      <span class="sc"><b>${p.score}</b>${p.roundPoints ? ` <span style="color:var(--t5)">+${p.roundPoints}</span>` : ''} ${cowSvg()}</span>
      <span class="bar"><i class="${pct >= 75 ? 'hi' : ''}" style="width:${pct}%"></i></span></div>`;
  }).join('')}</div>`;
}

function renderLobby() {
  setMain('lobby');
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
        ${host && p.id !== S.you ? `<button class="sec sm" data-kick="${p.id}" title="Verwijder">✕</button>` : ''}</div>`).join('')}</div>
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
  const fresh = ev && ev.seq !== lastSeq;
  if (ev) lastSeq = ev.seq;
  const needMyRow = g === 'chooseRow' && S.waitingFor === S.you;

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
        ? cardHtml(row[k], fresh && ev.row === i && row[k] === ev.card ? 'pop' : '')
        : '<div class="card empty"></div>';
    }
    return `<div class="${cls}" data-row="${i}"><span class="lane">${i + 1}</span>${cells}<span class="tot">${cowSvg()} ${sum(row)}</span></div>`;
  }).join('');

  const reveal = S.turnCards.length
    ? `<div class="tray">${S.turnCards.map((t) => `<div class="it ${t.done ? 'done' : ''}">${cardHtml(t.card, 'sm')}<span class="who">${esc(name(t.playerId))}</span></div>`).join('')}</div>`
    : '';

  const canPlay = g === 'choosing' && !S.myChoice;
  const handHtml = S.hand.length
    ? `<div class="hand ${canPlay ? '' : 'locked'}">${S.hand.map((c) => cardHtml(c, c === (S.myChoice ?? selected) ? 'sel' : '')).join('')}</div>`
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
      <span class="pill" style="margin-left:auto">Kamer ${S.code}</span>
      ${secs !== null ? `<span class="pill timer ${secs <= 10 ? 'hot' : ''}" id="timer">⏱ ${secs}s</span>` : ''}
    </div>
    ${playersHtml(g === 'choosing')}
    <div class="status"><span class="main ${alert ? 'alert' : ''}">${status}</span>${evText ? `<span class="sub">${evText}</span>` : ''}</div>
    <div class="board">${rowsHtml}</div>
    ${reveal}
    ${over}
    ${S.hand.length ? `<div class="dock"><div class="inner">
      ${canPlay ? `<button id="play" class="lg" ${selected ? '' : 'disabled'}>${selected ? `Speel ${selected}` : 'Kies een kaart'}</button>` : ''}
      ${handHtml}</div></div>` : ''}`;

  if (S.myChoice === null && selected !== null && !S.hand.includes(selected)) selected = null;
  if (canPlay) {
    app.querySelectorAll('.hand .card').forEach((el) => (el.onclick = () => { selected = +el.dataset.card; renderGame(); }));
    const b = document.getElementById('play');
    if (b) b.onclick = () => { send({ t: 'play', card: selected }); selected = null; };
  }
  if (needMyRow) app.querySelectorAll('.brow').forEach((el) => (el.onclick = () => send({ t: 'pickRow', row: +el.dataset.row })));
  const rm = document.getElementById('rematch');
  if (rm) rm.onclick = () => send({ t: 'rematch' });
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

// ---------- start ----------
const urlCode = new URLSearchParams(location.search).get('code');
if (session) {
  send({ t: 'resume' });
} else {
  render();
  if (urlCode) setTimeout(() => { const c = document.getElementById('code'); if (c) c.value = urlCode.toUpperCase(); }, 0);
}
