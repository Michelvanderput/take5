'use strict';
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

let ws = null;
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

function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => onOpen && onOpen();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'joined') {
      session = { code: msg.code, token: msg.token };
      localStorage.setItem('take5', JSON.stringify(session));
    } else if (msg.t === 'state') {
      S = msg.s;
      render();
    } else if (msg.t === 'error') {
      toast(msg.m);
      if (msg.m === 'Sessie verlopen' || msg.m === 'Kamer niet gevonden') clearSession();
    } else if (msg.t === 'kicked') {
      clearSession();
      toast('Je bent uit de kamer gezet');
    }
  };
  ws.onclose = () => {
    if (session) setTimeout(() => connect(() => send({ t: 'resume', ...session })), 1500);
  };
}

function clearSession() {
  session = null;
  S = null;
  localStorage.removeItem('take5');
  render();
}

function send(m) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

function ensureConn(then) {
  if (ws && ws.readyState === 1) return then();
  connect(then);
}

// ---------- rendering ----------
function cardHtml(n, cls = '') {
  const p = points(n);
  return `<div class="card p${p} ${cls}" data-card="${n}"><span class="n">${n}</span><span class="cows">${'🐮'.repeat(p)}</span></div>`;
}

function render() {
  if (!S) return renderHome();
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderHome() {
  app.innerHTML = `
    <h1>🐮 Take 5!</h1>
    <div class="panel">
      <p>Speel online met vrienden. Iedereen opent deze pagina op zijn eigen apparaat.</p>
      <div class="row-flex"><input id="name" placeholder="Jouw naam" maxlength="16" value="${esc(pendingName)}"></div>
    </div>
    <div class="panel">
      <h3>Nieuw spel</h3>
      <button id="create">Maak kamer</button>
    </div>
    <div class="panel">
      <h3>Meedoen</h3>
      <div class="row-flex">
        <input id="code" placeholder="Kamercode" maxlength="4" style="text-transform:uppercase;width:130px">
        <button id="join">Deelnemen</button>
      </div>
    </div>`;
  const name = () => {
    pendingName = document.getElementById('name').value.trim();
    localStorage.setItem('take5name', pendingName);
    return pendingName || 'Speler';
  };
  document.getElementById('create').onclick = () => ensureConn(() => send({ t: 'create', name: name() }));
  document.getElementById('join').onclick = () =>
    ensureConn(() => send({ t: 'join', name: name(), code: document.getElementById('code').value }));
}

function playersHtml(waiting) {
  return `<div class="players">${S.players.map((p) => {
    const cls = ['pl', p.id === S.you ? 'me' : '', p.connected ? '' : 'off', waiting && !p.hasChosen ? 'wait' : ''].join(' ');
    const status = waiting ? (p.hasChosen ? '✅' : '🤔') : '';
    return `<div class="${cls}"><div class="nm">${p.bot ? '🤖 ' : ''}${esc(p.name)} ${status}${p.id === S.hostId ? ' 👑' : ''}</div>
      <div class="sc">Totaal ${p.score} · ronde ${p.roundPoints}🐮</div></div>`;
  }).join('')}</div>`;
}

function renderLobby() {
  const host = S.hostId === S.you;
  app.innerHTML = `
    <h1>🐮 Take 5!</h1>
    <div class="panel">
      <div class="muted">Kamercode — deel deze met je vrienden</div>
      <div class="code">${S.code}</div>
      <button class="sec" id="copy">Kopieer uitnodigingslink</button>
    </div>
    <div class="panel">
      <h3>Spelers (${S.players.length}/10)</h3>
      <table>${S.players.map((p) => `<tr><td>${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === S.hostId ? ' 👑' : ''}${p.id === S.you ? ' (jij)' : ''}</td>
        <td>${host && p.id !== S.you ? `<button class="sec" data-kick="${p.id}">Verwijder</button>` : ''}</td></tr>`).join('')}</table>
      ${host ? `<div class="row-flex" style="margin-top:12px">
        <button class="sec" id="bot">+ Bot</button>
        <label>Eindscore: <select id="target">${[30, 45, 66, 100].map((v) => `<option ${v === S.targetScore ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <button id="start">Start spel</button></div>`
        : `<p class="muted">Wachten tot de host het spel start… (eindscore ${S.targetScore})</p>`}
    </div>
    <button class="sec" id="leave">Verlaat kamer</button>`;
  document.getElementById('copy').onclick = () => {
    const url = `${location.origin}/?code=${S.code}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link gekopieerd'), () => prompt('Kopieer link', url));
  };
  document.getElementById('leave').onclick = () => { send({ t: 'leave' }); clearSession(); };
  if (host) {
    document.getElementById('bot').onclick = () => send({ t: 'addBot' });
    document.getElementById('start').onclick = () => send({ t: 'start' });
    document.getElementById('target').onchange = (e) => send({ t: 'target', v: +e.target.value });
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => send({ t: 'kick', id: b.dataset.kick })));
  }
}

function renderGame() {
  const g = S.gamePhase;
  const name = (id) => (S.players.find((p) => p.id === id) || {}).name || '?';
  const ev = S.lastEvent;
  const fresh = ev && ev.seq !== lastSeq;
  if (ev) lastSeq = ev.seq;
  const needMyRow = g === 'chooseRow' && S.waitingFor === S.you;

  let status = '';
  if (g === 'choosing') status = S.myChoice ? 'Kaart gekozen — wachten op de anderen…' : 'Kies een kaart uit je hand';
  else if (g === 'resolving') status = 'Kaarten worden neergelegd…';
  else if (g === 'chooseRow') status = needMyRow ? '⚠ Je kaart is te laag — klik een rij om op te ruimen!' : `${esc(name(S.waitingFor))} moet een rij kiezen…`;
  else if (g === 'roundEnd') status = 'Ronde afgelopen — volgende ronde start zo…';
  else if (g === 'gameOver') status = '🏆 Spel afgelopen!';

  let evText = '';
  if (ev) {
    if (ev.type === 'sixth') evText = `${esc(name(ev.playerId))} legt de 6e kaart en neemt ${ev.points} 🐮`;
    else if (ev.type === 'take') evText = `${esc(name(ev.playerId))} neemt een rij: ${ev.points} 🐮`;
  }

  const rowsHtml = S.rows.map((row, i) => {
    const cls = ['brow', needMyRow ? 'pick' : '', ev && ev.row === i ? 'last' : ''].join(' ');
    let cells = '';
    for (let k = 0; k < 5; k++) {
      cells += row[k] !== undefined
        ? cardHtml(row[k], fresh && ev.row === i && row[k] === ev.card ? 'pop' : '')
        : '<div class="card empty"></div>';
    }
    return `<div class="${cls}" data-row="${i}">${cells}<span class="muted" style="margin-left:auto;align-self:center">${sum(row)}🐮</span></div>`;
  }).join('');

  const reveal = S.turnCards.length
    ? `<div class="reveal">${S.turnCards.map((t) => `<div class="${t.done ? 'done' : ''}">${cardHtml(t.card, 'sm')}<div class="who">${esc(name(t.playerId))}</div></div>`).join('')}</div>`
    : '';

  const canPlay = g === 'choosing' && !S.myChoice;
  const handHtml = S.hand.length
    ? `<div class="hand ${canPlay ? '' : 'locked'}">${S.hand.map((c) => cardHtml(c, c === (S.myChoice ?? selected) ? 'sel' : '')).join('')}</div>`
    : '';

  let over = '';
  if (g === 'gameOver') {
    const rank = S.players.slice().sort((a, b) => a.score - b.score);
    over = `<div class="panel"><h2>Winnaar: ${S.winners.map((id) => esc(name(id))).join(' & ')} 🏆</h2>
      <table>${rank.map((p, i) => `<tr><td>${i + 1}.</td><td>${esc(p.name)}</td><td>${p.score} 🐮</td></tr>`).join('')}</table>
      ${S.hostId === S.you ? '<button id="rematch">Terug naar lobby</button>' : '<p class="muted">Wachten op de host…</p>'}</div>`;
  }

  const secs = S.deadline && (g === 'choosing' || needMyRow) ? Math.max(0, Math.round((S.deadline - Date.now()) / 1000)) : null;

  app.innerHTML = `
    <div class="row-flex"><strong>Ronde ${S.round}</strong><span class="muted">eindigt bij ${S.targetScore} 🐮</span>
      <span class="muted" style="margin-left:auto">Kamer ${S.code}${secs !== null ? ` · ⏱ ${secs}s` : ''}</span></div>
    ${playersHtml(g === 'choosing')}
    <div class="status">${status}${evText ? `<div class="muted" style="font-size:.9rem">${evText}</div>` : ''}</div>
    <div class="board">${rowsHtml}</div>
    ${reveal}
    ${over}
    ${handHtml}
    ${canPlay ? `<div class="row-flex" style="justify-content:center"><button id="play" ${selected ? '' : 'disabled'}>Speel ${selected || 'kaart'}</button></div>` : ''}`;

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
  if (S && S.phase === 'game' && S.deadline && S.gamePhase !== 'resolving') {
    const el = app.querySelector('.row-flex .muted:last-child');
    if (el) el.textContent = `Kamer ${S.code} · ⏱ ${Math.max(0, Math.round((S.deadline - Date.now()) / 1000))}s`;
  }
}, 1000);

// ---------- start ----------
const urlCode = new URLSearchParams(location.search).get('code');
if (session) {
  ensureConn(() => send({ t: 'resume', ...session }));
} else {
  render();
  if (urlCode) setTimeout(() => { const c = document.getElementById('code'); if (c) c.value = urlCode.toUpperCase(); }, 0);
}
