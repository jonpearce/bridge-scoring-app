// =============================================================
//  Chicago bridge scoring — phone app (no build step)
//  Screens: login · play (session + quick board entry) · other results · day summary
//  All saving goes through /api (the server checks the access code and
//  calculates the official score). Scores shown while entering are a preview
//  from the same scoring engine.
// =============================================================
import {
  scoreDeal, sessionTotals, daySummary, vulnerabilityFor, vulnerabilityText, dealerFor, boardNumberFor,
  contractText, outcomeText, leadText, strainSymbol, seatName, sideOf, sideName, pairKey, pairLabel,
  LEAD_RANKS, SUITS,
} from './lib/chicago.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const red = (s) => s === 'H' || s === 'D';
const suitHtml = (s) => `<span class="suit ${red(s) ? 'red' : ''}">${strainSymbol(s)}</span>`;
const contractHtml = (d) => d.passedOut ? 'Passed out'
  : `${d.level}${d.strain === 'NT' ? 'NT' : suitHtml(d.strain)}${d.doubled ? ' ' + d.doubled : ''}`;
const leadHtml = (d) => (d.leadSuit ? suitHtml(d.leadSuit) : '') + esc(d.leadRank || '') || '—';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

// ---------- local storage (survives refresh / closing the browser) ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('chi:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('chi:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('chi:' + k); } catch { /* ignore */ } },
};

// ---------- state ----------
const state = {
  data: null,          // { date, today, days, sessions }
  viewDate: null,      // date shown on Day summary / Other results
  entry: null,         // board-entry draft
  loading: false,
};
const mine = () => {
  const m = store.get('my');
  return m && state.data && m.date === state.data.today ? m : null;
};
const sessionById = (id) => state.data?.sessions.find((s) => s.id === id);

// ---------- server calls ----------
class ApiError extends Error { constructor(status, msg, body) { super(msg); this.status = status; this.body = body; } }
async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch('/api/' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your signal and try again.');
  }
  let body = {};
  try { body = await r.json(); } catch { /* not JSON */ }
  if (r.status === 401 && path !== 'login') { go('#/login'); throw new ApiError(401, body.error || 'Please enter the access code.'); }
  if (!r.ok) throw new ApiError(r.status, body.error || 'Something went wrong. Please try again.', body);
  return body;
}

async function loadDay(date) {
  const q = date ? `?date=${date}` : '';
  const d = await api('sessions' + q);
  if (!date || date === d.today) state.data = d;
  return d;
}

// ---------- toast ----------
let toastTimer;
function toast(msg, kind = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = `toast show ${kind}`;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 5000 : 2600);
}

// ---------- routing ----------
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else render(); };
window.addEventListener('hashchange', () => render());

function route() {
  const parts = (location.hash || '#/play').slice(2).split('/');
  return { name: parts[0] || 'play', a: parts[1] ? decodeURIComponent(parts[1]) : null, b: parts[2] ? decodeURIComponent(parts[2]) : null };
}

async function render() {
  const r = route();
  if (r.name === 'login') return renderLogin();
  if (!state.data) {
    $app.innerHTML = shell('play', '<p class="muted center pad">Loading…</p>');
    try { await loadDay(); } catch (e) { if (e.status !== 401) $app.innerHTML = shell('play', errorBlock(e.message)); return; }
  }
  const screens = { play: renderPlay, new: renderNew, edit: renderNew, s: renderSession, deal: renderEntry, others: renderOthers, board: renderBoard, day: renderDay, pair: renderPair };
  (screens[r.name] || renderPlay)(r);
  window.scrollTo(0, 0);
}

function shell(tab, inner) {
  const t = (id, label, icon) => `<a href="#/${id}" class="tab ${tab === id ? 'on' : ''}" ${tab === id ? 'aria-current="page"' : ''}><span class="ti" aria-hidden="true">${icon}</span>${label}</a>`;
  return `<main class="screen">${inner}</main>
  <nav class="tabs" aria-label="Main">
    ${t('play', 'Play', '♠')}${t('others', 'Other results', '♦')}${t('day', 'Day summary', '♣')}
  </nav>`;
}
const errorBlock = (msg) => `<div class="card error"><p>${esc(msg)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;

// =============================================================
//  Login
// =============================================================
function renderLogin() {
  $app.innerHTML = `<main class="screen login">
    <div class="brand"><div class="logo" aria-hidden="true">♠♥<br>♦♣</div><h1>Chicago Bridge</h1><p class="muted">Four-deal scoring for our social games</p></div>
    <form class="card" id="loginForm">
      <label for="code" class="lbl">Access code</label>
      <input id="code" class="input big" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
      <p id="loginErr" class="err" role="alert"></p>
      <button class="btn primary big" type="submit">Enter</button>
    </form></main>`;
  const f = document.getElementById('loginForm');
  f.code.focus();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      await api('login', { method: 'POST', body: { code: f.code.value } });
      state.data = null;
      go('#/play');
    } catch (e) {
      document.getElementById('loginErr').textContent = e.message;
      btn.disabled = false; btn.textContent = 'Enter';
      f.code.select();
    }
  };
}

// =============================================================
//  Play — home
// =============================================================
function renderPlay() {
  const m = mine();
  if (m && sessionById(m.sessionId)) return go(`#/s/${m.sessionId}`);
  const sessions = state.data.sessions;
  const list = sessions.length
    ? sessions.slice().reverse().map((s) => {
        const n = s.deals.length;
        return `<button class="row-btn" data-join="${s.id}">
          <span><strong>${esc(s.location)}</strong><br><span class="muted small">N/S ${esc(pairLabel(s.nsP1, s.nsP2))} · E/W ${esc(pairLabel(s.ewP1, s.ewP2))}</span></span>
          <span class="pill ${n === 4 ? 'done' : ''}">${n === 4 ? 'Done' : `${n} of 4`}</span></button>`;
      }).join('')
    : '<p class="muted">No tables have started yet today.</p>';
  $app.innerHTML = shell('play', `
    <header class="top"><h1>Play</h1><p class="muted">${fmtDate(state.data.today)}</p></header>
    <a class="btn primary big block" href="#/new">Start a new table</a>
    <section class="card"><h2>Join a table already started</h2><p class="muted small">If the other pair at your table has already set it up, tap it here.</p><div class="stack">${list}</div></section>`);
  $app.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => chooseSide(b.dataset.join)));
}

function chooseSide(sessionId) {
  const s = sessionById(sessionId);
  sheet(`<h2>Which pair are you?</h2>
    <p class="muted">${esc(s.location)}</p>
    <div class="stack">
      <button class="btn big ns" data-side="NS">North/South<br><span class="small">${esc(pairLabel(s.nsP1, s.nsP2))}</span></button>
      <button class="btn big ew" data-side="EW">East/West<br><span class="small">${esc(pairLabel(s.ewP1, s.ewP2))}</span></button>
    </div>`, (root) => root.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => {
      store.set('my', { date: state.data.today, sessionId, side: b.dataset.side });
      closeSheet(); go(`#/s/${sessionId}`);
    })));
}

// =============================================================
//  Start / edit a table session
// =============================================================
function renderNew(r) {
  const editing = r.name === 'edit' ? sessionById(r.a) : null;
  const prefs = store.get('prefs', {});
  const last = store.get('lastSession');
  const mySide = editing ? (mine()?.side || 'NS') : (last?.side || 'NS');
  const nameList = [...new Set(state.data.sessions.flatMap((s) => [s.nsP1, s.nsP2, s.ewP1, s.ewP2]).concat(prefs.names || []))];
  const played = editing && editing.deals.length > 0;
  const v = editing
    ? { location: editing.location, startBoard: editing.startBoard, firstDealer: editing.firstDealer,
        us1: mySide === 'NS' ? editing.nsP1 : editing.ewP1, us2: mySide === 'NS' ? editing.nsP2 : editing.ewP2,
        them1: mySide === 'NS' ? editing.ewP1 : editing.nsP1, them2: mySide === 'NS' ? editing.ewP2 : editing.nsP2 }
    : { location: prefs.location || '', startBoard: last ? last.startBoard + 4 : 1, firstDealer: 'N',
        us1: prefs.names?.[0] || '', us2: prefs.names?.[1] || '', them1: '', them2: '' };

  $app.innerHTML = shell('play', `
    <header class="top"><a href="${editing ? `#/s/${editing.id}` : '#/play'}" class="back">‹ Back</a><h1>${editing ? 'Table details' : 'Start a new table'}</h1></header>
    <form id="newForm" class="stack" autocomplete="off">
      <section class="card stack">
        <label class="lbl" for="loc">Where are you playing?</label>
        <input id="loc" name="location" class="input" placeholder="e.g. Clubhouse, table 2" value="${esc(v.location)}" maxlength="80" required enterkeyhint="next">
        <div class="two">
          <div><label class="lbl" for="sb">First board</label>
            <div class="stepper"><button type="button" class="step" data-step="-1" aria-label="Lower" ${played ? 'disabled' : ''}>−</button>
            <input id="sb" name="startBoard" class="input center" inputmode="numeric" pattern="[0-9]*" value="${v.startBoard}" ${played ? 'disabled' : ''}>
            <button type="button" class="step" data-step="1" aria-label="Higher" ${played ? 'disabled' : ''}>+</button></div>
            <p class="small muted" id="boardsLine"></p></div>
          <div><span class="lbl">Who deals first?</span>
            <div class="seg four" role="radiogroup" aria-label="First dealer">${['N', 'E', 'S', 'W'].map((d) => `<button type="button" role="radio" data-dealer="${d}" aria-checked="${v.firstDealer === d}" class="${v.firstDealer === d ? 'on' : ''}" ${played ? 'disabled' : ''}>${d}</button>`).join('')}</div></div>
        </div>
        ${played ? '<p class="small muted">Board numbers and dealer are fixed once a result has been saved.</p>' : ''}
      </section>
      <section class="card stack">
        <span class="lbl">Your pair is sitting</span>
        <div class="seg two-way" role="radiogroup" aria-label="Your direction">
          <button type="button" role="radio" data-side="NS" class="ns ${mySide === 'NS' ? 'on' : ''}" aria-checked="${mySide === 'NS'}">North/South</button>
          <button type="button" role="radio" data-side="EW" class="ew ${mySide === 'EW' ? 'on' : ''}" aria-checked="${mySide === 'EW'}">East/West</button>
        </div>
        <label class="lbl" id="usLbl">Your pair</label>
        <div class="two"><input name="us1" class="input" placeholder="Player 1" value="${esc(v.us1)}" list="names" required maxlength="40" aria-labelledby="usLbl">
        <input name="us2" class="input" placeholder="Player 2" value="${esc(v.us2)}" list="names" required maxlength="40" aria-labelledby="usLbl"></div>
        <label class="lbl" id="themLbl">Opponents</label>
        <div class="two"><input name="them1" class="input" placeholder="Player 1" value="${esc(v.them1)}" list="names" required maxlength="40" aria-labelledby="themLbl">
        <input name="them2" class="input" placeholder="Player 2" value="${esc(v.them2)}" list="names" required maxlength="40" aria-labelledby="themLbl"></div>
        <datalist id="names">${nameList.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </section>
      <p id="formErr" class="err" role="alert"></p>
      <button class="btn primary big block" type="submit">${editing ? 'Save details' : 'Start playing'}</button>
    </form>`);

  const f = document.getElementById('newForm');
  let dealer = v.firstDealer, side = mySide;
  const token = uuid();
  const sbInput = f.startBoard;
  const updateBoards = () => {
    const n = parseInt(sbInput.value, 10);
    document.getElementById('boardsLine').textContent = n > 0 ? `Boards ${n}, ${n + 1}, ${n + 2}, ${n + 3}` : '';
    const lbl = (s) => (s === 'NS' ? 'North/South' : 'East/West');
    document.getElementById('usLbl').textContent = `Your pair (${lbl(side)})`;
    document.getElementById('themLbl').textContent = `Opponents (${lbl(side === 'NS' ? 'EW' : 'NS')})`;
  };
  updateBoards();
  sbInput.oninput = updateBoards;
  f.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { sbInput.value = Math.max(1, (parseInt(sbInput.value, 10) || 1) + Number(b.dataset.step)); updateBoards(); }));
  f.querySelectorAll('[data-dealer]').forEach((b) => (b.onclick = () => { dealer = b.dataset.dealer; radio(f, '[data-dealer]', b); }));
  f.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; radio(f, '[data-side]', b); updateBoards(); }));

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const body = {
      location: fd.location, startBoard: parseInt(editing && played ? editing.startBoard : sbInput.value, 10), firstDealer: dealer,
      nsP1: side === 'NS' ? fd.us1 : fd.them1, nsP2: side === 'NS' ? fd.us2 : fd.them2,
      ewP1: side === 'EW' ? fd.us1 : fd.them1, ewP2: side === 'EW' ? fd.us2 : fd.them2,
    };
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const out = editing
        ? await api('sessions', { method: 'PATCH', body: { id: editing.id, ...body } })
        : await api('sessions', { method: 'POST', body: { ...body, clientToken: token } });
      store.set('prefs', { location: fd.location, names: [fd.us1, fd.us2] });
      store.set('my', { date: state.data.today, sessionId: out.session.id, side });
      store.set('lastSession', { startBoard: out.session.startBoard, side });
      upsertSession(out.session);
      toast(editing ? 'Details saved' : 'Table started');
      go(`#/s/${out.session.id}`);
    } catch (e) {
      document.getElementById('formErr').textContent = e.message;
      btn.disabled = false;
    }
  };
}

function radio(root, sel, on) {
  root.querySelectorAll(sel).forEach((b) => { b.classList.toggle('on', b === on); b.setAttribute('aria-checked', b === on); });
}
function upsertSession(s) {
  const i = state.data.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) state.data.sessions[i] = s; else state.data.sessions.push(s);
}

// =============================================================
//  Session — four-board overview
// =============================================================
function dealsFor(s) {
  return [1, 2, 3, 4].map((n) => {
    const d = s.deals.find((x) => x.dealNo === n);
    const vul = vulnerabilityFor(n, s.firstDealer);
    return { n, board: boardNumberFor(n, s.startBoard), vul, dealer: dealerFor(n, s.firstDealer), d, scored: d ? scoreDeal(d, s.firstDealer) : null };
  });
}

function renderSession(r) {
  const s = sessionById(r.a);
  if (!s) { $app.innerHTML = shell('play', errorBlock('This table could not be found.')); return; }
  const m = mine();
  const isMine = m?.sessionId === s.id;
  const rows = dealsFor(s);
  const done = rows.filter((x) => x.d).length;
  const t = sessionTotals(rows.filter((x) => x.scored).map((x) => x.scored));
  const next = rows.find((x) => !x.d);
  const youAre = isMine ? `<p class="small">You are <strong class="${m.side === 'NS' ? 'tns' : 'tew'}">${sideName(m.side)}</strong></p>` : '';

  const card = (x) => {
    const head = `<div class="bhead"><span class="bnum">Board ${x.board}</span><span class="vul">${vulBadge(x.vul)}</span></div>`;
    if (!x.d) return `<a class="card board todo" href="#/deal/${s.id}/${x.n}">${head}
      <p class="muted small">Deal ${x.n} · Dealer ${seatName(x.dealer)}</p><span class="btn ghost">Enter result ›</span></a>`;
    const sc = x.scored;
    return `<a class="card board" href="#/deal/${s.id}/${x.n}" aria-label="Board ${x.board}, tap to correct">${head}
      <dl class="facts">
        <div><dt>Contract</dt><dd>${contractHtml(x.d)}${x.d.passedOut ? '' : ` <span class="by">by ${seatName(x.d.declarer)}</span>`}</dd></div>
        ${x.d.passedOut ? '' : `<div><dt>Result</dt><dd>${esc(sc.outcome)}</dd></div>
        <div><dt>Contract winner</dt><dd>${sc.winner === 'NS' ? 'N/S' : 'E/W'}</dd></div>
        <div><dt>Lead</dt><dd>${leadHtml(x.d)}</dd></div>`}
      </dl>
      <div class="scores">${scorePair(sc.nsScore)}</div>
      <span class="small muted edit">Tap to correct ›</span></a>`;
  };

  const tableRows = rows.map((x) => `<tr>
    <td>${x.board}</td><td>${vulnerabilityText(x.vul).replace(' vulnerable', '')}</td>
    <td>${x.d ? contractHtml(x.d) : '<span class="muted">—</span>'}</td>
    <td>${x.d && !x.d.passedOut ? x.scored.winner.replace('NS', 'N/S').replace('EW', 'E/W') : ''}</td>
    <td>${x.d && !x.d.passedOut ? leadHtml(x.d) : ''}</td>
    <td>${x.d ? esc(x.scored.outcome) : '<a href="#/deal/' + s.id + '/' + x.n + '">Enter</a>'}</td>
    <td class="num tns">${x.d && x.scored.nsScore > 0 ? '+' + x.scored.nsScore : ''}</td>
    <td class="num tew">${x.d && x.scored.ewScore > 0 ? '+' + x.scored.ewScore : ''}</td>
    <td>${x.d ? `<a href="#/deal/${s.id}/${x.n}">Edit</a>` : ''}</td></tr>`).join('');

  $app.innerHTML = shell('play', `
    <header class="top">
      <h1>${esc(s.location)}</h1>
      <p class="pairs"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}<br><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
      ${youAre}
    </header>
    <div class="progress" aria-label="${done} of 4 boards completed"><div class="bar"><span style="width:${done * 25}%"></span></div><strong>${done} of 4 boards completed</strong></div>
    ${next ? `<a class="btn primary big block" href="#/deal/${s.id}/${next.n}">Enter board ${next.board}</a>` : ''}
    ${done ? totalsCard(t) : ''}
    <div class="boards">${rows.map(card).join('')}</div>
    <div class="wide-only card"><table class="results"><thead><tr><th>Board</th><th>Vul</th><th>Bid</th><th>Winner</th><th>Lead</th><th>Result</th><th class="num">N/S</th><th class="num">E/W</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <div class="stack foot">
      ${done === 4 ? '<button class="btn primary big block" id="nextSession">Start the next session</button>' : ''}
      ${isMine ? '' : '<button class="btn block" id="claim">This is my table</button>'}
      <a class="btn ghost block" href="#/edit/${s.id}">Change names or table</a>
      ${isMine ? '<button class="btn ghost block" id="leave">Leave this table</button>' : ''}
    </div>`);

  const leave = () => { store.del('my'); go('#/play'); };
  document.getElementById('leave')?.addEventListener('click', () => {
    if (done < 4 && !confirm('Leave this table? Its results stay saved and you can rejoin from the Play screen.')) return;
    leave();
  });
  document.getElementById('nextSession')?.addEventListener('click', () => { store.set('lastSession', { startBoard: s.startBoard, side: m?.side || 'NS' }); store.del('my'); go('#/new'); });
  document.getElementById('claim')?.addEventListener('click', () => chooseSide(s.id));
}

function totalsCard(t) {
  const verdict = !t.complete ? 'So far' : t.net === 0 ? 'A tie' : `${t.net > 0 ? 'North/South' : 'East/West'} win`;
  return `<section class="card totals ${t.complete ? 'final' : ''}">
    <div class="tot"><span class="tag ns">N/S</span><strong>${t.nsPoints}</strong></div>
    <div class="tot"><span class="tag ew">E/W</span><strong>${t.ewPoints}</strong></div>
    <div class="net"><span class="small">${verdict}</span><strong>${t.net === 0 ? 'Level' : `${t.net > 0 ? 'N/S' : 'E/W'} by ${Math.abs(t.net)}`}</strong></div>
  </section>`;
}

function vulBadge(v) {
  return `<span class="vb ${v.ns ? 'on' : ''}">N/S ${v.ns ? 'Vul' : 'Not vul'}</span><span class="vb ${v.ew ? 'on' : ''}">E/W ${v.ew ? 'Vul' : 'Not vul'}</span>`;
}
function scorePair(ns) {
  return `<span class="sc ns"><span class="tag ns">N/S</span> ${signed(ns)}</span><span class="sc ew"><span class="tag ew">E/W</span> ${signed(-ns)}</span>`;
}

// =============================================================
//  Board entry — designed for a few taps, one hand
// =============================================================
function renderEntry(r) {
  const s = sessionById(r.a);
  const n = Number(r.b);
  if (!s || ![1, 2, 3, 4].includes(n)) { $app.innerHTML = shell('play', errorBlock('This board could not be found.')); return; }
  const existing = s.deals.find((d) => d.dealNo === n);
  const draftKey = `draft:${s.id}:${n}`;
  const saved = existing ? {
    passedOut: existing.passedOut, level: existing.level, strain: existing.strain, doubled: existing.doubled || '', declarer: existing.declarer,
    diff: existing.passedOut ? 0 : existing.tricks - (existing.level + 6), leadSuit: existing.leadSuit, leadRank: existing.leadRank,
  } : null;
  state.entry = {
    sessionId: s.id, n, expectedUpdatedAt: existing?.updatedAt || null,
    e: store.get(draftKey) || saved || { passedOut: false, level: null, strain: null, doubled: '', declarer: null, diff: 0, leadSuit: null, leadRank: null },
  };
  const board = boardNumberFor(n, s.startBoard);
  const vul = vulnerabilityFor(n, s.firstDealer);

  $app.innerHTML = shell('play', `
    <header class="entry-head">
      <a href="#/s/${s.id}" class="back">‹ ${esc(s.location)}</a>
      <div class="bline"><span class="bnum big">Board ${board}</span><span class="muted small">Deal ${n} of 4 · Dealer ${seatName(dealerFor(n, s.firstDealer))}</span></div>
      <div class="vul">${vulBadge(vul)}</div>
      <nav class="dealnav" aria-label="Boards in this session">${[1, 2, 3, 4].map((k) => `<a href="#/deal/${s.id}/${k}" class="${k === n ? 'on' : ''} ${s.deals.some((d) => d.dealNo === k) ? 'done' : ''}">${boardNumberFor(k, s.startBoard)}</a>`).join('')}</nav>
    </header>
    ${existing ? '<p class="note">Already saved — change anything and tap Save to correct it.</p>' : ''}
    <div id="entry"></div>
    <section class="card"><h2>On other tables</h2><div id="others">${othersOnBoard(board, s.id)}</div></section>
    <div class="savebar"><div id="preview" class="preview" aria-live="polite"></div><button class="btn primary big" id="saveBtn">Save result</button></div>`);
  drawEntry();
  document.getElementById('saveBtn').onclick = () => saveEntry(draftKey);
}

function drawEntry() {
  const { e } = state.entry;
  const s = sessionById(state.entry.sessionId);
  const box = document.getElementById('entry');
  if (e.passedOut) {
    box.innerHTML = `<section class="card center"><p class="passed">Passed out</p><p class="muted">No contract — the board scores 0 for both sides.</p>
      <button class="btn" data-act="unpass">Undo — it was played</button></section>`;
  } else {
    const need = e.level ? e.level + 6 : null;
    const tricks = need != null ? need + e.diff : null;
    const res = need == null ? '' : e.diff === 0 ? 'Made exactly' : e.diff > 0 ? `Made +${e.diff}` : `Down ${-e.diff}`;
    const btn = (attr, val, label, on, cls = '') => `<button type="button" class="key ${cls} ${on ? 'on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${label}</button>`;
    box.innerHTML = `
      <section class="card keys">
        <h2 class="kh">Contract</h2>
        <div class="grid seven">${[1, 2, 3, 4, 5, 6, 7].map((l) => btn('level', l, l, e.level === l)).join('')}</div>
        <div class="grid five">${['C', 'D', 'H', 'S', 'NT'].map((st) => btn('strain', st, st === 'NT' ? 'NT' : suitHtml(st), e.strain === st, 'suitkey')).join('')}</div>
        <div class="grid three dbl">${[['', 'Undoubled'], ['X', 'Doubled'], ['XX', 'Redoubled']].map(([v, l]) => btn('dbl', v || 'none', l, (e.doubled || '') === v, 'small')).join('')}</div>
      </section>
      <section class="card keys">
        <h2 class="kh">Declarer</h2>
        <div class="decl">${['N', 'S', 'E', 'W'].map((d) => btn('decl', d, `${seatName(d)}`, e.declarer === d, sideOf(d) === 'NS' ? 'ns' : 'ew')).join('')}</div>
      </section>
      <section class="card keys">
        <h2 class="kh">Tricks taken by declarer</h2>
        <div class="tricks">
          <button type="button" class="key round" data-trick="-1" aria-label="One trick fewer" ${need == null || tricks <= 0 ? 'disabled' : ''}>−</button>
          <div class="tval"><strong>${tricks ?? '—'}</strong><span>${need == null ? 'Choose the contract first' : esc(res)}</span></div>
          <button type="button" class="key round" data-trick="1" aria-label="One trick more" ${need == null || tricks >= 13 ? 'disabled' : ''}>+</button>
        </div>
      </section>
      <section class="card keys">
        <h2 class="kh">Opening lead <span class="muted small">(optional)</span></h2>
        <div class="grid four">${SUITS.map((st) => btn('lsuit', st, suitHtml(st), e.leadSuit === st, 'suitkey')).join('')}</div>
        <div class="grid seven ranks">${LEAD_RANKS.map((rk) => btn('lrank', rk, rk, e.leadRank === rk, 'small')).join('')}</div>
        ${e.leadSuit || e.leadRank ? '<button type="button" class="link" data-act="nolead">Clear the lead</button>' : ''}
      </section>
      <button type="button" class="btn ghost block" data-act="pass">Board was passed out</button>`;
  }
  box.onclick = onEntryTap;
  drawPreview(s);
}

function onEntryTap(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  const { e } = state.entry;
  const d = b.dataset;
  if (d.level) { e.level = Number(d.level); e.diff = Math.max(-(e.level + 6), Math.min(13 - (e.level + 6), e.diff)); }
  else if (d.strain) e.strain = d.strain;
  else if (d.dbl) e.doubled = d.dbl === 'none' ? '' : d.dbl;
  else if (d.decl) e.declarer = d.decl;
  else if (d.trick) { const t = e.level + 6 + e.diff + Number(d.trick); if (t >= 0 && t <= 13) e.diff += Number(d.trick); }
  else if (d.lsuit) e.leadSuit = e.leadSuit === d.lsuit ? null : d.lsuit;
  else if (d.lrank) e.leadRank = e.leadRank === d.lrank ? null : d.lrank;
  else if (d.act === 'nolead') { e.leadSuit = null; e.leadRank = null; }
  else if (d.act === 'pass') e.passedOut = true;
  else if (d.act === 'unpass') e.passedOut = false;
  else return;
  store.set(`draft:${state.entry.sessionId}:${state.entry.n}`, e);
  drawEntry();
}

function entryDeal() {
  const { e, n } = state.entry;
  if (e.passedOut) return { dealNo: n, passedOut: true };
  return { dealNo: n, passedOut: false, level: e.level, strain: e.strain, doubled: e.doubled || '', declarer: e.declarer,
    tricks: e.level ? e.level + 6 + e.diff : null, leadSuit: e.leadSuit, leadRank: e.leadRank };
}
const missingFor = (d) => d.passedOut ? null : !d.level ? 'Choose the contract level' : !d.strain ? 'Choose the suit or NT' : !d.declarer ? 'Choose the declarer' : null;

function drawPreview(s) {
  const d = entryDeal();
  const p = document.getElementById('preview');
  const miss = missingFor(d);
  const saveBtn = document.getElementById('saveBtn');
  if (miss) { p.innerHTML = `<span class="muted">${miss}</span>`; saveBtn.disabled = true; return; }
  const sc = scoreDeal(d, s.firstDealer);
  p.innerHTML = d.passedOut ? '<strong>Passed out · 0</strong>'
    : `<span class="pv-c">${contractHtml(d)} by ${seatName(d.declarer)}</span>${scorePair(sc.nsScore)}`;
  saveBtn.disabled = false;
}

async function saveEntry(draftKey) {
  const { sessionId, n, expectedUpdatedAt } = state.entry;
  const d = entryDeal();
  if (missingFor(d)) return;
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const out = await api('deal', { method: 'PUT', body: { sessionId, ...d, expectedUpdatedAt } });
    const s = sessionById(sessionId);
    s.deals = s.deals.filter((x) => x.dealNo !== n).concat(out.deal).sort((a, b) => a.dealNo - b.dealNo);
    store.del(draftKey);
    const sc = scoreDeal(out.deal, s.firstDealer);
    toast(`Saved · Board ${out.deal.boardNum} · N/S ${signed(sc.nsScore)}`);
    go(`#/s/${sessionId}`);
    loadDay().catch(() => {});
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Save result';
    if (e.status === 409) {
      const cur = e.body?.current;
      state.entry.expectedUpdatedAt = cur?.updatedAt || null;
      if (cur) {
        const s = sessionById(sessionId);
        s.deals = s.deals.filter((x) => x.dealNo !== n).concat(cur);
        const sc = scoreDeal(cur, s.firstDealer);
        alert(`This board was saved on another phone as ${contractText(cur)}${cur.passedOut ? '' : ' by ' + seatName(cur.declarer) + ', ' + outcomeText(cur)} (N/S ${signed(sc.nsScore)}).\n\nYour entry is still on screen. Tap Save again only if yours is the correct one.`);
      } else {
        toast(e.message, 'error');
      }
    } else {
      toast(e.status === 0 ? 'Not saved — no connection. Your entry is kept; tap Save again.' : e.message, 'error');
    }
  }
}

// ---------- results of one board on other tables ----------
function playsOfBoard(board, sessions) {
  const out = [];
  for (const s of sessions) for (const d of s.deals) if (d.boardNum === board) out.push({ s, d, sc: scoreDeal(d, s.firstDealer) });
  return out;
}

function othersOnBoard(board, mySessionId) {
  const plays = playsOfBoard(board, state.data.sessions).filter((p) => p.s.id !== mySessionId);
  if (!plays.length) return '<p class="muted">No other table has recorded this board yet.</p>';
  return `<p class="small muted">${plays.length} other table${plays.length > 1 ? 's' : ''}</p>` + plays.map(playCard).join('');
}

function playCard({ s, d, sc }, highlight = false) {
  return `<div class="play ${highlight ? 'mine' : ''}">
    <div class="pl-top"><strong>${esc(s.location)}</strong>${highlight ? '<span class="pill">Your table</span>' : ''}</div>
    <p class="small muted"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))} · <span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
    <p class="pl-res">${contractHtml(d)}${d.passedOut ? '' : ` by ${seatName(d.declarer)} · ${d.tricks} tricks · lead ${leadHtml(d)}`}</p>
    <p class="small muted">${esc(sc.vulText)}${d.passedOut ? '' : ' · ' + esc(sc.outcome)}</p>
    <div class="scores">${scorePair(sc.nsScore)}</div></div>`;
}

// =============================================================
//  Other results — every board played on a day
// =============================================================
async function ensureDate(r) {
  const date = r.a && /^\d{4}-\d{2}-\d{2}$/.test(r.a) ? r.a : state.data.today;
  if (date === state.data.today) return state.data;
  if (state.viewDate?.date === date) return state.viewDate;
  $app.innerHTML = shell(r.name === 'day' || r.name === 'pair' ? 'day' : 'others', '<p class="muted center pad">Loading…</p>');
  try { state.viewDate = await loadDay(date); } catch (e) { $app.innerHTML = shell('day', errorBlock(e.message)); return null; }
  return state.viewDate;
}

function dayPicker(data, base) {
  const days = [...new Set([data.today, ...data.days])].sort().reverse();
  return `<label class="sr" for="dayPick">Day</label><select id="dayPick" class="input">${days.map((d) => `<option value="${d}" ${d === data.date ? 'selected' : ''}>${d === data.today ? 'Today' : fmtDate(d)}</option>`).join('')}</select>`;
}
function wireDayPicker(base) {
  const el = document.getElementById('dayPick');
  if (el) el.onchange = () => go(`#/${base}/${el.value}`);
}

async function renderOthers(r) {
  const data = await ensureDate(r); if (!data) return;
  const boards = new Map();
  for (const s of data.sessions) for (const d of s.deals) boards.set(d.boardNum, (boards.get(d.boardNum) || 0) + 1);
  const m = mine();
  const myBoards = new Set(m && data.date === state.data.today ? (sessionById(m.sessionId)?.deals || []).map((d) => d.boardNum) : []);
  const list = [...boards.entries()].sort((a, b) => a[0] - b[0]);
  $app.innerHTML = shell('others', `
    <header class="top"><h1>Other results</h1>${dayPicker(data)}</header>
    <p class="muted">Tap a board to compare every table’s result.</p>
    ${list.length ? `<div class="boardgrid">${list.map(([b, c]) => `<a class="bcell ${myBoards.has(b) ? 'mine' : ''}" href="#/board/${b}/${data.date}"><strong>${b}</strong><span>${c} table${c > 1 ? 's' : ''}</span></a>`).join('')}</div>`
      : '<div class="card"><p class="muted">No boards recorded on this day yet.</p></div>'}`);
  wireDayPicker('others');
}

async function renderBoard(r) {
  const data = await ensureDate({ ...r, a: r.b }); if (!data) return;
  const board = Number(r.a);
  const m = mine();
  const plays = playsOfBoard(board, data.sessions);
  const mineFirst = plays.sort((a, b) => (b.s.id === m?.sessionId) - (a.s.id === m?.sessionId));
  $app.innerHTML = shell('others', `
    <header class="top"><a href="#/others/${data.date}" class="back">‹ All boards</a><h1>Board ${board}</h1><p class="muted">${fmtDate(data.date)} · ${plays.length} table${plays.length === 1 ? '' : 's'}</p></header>
    <section class="card">${plays.length ? mineFirst.map((p) => playCard(p, p.s.id === m?.sessionId)).join('') : '<p class="muted">Nobody has recorded this board yet.</p>'}</section>`);
}

// =============================================================
//  Day summary
// =============================================================
async function renderDay(r) {
  const data = await ensureDate(r); if (!data) return;
  const rows = daySummary(data.sessions);
  const tables = data.sessions.length;
  $app.innerHTML = shell('day', `
    <header class="top"><h1>Day summary</h1>${dayPicker(data)}</header>
    <p class="muted small">${tables} table session${tables === 1 ? '' : 's'}. Ranked by total net points: points your pair won minus points the opponents won, over every board you played. Each deal is scored on its own.</p>
    ${rows.length ? rows.map((x) => `<a class="card rank" href="#/pair/${encodeURIComponent(x.key)}/${data.date}">
        <span class="rk">${x.rank}</span>
        <span class="rn"><strong>${esc(x.label)}</strong><span class="small muted">${x.completed} of ${x.sessions} session${x.sessions === 1 ? '' : 's'} complete · ${x.boards} board${x.boards === 1 ? '' : 's'}</span>
          <span class="small muted">Won ${x.pointsFor} · Lost ${x.pointsAgainst} · Avg ${signed(x.avgPerBoard)} per board</span></span>
        <span class="rv ${x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : ''}">${signed(x.net)}</span></a>`).join('')
      : '<div class="card"><p class="muted">No results yet for this day.</p></div>'}`);
  wireDayPicker('day');
}

async function renderPair(r) {
  const data = await ensureDate({ ...r, a: r.b }); if (!data) return;
  const key = r.a;
  const row = daySummary(data.sessions).find((x) => x.key === key);
  const items = [];
  for (const s of data.sessions) {
    const side = pairKey(s.nsP1, s.nsP2) === key ? 'NS' : pairKey(s.ewP1, s.ewP2) === key ? 'EW' : null;
    if (!side) continue;
    const scored = s.deals.map((d) => ({ d, sc: scoreDeal(d, s.firstDealer) }));
    const t = sessionTotals(scored.map((x) => x.sc));
    const opp = side === 'NS' ? pairLabel(s.ewP1, s.ewP2) : pairLabel(s.nsP1, s.nsP2);
    const net = side === 'NS' ? t.net : -t.net;
    items.push(`<section class="card">
      <div class="pl-top"><strong>${esc(s.location)}</strong><span class="pill ${side === 'NS' ? 'ns' : 'ew'}">${side === 'NS' ? 'N/S' : 'E/W'}</span></div>
      <p class="small muted">v ${esc(opp)} · ${t.played} of 4 boards · Net <strong>${signed(net)}</strong></p>
      <table class="mini"><tbody>${scored.map(({ d, sc }) => {
        const mineScore = side === 'NS' ? sc.nsScore : sc.ewScore;
        return `<tr><td>Bd ${d.boardNum}</td><td>${contractHtml(d)}${d.passedOut ? '' : ' ' + d.declarer}</td><td class="small">${esc(sc.outcome)}</td><td class="num ${mineScore > 0 ? 'pos' : mineScore < 0 ? 'neg' : ''}">${signed(mineScore)}</td></tr>`;
      }).join('')}</tbody></table></section>`);
  }
  $app.innerHTML = shell('day', `
    <header class="top"><a href="#/day/${data.date}" class="back">‹ Day summary</a><h1>${esc(row?.label || 'Pair')}</h1>
    ${row ? `<p class="muted">Rank ${row.rank} · Net ${signed(row.net)} · ${row.boards} boards</p>` : ''}</header>
    ${items.join('') || '<p class="muted">No boards found.</p>'}`);
}

// ---------- bottom sheet ----------
function sheet(html, wire) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-wrap'; el.id = 'sheet';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}<button class="btn ghost block" id="sheetClose">Cancel</button></div>`;
  el.onclick = (e) => { if (e.target === el) closeSheet(); };
  document.body.appendChild(el);
  el.querySelector('#sheetClose').onclick = closeSheet;
  wire?.(el);
}
function closeSheet() { document.getElementById('sheet')?.remove(); }

function fmtDate(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- keep results fresh (other tables' results arrive every 20s) ----------
setInterval(async () => {
  if (document.hidden || !state.data) return;
  const r = route();
  if (r.name === 'login' || r.name === 'new' || r.name === 'edit') return;
  try {
    await loadDay();
    if (r.name === 'deal') {
      const s = sessionById(r.a);
      const o = document.getElementById('others');
      if (s && o) o.innerHTML = othersOnBoard(boardNumberFor(Number(r.b), s.startBoard), s.id);
    } else if (!r.a || r.a === state.data.today || r.name === 's' || r.name === 'board' || r.name === 'pair') {
      const y = window.scrollY; render().then(() => window.scrollTo(0, y));
    }
  } catch { /* offline — try again next time */ }
}, 20000);

// ---------- start ----------
(async () => {
  try {
    const { ok } = await api('login');
    if (!ok) return go('#/login');
  } catch (e) {
    $app.innerHTML = `<main class="screen">${errorBlock(e.message)}</main>`;
    return;
  }
  if (!location.hash || location.hash === '#/login') location.hash = '#/play';
  render();
})();
