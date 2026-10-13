// =============================================================
//  Chicago bridge scoring — phone app (no build step)
//  Words used on screen:
//    game  = four boards played by two pairs (one Chicago)
//    board = one deal
//  Screens: login · play (game + quick board entry) · other results · day summary
//  All saving goes through /api: the server checks the access code and
//  calculates the official score. Scores shown while entering are a preview
//  from the same scoring engine.
// =============================================================
import {
  scoreDeal, sessionTotals, daySummary, vulnerabilityFor, vulForDeal, vulnerabilityText, dealerFor, boardNumberFor,
  contractText, outcomeText, strainSymbol, seatName, sideOf, sideName, pairKey, pairLabel,
  LEAD_RANKS, SUITS,
} from './lib/chicago.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const red = (s) => s === 'H' || s === 'D';
const suitHtml = (s) => `<span class="suit ${red(s) ? 'red' : ''}">${strainSymbol(s)}</span>`;
const contractHtml = (d) => d.passedOut ? 'Passed out'
  : `${d.level}${d.strain === 'NT' ? 'NT' : suitHtml(d.strain)}${d.doubled ? ' ' + d.doubled : ''}`;
const leadHtml = (d) => ((d.leadSuit ? suitHtml(d.leadSuit) : '') + esc(d.leadRank || '')) || '—';
const short = (side) => (side === 'NS' ? 'N/S' : 'E/W');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

// ---------- local storage (survives refresh / closing the browser) ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('chi:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('chi:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('chi:' + k); } catch { /* ignore */ } },
};

// ---------- state ----------
const state = { data: null, viewDate: null, entry: null };
const mine = () => {
  const m = store.get('my');
  return m && state.data && m.date === state.data.today ? m : null;
};
const sessionById = (id) => state.data?.sessions.find((s) => s.id === id);
const gameTitle = (s) => `${esc(pairLabel(s.nsP1, s.nsP2))} <span class="v">v</span> ${esc(pairLabel(s.ewP1, s.ewP2))}`;

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
  const d = await api('sessions' + (date ? `?date=${date}` : ''));
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
  const screens = { play: renderPlay, new: renderNew, edit: renderNew, s: renderGame, deal: renderEntry, others: renderOthers, board: renderBoard, day: renderDay, pair: renderPair };
  await (screens[r.name] || renderPlay)(r);
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

// ---------- shared score display: only the pair that scores gets points ----------
function scorePair(nsScore) {
  const ns = Math.max(nsScore, 0), ew = Math.max(-nsScore, 0);
  return `<span class="sc ns ${ns ? 'won' : 'nil'}"><span class="tag ns">N/S</span> ${ns}</span>`
       + `<span class="sc ew ${ew ? 'won' : 'nil'}"><span class="tag ew">E/W</span> ${ew}</span>`;
}
const VUL_CHOICES = [['none', 'Neither'], ['ns', 'N/S'], ['ew', 'E/W'], ['both', 'Both']];
const vulKey = (v) => (v.ns && v.ew ? 'both' : v.ns ? 'ns' : v.ew ? 'ew' : 'none');
const vulFromKey = (k) => ({ ns: k === 'ns' || k === 'both', ew: k === 'ew' || k === 'both' });
function vulChoiceButtons(current, attr = 'vulset') {
  return `<div class="seg four vulseg" role="radiogroup" aria-label="Who is vulnerable">${VUL_CHOICES.map(([k, l]) =>
    `<button type="button" role="radio" data-${attr}="${k}" aria-checked="${current === k}" class="${current === k ? 'on' : ''} ${k === 'none' ? 'nv' : 'isvul'}">${l}</button>`).join('')}</div>`;
}
function vulBadge(v) {
  return `<span class="vb ${v.ns ? 'on' : ''}">N/S ${v.ns ? 'Vul' : 'Not vul'}</span><span class="vb ${v.ew ? 'on' : ''}">E/W ${v.ew ? 'Vul' : 'Not vul'}</span>`;
}

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
  const games = state.data.sessions;
  const list = games.length
    ? games.slice().reverse().map((s) => {
        const n = s.deals.length;
        return `<button class="row-btn" data-join="${s.id}">
          <span class="rb-names"><span><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}</span><span><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</span></span>
          <span class="pill ${n === 4 ? 'done' : ''}">${n === 4 ? 'Finished' : `${n} of 4`}</span></button>`;
      }).join('')
    : '<p class="muted">No games have started yet today.</p>';
  $app.innerHTML = shell('play', `
    <header class="top"><h1>Play</h1><p class="muted">${fmtDate(state.data.today)}</p></header>
    <a class="btn primary big block" href="#/new">Start a new game</a>
    <section class="card"><h2>Join a game already started</h2><p class="muted small">If the other pair has already set up your game, tap it here.</p><div class="stack">${list}</div></section>`);
  $app.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => chooseSide(b.dataset.join)));
}

function chooseSide(sessionId) {
  const s = sessionById(sessionId);
  sheet(`<h2>Which pair are you?</h2>
    <div class="stack">
      <button class="btn big ns" data-side="NS">North/South<br><span>${esc(pairLabel(s.nsP1, s.nsP2))}</span></button>
      <button class="btn big ew" data-side="EW">East/West<br><span>${esc(pairLabel(s.ewP1, s.ewP2))}</span></button>
    </div>`, (root) => root.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => {
      store.set('my', { date: state.data.today, sessionId, side: b.dataset.side });
      closeSheet(); go(`#/s/${sessionId}`);
    })));
}

// =============================================================
//  Start / edit a game
// =============================================================
function renderNew(r) {
  const editing = r.name === 'edit' ? sessionById(r.a) : null;
  const prefs = store.get('prefs', {});
  const last = store.get('lastSession');
  const mySide = editing ? (mine()?.side || 'NS') : (last?.side || 'NS');
  const nameList = [...new Set(state.data.sessions.flatMap((s) => [s.nsP1, s.nsP2, s.ewP1, s.ewP2]).concat(prefs.names || []))];
  const played = editing && editing.deals.length > 0;
  const v = editing
    ? { startBoard: editing.startBoard, firstDealer: editing.firstDealer,
        us1: mySide === 'NS' ? editing.nsP1 : editing.ewP1, us2: mySide === 'NS' ? editing.nsP2 : editing.ewP2,
        them1: mySide === 'NS' ? editing.ewP1 : editing.nsP1, them2: mySide === 'NS' ? editing.ewP2 : editing.nsP2 }
    : { startBoard: last ? last.startBoard + 4 : 1, firstDealer: 'N',
        us1: prefs.names?.[0] || '', us2: prefs.names?.[1] || '', them1: '', them2: '' };

  $app.innerHTML = shell('play', `
    <header class="top"><a href="${editing ? `#/s/${editing.id}` : '#/play'}" class="back">‹ Back</a><h1>${editing ? 'Change names' : 'Start a new game'}</h1></header>
    <form id="newForm" class="stack" autocomplete="off">
      <section class="card stack">
        <span class="lbl">Your pair is sitting</span>
        <div class="seg two-way" role="radiogroup" aria-label="Your direction">
          <button type="button" role="radio" data-side="NS" class="ns ${mySide === 'NS' ? 'on' : ''}" aria-checked="${mySide === 'NS'}">North/South</button>
          <button type="button" role="radio" data-side="EW" class="ew ${mySide === 'EW' ? 'on' : ''}" aria-checked="${mySide === 'EW'}">East/West</button>
        </div>
        <label class="lbl" id="usLbl">Your pair</label>
        <input name="us1" class="input" placeholder="Player 1" value="${esc(v.us1)}" list="names" required maxlength="40" aria-labelledby="usLbl">
        <input name="us2" class="input" placeholder="Player 2" value="${esc(v.us2)}" list="names" required maxlength="40" aria-labelledby="usLbl">
        <label class="lbl" id="themLbl">Opponents</label>
        <input name="them1" class="input" placeholder="Player 1" value="${esc(v.them1)}" list="names" required maxlength="40" aria-labelledby="themLbl">
        <input name="them2" class="input" placeholder="Player 2" value="${esc(v.them2)}" list="names" required maxlength="40" aria-labelledby="themLbl">
        <datalist id="names">${nameList.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </section>
      <section class="card stack">
        <label class="lbl" for="sb">First board number</label>
        <div class="stepper"><button type="button" class="step" data-step="-1" aria-label="Lower" ${played ? 'disabled' : ''}>−</button>
          <input id="sb" name="startBoard" class="input center" inputmode="numeric" pattern="[0-9]*" value="${v.startBoard}" ${played ? 'disabled' : ''}>
          <button type="button" class="step" data-step="1" aria-label="Higher" ${played ? 'disabled' : ''}>+</button></div>
        <p class="muted" id="boardsLine"></p>
        <span class="lbl">Who deals first?</span>
        <div class="seg four" role="radiogroup" aria-label="First dealer">${['N', 'E', 'S', 'W'].map((d) => `<button type="button" role="radio" data-dealer="${d}" aria-checked="${v.firstDealer === d}" class="${v.firstDealer === d ? 'on' : ''}" ${played ? 'disabled' : ''}>${seatName(d)}</button>`).join('')}</div>
        ${played ? '<p class="muted small">Board numbers and dealer are fixed once a result has been saved.</p>' : ''}
      </section>
      <p id="formErr" class="err" role="alert"></p>
      <button class="btn primary big block" type="submit">${editing ? 'Save names' : 'Start playing'}</button>
    </form>`);

  const f = document.getElementById('newForm');
  let dealer = v.firstDealer, side = mySide;
  const token = uuid();
  const sbInput = f.startBoard;
  const update = () => {
    const n = parseInt(sbInput.value, 10);
    document.getElementById('boardsLine').textContent = n > 0 ? `Boards ${n}, ${n + 1}, ${n + 2} and ${n + 3}` : '';
    document.getElementById('usLbl').textContent = `Your pair (${sideName(side)})`;
    document.getElementById('themLbl').textContent = `Opponents (${sideName(side === 'NS' ? 'EW' : 'NS')})`;
  };
  update();
  sbInput.oninput = update;
  f.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { sbInput.value = Math.max(1, (parseInt(sbInput.value, 10) || 1) + Number(b.dataset.step)); update(); }));
  f.querySelectorAll('[data-dealer]').forEach((b) => (b.onclick = () => { dealer = b.dataset.dealer; radio(f, '[data-dealer]', b); }));
  f.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; radio(f, '[data-side]', b); update(); }));

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const body = {
      startBoard: parseInt(editing && played ? editing.startBoard : sbInput.value, 10), firstDealer: dealer,
      nsP1: side === 'NS' ? fd.us1 : fd.them1, nsP2: side === 'NS' ? fd.us2 : fd.them2,
      ewP1: side === 'EW' ? fd.us1 : fd.them1, ewP2: side === 'EW' ? fd.us2 : fd.them2,
    };
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const out = editing
        ? await api('sessions', { method: 'PATCH', body: { id: editing.id, ...body } })
        : await api('sessions', { method: 'POST', body: { ...body, clientToken: token } });
      store.set('prefs', { names: [fd.us1, fd.us2] });
      store.set('my', { date: state.data.today, sessionId: out.session.id, side });
      store.set('lastSession', { startBoard: out.session.startBoard, side });
      upsertSession(out.session);
      toast(editing ? 'Names saved' : 'Game started');
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
//  Game — four-board overview
// =============================================================
function dealsFor(s) {
  return [1, 2, 3, 4].map((n) => {
    const d = s.deals.find((x) => x.dealNo === n);
    const draft = d ? null : store.get(`draft:${s.id}:${n}`);
    const vul = d ? vulForDeal(d, s.firstDealer)
      : (draft && typeof draft.vulNs === 'boolean' ? { ns: draft.vulNs, ew: draft.vulEw } : vulnerabilityFor(n, s.firstDealer));
    return { n, board: boardNumberFor(n, s.startBoard), vul, dealer: dealerFor(n, s.firstDealer), d, scored: d ? scoreDeal(d, s.firstDealer) : null };
  });
}

function renderGame(r) {
  const s = sessionById(r.a);
  if (!s) { $app.innerHTML = shell('play', errorBlock('This game could not be found.')); return; }
  const m = mine();
  const isMine = m?.sessionId === s.id;
  const rows = dealsFor(s);
  const done = rows.filter((x) => x.d).length;
  const t = sessionTotals(rows.filter((x) => x.scored).map((x) => x.scored));
  const next = rows.find((x) => !x.d);

  const card = (x) => {
    const head = `<div class="bhead"><span class="bnum">Board ${x.board}</span>
      <button type="button" class="vulbtn" data-vulfor="${x.n}" aria-label="Vulnerability for board ${x.board}: ${vulnerabilityText(x.vul)}. Tap to change">${vulBadge(x.vul)}<span class="chg">Change</span></button></div>`;
    if (!x.d) return `<div class="card board todo">${head}
      <p class="muted">Deal ${x.n} · Dealer ${seatName(x.dealer)}</p>
      <a class="btn primary block" href="#/deal/${s.id}/${x.n}">Enter result ›</a></div>`;
    const sc = x.scored;
    return `<div class="card board">${head}
      <dl class="facts">
        <div><dt>Contract</dt><dd>${contractHtml(x.d)}${x.d.passedOut ? '' : ` <span class="by">by ${seatName(x.d.declarer)}</span>`}</dd></div>
        ${x.d.passedOut ? '' : `<div><dt>Result</dt><dd>${esc(sc.outcome)}</dd></div>
        <div><dt>Contract winner</dt><dd>${short(sc.winner)}</dd></div>
        <div><dt>Lead</dt><dd>${leadHtml(x.d)}</dd></div>`}
      </dl>
      <div class="scores">${scorePair(sc.nsScore)}</div>
      <a class="btn block correct" href="#/deal/${s.id}/${x.n}">Correct this board ›</a></div>`;
  };

  const tableRows = rows.map((x) => `<tr>
    <td>${x.board}</td><td>${vulnerabilityText(x.vul).replace(' vulnerable', '')}</td>
    <td>${x.d ? contractHtml(x.d) : '<span class="muted">—</span>'}</td>
    <td>${x.d && !x.d.passedOut ? short(x.scored.winner) : ''}</td>
    <td>${x.d && !x.d.passedOut ? leadHtml(x.d) : ''}</td>
    <td>${x.d ? esc(x.scored.outcome) : `<a href="#/deal/${s.id}/${x.n}">Enter</a>`}</td>
    <td class="num tns">${x.d && x.scored.nsPoints ? x.scored.nsPoints : ''}</td>
    <td class="num tew">${x.d && x.scored.ewPoints ? x.scored.ewPoints : ''}</td>
    <td>${x.d ? `<a href="#/deal/${s.id}/${x.n}">Edit</a>` : ''}</td></tr>`).join('');

  $app.innerHTML = shell('play', `
    <header class="top">
      <p class="pairs"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}<br><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
      ${isMine ? `<p>You are <strong class="${m.side === 'NS' ? 'tns' : 'tew'}">${sideName(m.side)}</strong></p>` : ''}
    </header>
    <div class="progress" aria-label="${done} of 4 boards completed"><div class="bar"><span style="width:${done * 25}%"></span></div><strong>${done} of 4 boards completed</strong></div>
    ${next ? `<a class="btn primary big block" href="#/deal/${s.id}/${next.n}">Enter board ${next.board}</a>` : ''}
    ${done ? totalsCard(t) : ''}
    ${done === 4 ? '<button class="btn primary big block" data-newgame>Start a new game</button>' : ''}
    <div class="boards">${rows.map(card).join('')}</div>
    <div class="wide-only card"><table class="results"><thead><tr><th>Board</th><th>Vul</th><th>Bid</th><th>Winner</th><th>Lead</th><th>Result</th><th class="num">N/S</th><th class="num">E/W</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <div class="stack foot">
      ${done < 4 ? '<button class="btn big block" data-newgame>Start a new game</button>' : ''}
      ${isMine ? '' : '<button class="btn block" id="claim">This is my game</button>'}
      <a class="btn ghost block" href="#/edit/${s.id}">Change names</a>
    </div>`);

  $app.querySelectorAll('[data-newgame]').forEach((b) => (b.onclick = () => {
    if (done < 4 && !confirm(`This game has ${done} of 4 boards entered.\n\nStart a new game anyway? The boards already saved are kept.`)) return;
    store.set('lastSession', { startBoard: s.startBoard, side: m?.side || 'NS' });
    store.del('my');
    go('#/new');
  }));
  document.getElementById('claim')?.addEventListener('click', () => chooseSide(s.id));
  $app.querySelectorAll('[data-vulfor]').forEach((b) => (b.onclick = () => chooseVul(s, Number(b.dataset.vulfor))));
}

// Change vulnerability from the game screen. Unplayed board: remembered for
// when its result is entered. Saved board: re-saved and re-scored straight away.
async function rerenderKeepScroll() { const y = window.scrollY; await render(); window.scrollTo(0, y); }

function chooseVul(s, n) {
  const d = s.deals.find((x) => x.dealNo === n);
  const draftKey = `draft:${s.id}:${n}`;
  const draft = store.get(draftKey);
  const def = vulnerabilityFor(n, s.firstDealer);
  const cur = d ? vulForDeal(d, s.firstDealer)
    : (draft && typeof draft.vulNs === 'boolean' ? { ns: draft.vulNs, ew: draft.vulEw } : def);
  sheet(`<h2>Board ${boardNumberFor(n, s.startBoard)}: who is vulnerable?</h2>
    ${vulChoiceButtons(vulKey(cur))}
    <p class="muted">Usual for deal ${n}: ${vulnerabilityText(def)}.</p>`, (root) => root.querySelectorAll('[data-vulset]').forEach((b) => (b.onclick = async () => {
      const v = vulFromKey(b.dataset.vulset);
      closeSheet();
      if (!d) {
        store.set(draftKey, { ...(draft || {}), vulNs: v.ns, vulEw: v.ew });
        toast(`Board ${boardNumberFor(n, s.startBoard)}: ${vulnerabilityText(v)}`);
        // show the change on the card
        rerenderKeepScroll();
        return;
      }
      try {
        const body = { sessionId: s.id, dealNo: n, passedOut: d.passedOut, level: d.level, strain: d.strain, doubled: d.doubled,
          declarer: d.declarer, tricks: d.tricks, leadSuit: d.leadSuit, leadRank: d.leadRank, vulNs: v.ns, vulEw: v.ew, expectedUpdatedAt: d.updatedAt };
        const out = await api('deal', { method: 'PUT', body });
        const live = sessionById(s.id) || s;   // the day may have been refreshed meanwhile
        live.deals = live.deals.filter((x) => x.dealNo !== n).concat(out.deal).sort((a, c) => a.dealNo - c.dealNo);
        const sc = scoreDeal(out.deal, s.firstDealer);
        toast(`Board ${out.deal.boardNum}: ${vulnerabilityText(v)} · ${sc.scoredBy ? `${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)}` : 'no score'}`);
        rerenderKeepScroll();
      } catch (e) {
        toast(e.status === 409 ? 'This board was just changed on another phone. Please check it.' : e.message, 'error');
        loadDay().then(rerenderKeepScroll).catch(() => {});
      }
    })));
}

function totalsCard(t) {
  const verdict = !t.complete ? 'So far' : t.net === 0 ? 'Result' : 'Winners';
  const line = t.net === 0 ? 'All square' : `${short(t.leader)} by ${t.margin}`;
  return `<section class="card totals ${t.complete ? 'final' : ''}">
    <div class="tot"><span class="tag ns">N/S</span><strong>${t.nsPoints}</strong></div>
    <div class="tot"><span class="tag ew">E/W</span><strong>${t.ewPoints}</strong></div>
    <div class="net"><span>${verdict}</span><strong>${line}</strong></div>
  </section>`;
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
  const def = vulnerabilityFor(n, s.firstDealer);
  const saved = existing ? {
    passedOut: existing.passedOut, level: existing.level, strain: existing.strain, doubled: existing.doubled || '', declarer: existing.declarer,
    diff: existing.passedOut ? 0 : existing.tricks - (existing.level + 6), leadSuit: existing.leadSuit, leadRank: existing.leadRank,
    vulNs: vulForDeal(existing, s.firstDealer).ns, vulEw: vulForDeal(existing, s.firstDealer).ew,
  } : null;
  const blank = { passedOut: false, level: null, strain: null, doubled: '', declarer: null, diff: 0, leadSuit: null, leadRank: null, vulNs: def.ns, vulEw: def.ew };
  state.entry = { sessionId: s.id, n, def, expectedUpdatedAt: existing?.updatedAt || null, e: { ...blank, ...(store.get(draftKey) || saved || {}) } };
  const board = boardNumberFor(n, s.startBoard);

  $app.innerHTML = shell('play', `
    <header class="entry-head">
      <a href="#/s/${s.id}" class="back">‹ Back to the game</a>
      <div class="bline"><span class="bnum big">Board ${board}</span><span class="muted">Deal ${n} of 4 · Dealer ${seatName(dealerFor(n, s.firstDealer))}</span></div>
      <nav class="dealnav" aria-label="Boards in this game">${[1, 2, 3, 4].map((k) => `<a href="#/deal/${s.id}/${k}" class="${k === n ? 'on' : ''} ${s.deals.some((d) => d.dealNo === k) ? 'done' : ''}">${boardNumberFor(k, s.startBoard)}</a>`).join('')}</nav>
    </header>
    ${existing ? '<p class="note">Already saved. Change anything and tap Save to correct it.</p>' : ''}
    <div id="entry"></div>
    <section class="card"><h2>On other games</h2><div id="others">${othersOnBoard(board, s.id)}</div></section>
    <div class="savebar"><div id="preview" class="preview" aria-live="polite"></div><button class="btn primary big" id="saveBtn">Save result</button></div>`);
  drawEntry();
  document.getElementById('saveBtn').onclick = () => saveEntry(draftKey);
}

function drawEntry() {
  const { e, def } = state.entry;
  const s = sessionById(state.entry.sessionId);
  const box = document.getElementById('entry');
  const btn = (attr, val, label, on, cls = '') => `<button type="button" class="key ${cls} ${on ? 'on' : ''}" data-${attr}="${val}" aria-pressed="${on}">${label}</button>`;
  const changed = e.vulNs !== def.ns || e.vulEw !== def.ew;
  const vulCard = `<section class="card keys">
      <h2 class="kh">Who is vulnerable?</h2>
      ${vulChoiceButtons(vulKey({ ns: e.vulNs, ew: e.vulEw }))}
      ${changed ? `<p class="small warn">Changed from the usual for this deal (${vulnerabilityText(def)}). <button type="button" class="link" data-act="vulreset">Put it back</button></p>` : ''}
    </section>`;
  if (e.passedOut) {
    box.innerHTML = `<section class="card center"><p class="passed">Passed out</p><p class="muted">No contract. Nobody scores on this board.</p>
      <button class="btn" data-act="unpass">Undo, it was played</button></section>`;
  } else {
    const need = e.level ? e.level + 6 : null;
    const tricks = need != null ? need + e.diff : null;
    const res = need == null ? '' : e.diff === 0 ? 'Made exactly' : e.diff > 0 ? `Made +${e.diff}` : `Down ${-e.diff}`;
    box.innerHTML = `
      ${vulCard}
      <section class="card keys">
        <h2 class="kh">Contract</h2>
        <div class="grid seven">${[1, 2, 3, 4, 5, 6, 7].map((l) => btn('level', l, l, e.level === l)).join('')}</div>
        <div class="grid five">${['C', 'D', 'H', 'S', 'NT'].map((st) => btn('strain', st, st === 'NT' ? 'NT' : suitHtml(st), e.strain === st, 'suitkey')).join('')}</div>
        <div class="grid three dbl">${[['', 'Not doubled'], ['X', 'Doubled'], ['XX', 'Redoubled']].map(([v, l]) => btn('dbl', v || 'none', l, (e.doubled || '') === v, 'small')).join('')}</div>
      </section>
      <section class="card keys">
        <h2 class="kh">Declarer</h2>
        <div class="decl">${['N', 'S', 'E', 'W'].map((d) => btn('decl', d, seatName(d), e.declarer === d, sideOf(d) === 'NS' ? 'ns' : 'ew')).join('')}</div>
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
        <h2 class="kh">Opening lead <span class="hint">(optional)</span></h2>
        <div class="grid four">${SUITS.map((st) => btn('lsuit', st, suitHtml(st), e.leadSuit === st, 'suitkey')).join('')}</div>
        <div class="grid seven ranks">${LEAD_RANKS.map((rk) => btn('lrank', rk, rk, e.leadRank === rk)).join('')}</div>
        ${e.leadSuit || e.leadRank ? '<button type="button" class="link" data-act="nolead">Clear the lead</button>' : ''}
      </section>
      <button type="button" class="btn ghost block" data-act="pass">Board was passed out</button>`;
  }
  box.onclick = onEntryTap;
  drawPreview(s);
}

function onEntryTap(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  const { e, def } = state.entry;
  const d = b.dataset;
  if (d.level) { e.level = Number(d.level); e.diff = Math.max(-(e.level + 6), Math.min(13 - (e.level + 6), e.diff)); }
  else if (d.strain) e.strain = d.strain;
  else if (d.dbl) e.doubled = d.dbl === 'none' ? '' : d.dbl;
  else if (d.decl) e.declarer = d.decl;
  else if (d.trick) { const t = e.level + 6 + e.diff + Number(d.trick); if (t >= 0 && t <= 13) e.diff += Number(d.trick); }
  else if (d.lsuit) e.leadSuit = e.leadSuit === d.lsuit ? null : d.lsuit;
  else if (d.lrank) e.leadRank = e.leadRank === d.lrank ? null : d.lrank;
  else if (d.vulset) { const v = vulFromKey(d.vulset); e.vulNs = v.ns; e.vulEw = v.ew; }
  else if (d.act === 'vulreset') { e.vulNs = def.ns; e.vulEw = def.ew; }
  else if (d.act === 'nolead') { e.leadSuit = null; e.leadRank = null; }
  else if (d.act === 'pass') e.passedOut = true;
  else if (d.act === 'unpass') e.passedOut = false;
  else return;
  store.set(`draft:${state.entry.sessionId}:${state.entry.n}`, e);
  drawEntry();
}

function entryDeal() {
  const { e, n } = state.entry;
  if (e.passedOut) return { dealNo: n, passedOut: true, vulNs: e.vulNs, vulEw: e.vulEw };
  return { dealNo: n, passedOut: false, level: e.level, strain: e.strain, doubled: e.doubled || '', declarer: e.declarer,
    tricks: e.level ? e.level + 6 + e.diff : null, leadSuit: e.leadSuit, leadRank: e.leadRank, vulNs: e.vulNs, vulEw: e.vulEw };
}
const missingFor = (d) => d.passedOut ? null : !d.level ? 'Choose the contract level' : !d.strain ? 'Choose the suit or NT' : !d.declarer ? 'Choose the declarer' : null;

function drawPreview(s) {
  const d = entryDeal();
  const p = document.getElementById('preview');
  const miss = missingFor(d);
  const saveBtn = document.getElementById('saveBtn');
  if (miss) { p.innerHTML = `<span class="muted">${miss}</span>`; saveBtn.disabled = true; return; }
  const sc = scoreDeal(d, s.firstDealer);
  p.innerHTML = d.passedOut ? '<strong>Passed out · no score</strong>'
    : `<span class="pv-c">${contractHtml(d)} by ${seatName(d.declarer)}</span><span class="pv-s ${sc.scoredBy === 'NS' ? 'tns' : 'tew'}">${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)}</span>`;
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
    toast(`Saved · Board ${out.deal.boardNum} · ${sc.scoredBy ? `${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)}` : 'no score'}`);
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
        alert(`This board was saved on another phone as ${contractText(cur)}${cur.passedOut ? '' : ' by ' + seatName(cur.declarer) + ', ' + outcomeText(cur)}${sc.scoredBy ? ` (${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)})` : ''}.\n\nYour entry is still on screen. Tap Save again only if yours is the correct one.`);
      } else {
        toast(e.message, 'error');
      }
    } else {
      toast(e.status === 0 ? 'Not saved: no connection. Your entry is kept; tap Save again.' : e.message, 'error');
    }
  }
}

// ---------- results of one board in other games ----------
function playsOfBoard(board, sessions) {
  const out = [];
  for (const s of sessions) for (const d of s.deals) if (d.boardNum === board) out.push({ s, d, sc: scoreDeal(d, s.firstDealer) });
  return out;
}

function othersOnBoard(board, mySessionId) {
  const plays = playsOfBoard(board, state.data.sessions).filter((p) => p.s.id !== mySessionId);
  if (!plays.length) return '<p class="muted">No other game has recorded this board yet.</p>';
  return `<p class="muted">${plays.length} other game${plays.length > 1 ? 's' : ''}</p>` + plays.map((p) => playCard(p)).join('');
}

function playCard({ s, d, sc }, highlight = false) {
  return `<div class="play ${highlight ? 'mine' : ''}">
    ${highlight ? '<span class="pill">Your game</span>' : ''}
    <p class="pl-names"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}<br><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
    <p class="pl-res">${contractHtml(d)}${d.passedOut ? '' : ` by ${seatName(d.declarer)} · ${d.tricks} tricks · lead ${leadHtml(d)}`}</p>
    <p class="muted">${esc(sc.vulText)}${d.passedOut ? '' : ' · ' + esc(sc.outcome)}</p>
    <div class="scores">${scorePair(sc.nsScore)}</div></div>`;
}

// =============================================================
//  Other results — every board played on a day
// =============================================================
async function ensureDate(dateArg, tab) {
  const date = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : state.data.today;
  if (date === state.data.today) return state.data;
  if (state.viewDate?.date === date) return state.viewDate;
  $app.innerHTML = shell(tab, '<p class="muted center pad">Loading…</p>');
  try { state.viewDate = await loadDay(date); } catch (e) { $app.innerHTML = shell(tab, errorBlock(e.message)); return null; }
  return state.viewDate;
}

function dayPicker(data) {
  const days = [...new Set([data.today, ...data.days])].sort().reverse();
  return `<label class="sr" for="dayPick">Day</label><select id="dayPick" class="input">${days.map((d) => `<option value="${d}" ${d === data.date ? 'selected' : ''}>${d === data.today ? 'Today' : fmtDate(d)}</option>`).join('')}</select>`;
}
function wireDayPicker(base) {
  const el = document.getElementById('dayPick');
  if (el) el.onchange = () => go(`#/${base}/${el.value}`);
}

async function renderOthers(r) {
  const data = await ensureDate(r.a, 'others'); if (!data) return;
  const boards = new Map();
  for (const s of data.sessions) for (const d of s.deals) boards.set(d.boardNum, (boards.get(d.boardNum) || 0) + 1);
  const m = mine();
  const myBoards = new Set(m && data.date === state.data.today ? (sessionById(m.sessionId)?.deals || []).map((d) => d.boardNum) : []);
  const list = [...boards.entries()].sort((a, b) => a[0] - b[0]);
  $app.innerHTML = shell('others', `
    <header class="top"><h1>Other results</h1>${dayPicker(data)}</header>
    <p class="muted">Tap a board to compare every game’s result.</p>
    ${list.length ? `<div class="boardgrid">${list.map(([b, c]) => `<a class="bcell ${myBoards.has(b) ? 'mine' : ''}" href="#/board/${b}/${data.date}"><strong>${b}</strong><span>${c} game${c > 1 ? 's' : ''}</span></a>`).join('')}</div>`
      : '<div class="card"><p class="muted">No boards recorded on this day yet.</p></div>'}`);
  wireDayPicker('others');
}

async function renderBoard(r) {
  const data = await ensureDate(r.b, 'others'); if (!data) return;
  const board = Number(r.a);
  const m = mine();
  const plays = playsOfBoard(board, data.sessions);
  plays.sort((a, b) => (b.s.id === m?.sessionId) - (a.s.id === m?.sessionId));
  $app.innerHTML = shell('others', `
    <header class="top"><a href="#/others/${data.date}" class="back">‹ All boards</a><h1>Board ${board}</h1><p class="muted">${fmtDate(data.date)} · ${plays.length} game${plays.length === 1 ? '' : 's'}</p></header>
    <section class="card">${plays.length ? plays.map((p) => playCard(p, p.s.id === m?.sessionId)).join('') : '<p class="muted">Nobody has recorded this board yet.</p>'}</section>`);
}

// =============================================================
//  Day summary
// =============================================================
async function renderDay(r) {
  const data = await ensureDate(r.a, 'day'); if (!data) return;
  const rows = daySummary(data.sessions);
  const games = data.sessions.length;
  $app.innerHTML = shell('day', `
    <header class="top"><h1>Day summary</h1>${dayPicker(data)}</header>
    <p class="muted">${games} game${games === 1 ? '' : 's'}. Pairs are ranked by the total points they won.</p>
    ${rows.length ? rows.map((x) => `<a class="card rank" href="#/pair/${encodeURIComponent(x.key)}/${data.date}">
        <span class="rk">${x.rank}</span>
        <span class="rn"><strong>${esc(x.label)}</strong>
          <span class="muted">${x.boards} board${x.boards === 1 ? '' : 's'} · ${x.games} game${x.games === 1 ? '' : 's'}${x.gamesWon ? `, ${x.gamesWon} won` : ''}</span>
          <span class="muted">Average ${x.avgPerBoard} a board</span></span>
        <span class="rv">${x.points}</span></a>`).join('')
      : '<div class="card"><p class="muted">No results yet for this day.</p></div>'}`);
  wireDayPicker('day');
}

async function renderPair(r) {
  const data = await ensureDate(r.b, 'day'); if (!data) return;
  const key = r.a;
  const row = daySummary(data.sessions).find((x) => x.key === key);
  const items = [];
  for (const s of data.sessions) {
    const side = pairKey(s.nsP1, s.nsP2) === key ? 'NS' : pairKey(s.ewP1, s.ewP2) === key ? 'EW' : null;
    if (!side) continue;
    const scored = s.deals.map((d) => ({ d, sc: scoreDeal(d, s.firstDealer) }));
    const t = sessionTotals(scored.map((x) => x.sc));
    const opp = side === 'NS' ? pairLabel(s.ewP1, s.ewP2) : pairLabel(s.nsP1, s.nsP2);
    const us = side === 'NS' ? t.nsPoints : t.ewPoints, them = side === 'NS' ? t.ewPoints : t.nsPoints;
    items.push(`<section class="card">
      <div class="pl-top"><strong>v ${esc(opp)}</strong><span class="pill ${side === 'NS' ? 'ns' : 'ew'}">${short(side)}</span></div>
      <p class="muted">${t.played} of 4 boards · Won ${us} · Opponents ${them}${t.complete ? (us > them ? ' · <strong>Won</strong>' : us < them ? ' · Lost' : ' · All square') : ''}</p>
      <table class="mini"><tbody>${scored.map(({ d, sc }) => {
        const pts = side === 'NS' ? sc.nsPoints : sc.ewPoints;
        return `<tr><td>Bd ${d.boardNum}</td><td>${contractHtml(d)}${d.passedOut ? '' : ' ' + d.declarer}</td><td>${esc(sc.outcome)}</td><td class="num ${pts ? 'pos' : 'muted'}">${pts}</td></tr>`;
      }).join('')}</tbody></table></section>`);
  }
  $app.innerHTML = shell('day', `
    <header class="top"><a href="#/day/${data.date}" class="back">‹ Day summary</a><h1>${esc(row?.label || 'Pair')}</h1>
    ${row ? `<p class="muted">Rank ${row.rank} · ${row.points} points · ${row.boards} boards</p>` : ''}</header>
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

// ---------- keep results fresh (other games' results arrive every 20s) ----------
setInterval(async () => {
  if (document.hidden || !state.data || document.getElementById('sheet')) return;
  const r = route();
  if (r.name === 'login' || r.name === 'new' || r.name === 'edit') return;
  try {
    await loadDay();
    if (r.name === 'deal') {
      const s = sessionById(r.a);
      const o = document.getElementById('others');
      if (s && o) o.innerHTML = othersOnBoard(boardNumberFor(Number(r.b), s.startBoard), s.id);
    } else {
      const viewingOtherDay = (r.name === 'day' || r.name === 'others') ? (r.a && r.a !== state.data.today) : (r.b && r.b !== state.data.today);
      if (!viewingOtherDay) { const y = window.scrollY; await render(); window.scrollTo(0, y); }
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
