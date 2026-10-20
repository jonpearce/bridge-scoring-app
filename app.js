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
const state = { data: null, entry: null, admin: false };
const curEventId = () => state.data?.event?.id;
const mine = () => {
  const m = store.get('my');
  return m && state.data && m.eventId === curEventId() ? m : null;
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

// Loads the chosen playing session (or the newest one). If the organiser has
// started a newer session since this phone chose an older one, follow the newest.
async function loadDay() {
  const pick = store.get('event');
  let d = await api('sessions' + (pick?.id ? `?event=${pick.id}` : ''));
  if (pick) {
    const latest = d.events.find((e) => e.id === d.latestId);
    const stale = d.event.id !== pick.id || (latest && latest.id !== pick.id && Date.parse(latest.startedAt) > pick.pickedAt);
    if (stale) { store.del('event'); if (d.event.id !== d.latestId) d = await api('sessions'); }
  }
  state.data = d;
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
  if (state.scrollToNext && r.name === 's') {
    state.scrollToNext = false;
    const target = document.querySelector('.board.next') || document.querySelector('.totals');
    if (target) {
      // Put the next board in the middle of the visible area (above the bottom tab bar).
      // If it is too tall to fit, show its top edge just below the top of the screen.
      const rect = target.getBoundingClientRect();
      const tabs = document.querySelector('nav.tabs')?.getBoundingClientRect().height || 0;
      const visible = window.innerHeight - tabs;
      const gap = Math.max(12, (visible - rect.height) / 2);
      const want = rect.top + window.scrollY - gap;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (want > max) { const m = document.querySelector('main.screen'); if (m) m.style.paddingBottom = `calc(${getComputedStyle(m).paddingBottom} + ${Math.ceil(want - max)}px)`; }
      window.scrollTo(0, Math.max(0, want));
    }
  }
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
    <div class="brand"><div class="logo" aria-hidden="true">♠♥<br>♦♣</div><h1>Flinders Chicago Bridge</h1><p class="muted">Four-deal scoring for social bridge</p></div>
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
      const out = await api('login', { method: 'POST', body: { code: f.code.value } });
      state.admin = !!out.admin;
      state.data = null;
      if (out.admin) toast('Organiser mode: see Day summary');
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
    : '';
  const joinCard = games.length
    ? `<section class="card"><h2>…or join a table already started</h2><p class="muted small">If the other pair has already set up your table, tap it here.</p><div class="stack">${list}</div></section>`
    : '<section class="card"><p class="muted">No tables have started yet in this session.</p></section>';
  $app.innerHTML = shell('play', `
    <header class="top"><h1>Play</h1>${sessionPicker()}</header>
    <a class="btn primary big block" href="#/new">Set up a new table…</a>
    ${joinCard}
    ${logoutButton()}`);
  wireSessionPicker(); wireLogout();
  $app.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => chooseSide(b.dataset.join)));
}

function chooseSide(sessionId) {
  const s = sessionById(sessionId);
  const join = (side) => {
    store.set('my', { eventId: curEventId(), sessionId, side });
    // Remember this pair's names so later tables recognise them too.
    const names = side === 'NS' ? [s.nsP1, s.nsP2] : [s.ewP1, s.ewP2];
    if (names[0] && names[1]) store.set('prefs', { ...store.get('prefs', {}), names });
  };
  // If this phone's remembered pair matches exactly one pair at this table, skip the question.
  const mineNames = store.get('prefs', {}).names;
  if (mineNames?.length === 2 && mineNames[0] && mineNames[1]) {
    const k = pairKey(mineNames[0], mineNames[1]);
    const ns = k === pairKey(s.nsP1, s.nsP2), ew = k === pairKey(s.ewP1, s.ewP2);
    if (ns !== ew) {
      const side = ns ? 'NS' : 'EW';
      join(side);
      toast(`Joined as ${side === 'NS' ? 'North/South' : 'East/West'}`);
      go(`#/s/${sessionId}`);
      return;
    }
  }
  sheet(`<h2>Which pair are you?</h2>
    <div class="stack">
      <button class="btn big ns" data-side="NS">North/South<br><span>${esc(pairLabel(s.nsP1, s.nsP2))}</span></button>
      <button class="btn big ew" data-side="EW">East/West<br><span>${esc(pairLabel(s.ewP1, s.ewP2))}</span></button>
    </div>`, (root) => root.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => {
      join(b.dataset.side);
      closeSheet(); go(`#/s/${sessionId}`);
    })));
}

// =============================================================
//  Start / edit a game
// =============================================================
function renderNew(r) {
  const editing = r.name === 'edit' ? sessionById(r.a) : null;
  const prefs = store.get('prefs', {});
  const lastRaw = store.get('lastSession');
  // Continue numbering only if that table is still here today; after the
  // organiser clears the day, a log-out, or on a new day, start again at 1.
  const last = lastRaw && lastRaw.eventId === curEventId() && sessionById(lastRaw.sessionId) ? lastRaw : null;
  const mySide = editing ? (mine()?.side || 'NS') : (lastRaw?.side || 'NS');
  // Every name entered on any day (from the server, less any the organiser removed), plus this phone's own pair.
  const removed = new Set((state.data.hiddenNames || []).map((n) => n.toLowerCase()));
  const nameList = uniqNames([...(prefs.names || []), ...(state.data.names || [])]).filter((n) => !removed.has(n.toLowerCase()));
  const played = editing && editing.deals.length > 0;
  const v = editing
    ? { startBoard: editing.startBoard, firstDealer: editing.firstDealer,
        us1: mySide === 'NS' ? editing.nsP1 : editing.ewP1, us2: mySide === 'NS' ? editing.nsP2 : editing.ewP2,
        them1: mySide === 'NS' ? editing.ewP1 : editing.nsP1, them2: mySide === 'NS' ? editing.ewP2 : editing.nsP2 }
    : { startBoard: last ? last.startBoard + 4 : 1, firstDealer: 'N',
        us1: prefs.names?.[0] || '', us2: prefs.names?.[1] || '', them1: '', them2: '' };

  $app.innerHTML = shell('play', `
    <header class="top"><a href="${editing ? `#/s/${editing.id}` : '#/play'}" class="back">‹ Back</a><h1>${editing ? 'Change names' : 'Set up a new table'}</h1></header>
    <form id="newForm" class="stack" autocomplete="off">
      <section class="card stack">
        <span class="lbl">Your pair is sitting</span>
        <div class="seg two-way" role="radiogroup" aria-label="Your direction">
          <button type="button" role="radio" data-side="NS" class="ns ${mySide === 'NS' ? 'on' : ''}" aria-checked="${mySide === 'NS'}">North/South</button>
          <button type="button" role="radio" data-side="EW" class="ew ${mySide === 'EW' ? 'on' : ''}" aria-checked="${mySide === 'EW'}">East/West</button>
        </div>
        <label class="lbl" id="usLbl">Your pair</label>
        <div class="ac"><input name="us1" class="input" placeholder="Player 1" value="${esc(v.us1)}" required maxlength="40" autocomplete="off" autocapitalize="words" aria-labelledby="usLbl"></div>
        <div class="ac"><input name="us2" class="input" placeholder="Player 2" value="${esc(v.us2)}" required maxlength="40" autocomplete="off" autocapitalize="words" aria-labelledby="usLbl"></div>
        <label class="lbl" id="themLbl">Opponents</label>
        <div class="ac"><input name="them1" class="input" placeholder="Player 1" value="${esc(v.them1)}" required maxlength="40" autocomplete="off" autocapitalize="words" aria-labelledby="themLbl"></div>
        <div class="ac"><input name="them2" class="input" placeholder="Player 2" value="${esc(v.them2)}" required maxlength="40" autocomplete="off" autocapitalize="words" aria-labelledby="themLbl"></div>
      </section>
      <section class="card stack">
        <label class="lbl" for="sb">First board number</label>
        <div class="stepper"><button type="button" class="step" data-step="-1" aria-label="Lower" ${played ? 'disabled' : ''}>−</button>
          <input id="sb" name="startBoard" class="input center" inputmode="numeric" pattern="[0-9]*" min="1" max="999" maxlength="3" value="${v.startBoard}" ${played ? 'disabled' : ''}>
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
  // Board numbers start at 1: digits only, no 0, no leading zeros.
  sbInput.oninput = () => {
    const digits = sbInput.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 3);
    if (sbInput.value !== digits) sbInput.value = digits || (sbInput.value.replace(/\D/g, '') ? '1' : '');
    update();
  };
  sbInput.onblur = () => { if (!(parseInt(sbInput.value, 10) >= 1)) { sbInput.value = '1'; update(); } };
  f.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { sbInput.value = Math.max(1, (parseInt(sbInput.value, 10) || 1) + Number(b.dataset.step)); update(); }));
  f.querySelectorAll('[data-dealer]').forEach((b) => (b.onclick = () => { dealer = b.dataset.dealer; radio(f, '[data-dealer]', b); }));
  f.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => { side = b.dataset.side; radio(f, '[data-side]', b); update(); }));
  nameSuggest(f, ['us1', 'us2', 'them1', 'them2'], nameList);

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const body = {
      startBoard: Math.max(1, parseInt(editing && played ? editing.startBoard : sbInput.value, 10) || 1), firstDealer: dealer,
      nsP1: side === 'NS' ? fd.us1 : fd.them1, nsP2: side === 'NS' ? fd.us2 : fd.them2,
      ewP1: side === 'EW' ? fd.us1 : fd.them1, ewP2: side === 'EW' ? fd.us2 : fd.them2,
    };
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const out = editing
        ? await api('sessions', { method: 'PATCH', body: { id: editing.id, ...body } })
        : await api('sessions', { method: 'POST', body: { ...body, eventId: curEventId(), clientToken: token } });
      store.set('prefs', { names: [fd.us1, fd.us2] });
      store.set('my', { eventId: curEventId(), sessionId: out.session.id, side });
      store.set('lastSession', { startBoard: out.session.startBoard, side, sessionId: out.session.id, eventId: curEventId() });
      upsertSession(out.session);
      toast(editing ? 'Names saved' : 'Table started');
      go(`#/s/${out.session.id}`);
    } catch (e) {
      document.getElementById('formErr').textContent = e.message;
      btn.disabled = false;
    }
  };
}

// One entry per name ignoring capitals and spaces, keeping the first spelling seen.
function uniqNames(list) {
  const seen = new Map();
  for (const raw of list) {
    const n = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  }
  return [...seen.values()];
}

// Name suggestions under each box. Works the same on phones and computers
// (phones ignore or hide the browser's own <datalist> list).
// Empty box → every known name; typing → names with a word starting with
// what's typed first, then names containing it. Names already in another
// box are left out. Tap a name to fill the box and move to the next one.
function nameSuggest(form, fields, names) {
  const inputs = fields.map((n) => form.elements[n]);
  inputs.forEach((inp, i) => {
    const wrap = inp.parentElement;
    const list = document.createElement('ul');
    list.className = 'ac-list'; list.id = `ac-${inp.name}`; list.setAttribute('role', 'listbox'); list.hidden = true;
    wrap.appendChild(list);
    inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-controls', list.id); inp.setAttribute('aria-expanded', 'false');
    let active = -1, shown = [];

    const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); active = -1; };
    const highlight = () => list.querySelectorAll('li').forEach((li, k) => {
      li.classList.toggle('on', k === active); li.setAttribute('aria-selected', k === active);
      if (k === active) li.scrollIntoView({ block: 'nearest' });
    });
    const open = () => {
      const q = inp.value.trim().toLowerCase();
      const taken = new Set(inputs.filter((o) => o !== inp).map((o) => o.value.trim().toLowerCase()).filter(Boolean));
      const free = names.filter((n) => !taken.has(n.toLowerCase()));
      shown = !q ? free : [
        ...free.filter((n) => n.toLowerCase().split(' ').some((w) => w.startsWith(q))),
        ...free.filter((n) => n.toLowerCase().includes(q) && !n.toLowerCase().split(' ').some((w) => w.startsWith(q))),
      ];
      if (shown.length === 1 && shown[0].toLowerCase() === q) shown = [];
      if (!shown.length) return close();
      list.innerHTML = shown.map((n, k) => `<li role="option" id="${list.id}-${k}" data-k="${k}">${esc(n)}</li>`).join('');
      active = -1; list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    };
    const pick = (k) => {
      inp.value = shown[k]; close();
      const next = inputs.slice(i + 1).find((o) => !o.value.trim());
      if (next) next.focus(); else inp.blur();
    };

    inp.addEventListener('focus', () => {
      open();
      // On phones, once the keyboard is up, nudge the page only as far as needed
      // to show a few suggestions — never so far that the box leaves the screen.
      setTimeout(() => {
        const vv = window.visualViewport; if (!vv || document.activeElement !== inp) return;
        const r = inp.getBoundingClientRect();
        const room = vv.height - r.bottom;                 // space under the box, above the keyboard
        const need = Math.min(180, list.scrollHeight || 0);
        if (room >= need) return;
        const lift = Math.min(need - room, r.top - 16);    // keep the box at least 16px from the top
        if (lift > 0) window.scrollBy({ top: lift, behavior: 'smooth' });
      }, 350);
    });
    inp.addEventListener('input', open);
    inp.addEventListener('blur', () => setTimeout(close, 150));
    inp.addEventListener('keydown', (e) => {
      if (list.hidden) { if (e.key === 'ArrowDown') { open(); e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter' && active >= 0) { pick(active); e.preventDefault(); }
      else if (e.key === 'Escape') close();
    });
    // pointerdown + preventDefault keeps the box focused (and the keyboard up) while tapping.
    list.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      e.preventDefault(); pick(Number(li.dataset.k));
    });
  });
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
  if (!s) {
    // The organiser may have deleted this game, or cleared the day.
    if (mine()?.sessionId === r.a) store.del('my');
    $app.innerHTML = shell('play', `<div class="card"><h2>This table is no longer here</h2>
      <p>The organiser may have started a new session or cleared the tables.</p><a class="btn primary big block" href="#/play">Go to the Play screen</a></div>`);
    return;
  }
  const m = mine();
  const isMine = m?.sessionId === s.id;
  const rows = dealsFor(s);
  const done = rows.filter((x) => x.d).length;
  const t = sessionTotals(rows.filter((x) => x.scored).map((x) => x.scored));
  const next = rows.find((x) => !x.d);

  const card = (x) => {
    const title = `<span class="bnum">Board ${x.board}${x.d ? ' <span class="played">– played</span>' : ''}</span>`;
    const head = `<div class="bhead">${x.d ? title : `<div class="btitle">${title}${prevBoardLink(x.board - 1, `t:${s.id}`)}</div>`}
      <span class="vultog">${['ns', 'ew'].map((k) => `<button type="button" class="vb tap ${x.vul[k] ? 'on' : ''}" data-vultog="${x.n}:${k}" aria-pressed="${x.vul[k]}" aria-label="Board ${x.board}: ${short(k.toUpperCase())} ${x.vul[k] ? 'vulnerable' : 'not vulnerable'}. Tap to change">${short(k.toUpperCase())} ${x.vul[k] ? 'Vul' : 'Not vul'}</button>`).join('')}</span></div>`;
    if (!x.d) {
      const isNext = next && next.n === x.n;
      return `<div class="card board todo ${isNext ? 'next' : ''}">${head}
      <p class="muted">${isNext ? '<strong class="nextlbl">Next to enter</strong> · ' : ''}Deal ${x.n} · Dealer ${seatName(x.dealer)}</p>
      <a class="btn block ${isNext ? 'primary' : ''}" href="#/deal/${s.id}/${x.n}">Enter result ›</a></div>`;
    }
    const sc = x.scored;
    return `<div class="card board">${head}
      <dl class="facts">
        <div><dt>Contract</dt><dd>${contractHtml(x.d)}${x.d.passedOut ? '' : ` <span class="by">by ${seatName(x.d.declarer)}</span>`}</dd></div>
        ${x.d.passedOut ? '' : `<div class="res"><dt>Result</dt><dd>${x.d.tricks} trick${x.d.tricks === 1 ? '' : 's'},<br>${esc(sc.outcome)}</dd></div>
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

  const nb = s.startBoard + 4;
  const nextBtn = `<button class="btn primary big block" data-newgame>Play the next 4 boards ›<span class="btn-sub">Boards ${nb}–${nb + 3}</span></button>`;

  $app.innerHTML = shell('play', `
    <header class="top">
      <p class="pairs"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}<br><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
      ${isMine ? `<p class="you-are">You are <strong class="${m.side === 'NS' ? 'tns' : 'tew'}">${sideName(m.side)}</strong> <button class="btn small swap" id="swapSide" type="button">Swap</button></p>` : ''}
    </header>
    <div class="progress" aria-label="${done} of 4 boards completed"><div class="bar"><span style="width:${done * 25}%"></span></div><strong>${done} of 4 boards completed</strong></div>
    ${done ? totalsCard(t) : ''}
    ${done === 4 ? `<p class="done-note">All 4 boards done — results below.</p>${nextBtn}` : ''}
    <div class="boards">${rows.map(card).join('')}</div>
    <div class="wide-only card"><table class="results"><thead><tr><th>Board</th><th>Vul</th><th>Bid</th><th>Winner</th><th>Lead</th><th>Result</th><th class="num">N/S</th><th class="num">E/W</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <div class="stack foot">
      ${done === 4 ? nextBtn : '<button class="btn ghost block" data-newgame>Leave this table</button>'}
      ${isMine ? '' : '<button class="btn block" id="claim">This is my table</button>'}
      <a class="btn ghost block" href="#/edit/${s.id}">Change names</a>
      ${logoutButton()}
    </div>`);

  const startNew = () => {
    store.set('lastSession', { startBoard: s.startBoard, side: m?.side || 'NS', sessionId: s.id, eventId: curEventId() });
    store.del('my');
    go('#/new');
  };
  $app.querySelectorAll('[data-newgame]').forEach((b) => (b.onclick = () => {
    // In-app question (pop-up dialogs are blocked in some browsers)
    sheet((done === 4 ? `<h2>Play the next 4 boards</h2>
      <p>Your results at this table are saved. If someone at your next table has already set it up, join it instead.</p>
      <button class="btn primary big block" id="leaveYes">Set up the next table (Boards ${nb}–${nb + 3})</button>
      <button class="btn big block" id="leaveJoin">Join a table already started</button>`
      : `<h2>Leave this table?</h2>
      <p>${done} of 4 boards have been entered. They stay saved, and you can come back to this table from the Play screen.</p>
      <button class="btn primary big block" id="leaveYes">Set up a new table</button>
      <button class="btn big block" id="leaveJoin">Join a different table</button>`), (root) => {
      root.querySelector('#leaveYes').onclick = () => { closeSheet(); startNew(); };
      root.querySelector('#leaveJoin').onclick = () => {
        closeSheet();
        store.set('lastSession', { startBoard: s.startBoard, side: m?.side || 'NS', sessionId: s.id, eventId: curEventId() });
        store.del('my');
        go('#/play');   // the Play screen lists every table already started
      };
    });
  }));
  document.getElementById('claim')?.addEventListener('click', () => chooseSide(s.id));
  document.getElementById('swapSide')?.addEventListener('click', () => {
    const side = m.side === 'NS' ? 'EW' : 'NS';
    store.set('my', { ...m, side });
    // Remember the new pair's names so joining later tables matches the right side.
    const names = side === 'NS' ? [s.nsP1, s.nsP2] : [s.ewP1, s.ewP2];
    if (names[0] && names[1]) store.set('prefs', { ...store.get('prefs', {}), names });
    toast(`You are now ${sideName(side)}`);
    render();
  });
  wireLogout();
  $app.querySelectorAll('[data-vultog]').forEach((b) => (b.onclick = () => {
    const [n, k] = b.dataset.vultog.split(':');
    const cur = rows[Number(n) - 1].vul;
    setVul(s, Number(n), { ...cur, [k]: !cur[k] });
  }));
}

// Change vulnerability straight from a board tile. Unplayed board: remembered
// for when its result is entered. Saved board: re-saved and re-scored at once.
async function rerenderKeepScroll() { const y = window.scrollY; await render(); window.scrollTo(0, y); }

async function setVul(s, n, v) {
  const d = s.deals.find((x) => x.dealNo === n);
  const draftKey = `draft:${s.id}:${n}`;
  const board = boardNumberFor(n, s.startBoard);
  if (!d) {
    store.set(draftKey, { ...(store.get(draftKey) || {}), vulNs: v.ns, vulEw: v.ew });
    toast(`Board ${board}: ${vulnerabilityText(v)}`);
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
    toast(`Board ${board}: ${vulnerabilityText(v)} · ${sc.scoredBy ? `${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)}` : 'no score'}`);
    rerenderKeepScroll();
  } catch (e) {
    toast(e.status === 409 ? 'This board was just changed on another phone. Please check it.' : e.message, 'error');
    loadDay().then(rerenderKeepScroll).catch(() => {});
  }
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
// Shared "Log out" confirmation (Day summary and results screen)
function confirmLogout(extra = '') {
  sheet(`<h2>Log out of this phone?</h2>
    <p>You’ll need the access code to get back in. Saved results are not affected.${extra}</p>
    <button class="btn primary big block" id="yes">Yes, log out</button>`, (root) => {
    root.querySelector('#yes').onclick = async () => {
      closeSheet();
      try { await api('login', { method: 'DELETE' }); } catch { /* ignore */ }
      store.del('my'); store.del('lastSession');
      state.admin = false; state.data = null;
      go('#/login');
    };
  });
}

// "See previous Board Ns" link: opens that board at every table; `ret` says where Return goes.
// Greyed out (not a link) until someone has entered that board in this session.
function prevBoardLink(prev, ret) {
  if (prev < 1) return '';
  if (!canSee(prev)) return `<span class="prevlink off" aria-disabled="true" title="Shown once you’ve entered Board ${prev}">Board ${prev}s hidden</span>`;
  return playsOfBoard(prev, state.data.sessions).length
    ? `<a class="prevlink" href="#/board/${prev}/${ret}">See previous Board ${prev}s ›</a>`
    : `<span class="prevlink off" aria-disabled="true">See previous Board ${prev}s</span>`;
}

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
  const justSaved = !!existing && state.justSaved === `${s.id}:${n}`;
  state.justSaved = null;
  state.entry = { justSaved, sessionId: s.id, n, def, expectedUpdatedAt: existing?.updatedAt || null, e: { ...blank, ...(store.get(draftKey) || saved || {}) } };
  const board = boardNumberFor(n, s.startBoard);
  // Link to the previous board's results at every table (greyed out if nobody has entered it yet).
  const prev = board - 1;
  const prevLink = prevBoardLink(prev, `${s.id}:${n}`);

  $app.innerHTML = shell('play', `
    <header class="entry-head">
      <div class="entry-toprow"><a href="#/s/${s.id}" class="back">‹ Back to the table</a>${prevLink}</div>
      <div class="bline"><span class="bnum big">Board ${board}</span><span class="muted">Deal ${n} of 4 · Dealer ${seatName(dealerFor(n, s.firstDealer))}</span></div>
    </header>
    ${justSaved ? '<p class="note saved">Saved ✓ How the other tables did is shown below.</p>'
      : existing ? '<p class="note">Already saved. Change anything and tap Save to correct it.</p>' : ''}
    <div id="entry"></div>
    <section class="card" id="othersCard"><h2>At other tables</h2><div id="others">${othersOnBoard(board, s.id)}</div></section>
    <div class="savebar"><div id="preview" class="preview" aria-live="polite"></div><button class="btn primary big" id="saveBtn">Save result</button></div>`);
  state.entry.draftKey = draftKey;
  drawEntry();
  if (justSaved) {
    // Bring the other tables' results into view, below the header.
    requestAnimationFrame(() => {
      const c = document.getElementById('othersCard');
      if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
    });
  }
}

// After a save the bottom button moves on: the next board still to enter, or the table.
function nextAfterSave() {
  const s = sessionById(state.entry.sessionId);
  const nxt = [1, 2, 3, 4].find((k) => !s.deals.some((d) => d.dealNo === k));
  return nxt
    ? { label: `Next: Board ${boardNumberFor(nxt, s.startBoard)} ›`, go: () => go(`#/deal/${s.id}/${nxt}`) }
    : { label: 'Back to the table ›', go: () => { state.scrollToNext = true; go(`#/s/${s.id}`); } };
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
      ${changed ? `<p class="warn oneline">Not the usual (${vulnerabilityText(def).replace('vulnerable', 'vul')}). <button type="button" class="link" data-act="vulreset">(Undo)</button></p>` : ''}
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
        <div class="grid seven ranks">${LEAD_RANKS.map((rk) => btn('lrank', rk, rk, e.leadRank === rk)).join('')}</div>
        <div class="grid four">${SUITS.map((st) => btn('lsuit', st, suitHtml(st), e.leadSuit === st, 'suitkey')).join('')}</div>
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
  if (state.entry.justSaved) {
    state.entry.justSaved = false;
    document.querySelector('.note.saved')?.replaceWith(Object.assign(document.createElement('p'), { className: 'note', textContent: 'Already saved. Tap Save to correct it.' }));
  }
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
  if (state.entry.justSaved) {
    const nx = nextAfterSave();
    saveBtn.textContent = nx.label; saveBtn.disabled = false; saveBtn.onclick = nx.go;
  } else {
    saveBtn.textContent = 'Save result'; saveBtn.onclick = () => saveEntry(state.entry.draftKey);
  }
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
    // Stay on this board so they can see how the other tables did, then move on.
    state.justSaved = `${sessionId}:${n}`;
    const here = `#/deal/${sessionId}/${n}`;
    if (location.hash === here) await render(); else go(here);
    loadDay().then(() => {
      const o = document.getElementById('others');
      if (o && route().name === 'deal') o.innerHTML = othersOnBoard(out.deal.boardNum, sessionId);
    }).catch(() => {});
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Save result';
    if (e.status === 409) {
      const cur = e.body?.current;
      state.entry.expectedUpdatedAt = cur?.updatedAt || null;
      if (cur) {
        const s = sessionById(sessionId);
        s.deals = s.deals.filter((x) => x.dealNo !== n).concat(cur);
        const sc = scoreDeal(cur, s.firstDealer);
        sheet(`<h2>Saved on another phone</h2>
          <p>This board was just saved as <strong>${esc(contractText(cur))}${cur.passedOut ? '' : ' by ' + seatName(cur.declarer) + ', ' + esc(outcomeText(cur))}</strong>${sc.scoredBy ? ` (${short(sc.scoredBy)} score ${Math.abs(sc.nsScore)})` : ''}.</p>
          <p>Your entry is still on screen. Tap Save again only if yours is the correct one.</p>`);
      } else {
        toast(e.message, 'error');
      }
    } else {
      toast(e.status === 0 ? 'Not saved: no connection. Your entry is kept; tap Save again.' : e.message, 'error');
    }
  }
}

// ---------- results of one board in other games ----------
// Boards this phone may see other tables' results for: boards its own pair
// (or the table it is sitting at) has already entered in this session.
// Returns null for the organiser, who sees everything.
function seenBoards() {
  if (state.admin) return null;
  const m = mine();
  const names = store.get('prefs', {}).names;
  const me = names?.[0] && names?.[1] ? pairKey(names[0], names[1]) : null;
  const seen = new Set();
  for (const s of state.data.sessions) {
    const ours = s.id === m?.sessionId || (me && (pairKey(s.nsP1, s.nsP2) === me || pairKey(s.ewP1, s.ewP2) === me));
    if (ours) for (const d of s.deals) seen.add(d.boardNum);
  }
  return seen;
}
const canSee = (board) => { const seen = seenBoards(); return !seen || seen.has(board); };
const HIDDEN_NOTE = 'You’ll see the other tables’ results for this board once you’ve entered your own.';

function playsOfBoard(board, sessions) {
  const out = [];
  for (const s of sessions) for (const d of s.deals) if (d.boardNum === board) out.push({ s, d, sc: scoreDeal(d, s.firstDealer) });
  return out;
}

function othersOnBoard(board, mySessionId) {
  if (!canSee(board)) return `<p class="muted">${HIDDEN_NOTE}</p>`;
  const plays = playsOfBoard(board, state.data.sessions).filter((p) => p.s.id !== mySessionId);
  if (!plays.length) return '<p class="muted">No other table has recorded this board yet.</p>';
  return `<p class="muted">${plays.length} other table${plays.length > 1 ? 's' : ''}</p>` + plays.map((p) => playCard(p)).join('');
}

function playCard({ s, d, sc }, highlight = false) {
  return `<div class="play ${highlight ? 'mine' : ''}">
    ${highlight ? '<span class="pill">Your table</span>' : ''}
    <p class="pl-names"><span class="tag ns">N/S</span> ${esc(pairLabel(s.nsP1, s.nsP2))}<br><span class="tag ew">E/W</span> ${esc(pairLabel(s.ewP1, s.ewP2))}</p>
    <p class="pl-res">${contractHtml(d)}${d.passedOut ? '' : ` by ${seatName(d.declarer)} · ${d.tricks} tricks · lead ${leadHtml(d)}`}</p>
    <p class="muted">${esc(sc.vulText)}${d.passedOut ? '' : ' · ' + esc(sc.outcome)}</p>
    <div class="scores">${scorePair(sc.nsScore)}</div></div>`;
}

// =============================================================
//  Other results — every board played on a day
// =============================================================
// ---------- session picker (shown on Play, Other results and Day summary) ----------
function fmtStart(e) {
  const d = new Date(e.startedAt);
  const day = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}
function sessionPicker() {
  const d = state.data;
  return `<label class="lbl small" for="sessPick">Session (date and start time)</label>
    <select id="sessPick" class="input">${d.events.map((e) => `<option value="${e.id}" ${e.id === d.event.id ? 'selected' : ''}>${esc(fmtStart(e))}${e.id === d.latestId ? ' – newest' : ''}</option>`).join('')}</select>`;
}
function wireSessionPicker() {
  const el = document.getElementById('sessPick');
  if (!el) return;
  el.onchange = async () => {
    if (el.value === state.data.latestId) store.del('event');
    else store.set('event', { id: el.value, pickedAt: Date.now() });
    state.data = null;
    await render();
  };
}
const logoutButton = () => '<button class="btn ghost block logout" id="logout">Log out</button>';
const wireLogout = () => document.getElementById('logout')?.addEventListener('click', () => confirmLogout());

async function renderOthers() {
  const data = state.data;
  const boards = new Map();
  for (const s of data.sessions) for (const d of s.deals) boards.set(d.boardNum, (boards.get(d.boardNum) || 0) + 1);
  const m = mine();
  const myBoards = new Set(m ? (sessionById(m.sessionId)?.deals || []).map((d) => d.boardNum) : []);
  const list = [...boards.entries()].sort((a, b) => a[0] - b[0]);
  $app.innerHTML = shell('others', `
    <header class="top"><a href="#/play" class="back">‹ ${mine() ? 'Back to the table' : 'Back'}</a><h1>Other results</h1>${sessionPicker()}</header>
    <p class="muted">Tap a board to compare every table’s result for that board. Boards you haven’t entered yet stay hidden.</p>
    ${list.length ? `<div class="boardgrid">${list.map(([b, c]) => canSee(b)
      ? `<a class="bcell ${myBoards.has(b) ? 'mine' : ''}" href="#/board/${b}"><span class="blbl">Board</span><strong>${b}</strong><span>${c} table${c > 1 ? 's' : ''}</span></a>`
      : `<span class="bcell locked" aria-disabled="true"><span class="blbl">Board</span><strong>${b}</strong><span>Hidden till you play it</span></span>`).join('')}</div>`
      : '<div class="card"><p class="muted">No boards recorded in this session yet.</p></div>'}
    ${logoutButton()}`);
  wireSessionPicker(); wireLogout();
}

async function renderBoard(r) {
  const data = state.data;
  const board = Number(r.a);
  const m = mine();
  const plays = playsOfBoard(board, data.sessions);
  plays.sort((a, b) => (b.s.id === m?.sessionId) - (a.s.id === m?.sessionId));
  // Opened from the results-entry screen ("See previous Board Ns")? Then go back there.
  const ret = /^([0-9a-f-]{36}):([1-4])$/i.exec(r.b || '');
  const retT = /^t:([0-9a-f-]{36})$/i.exec(r.b || '');
  const retSess = (ret && sessionById(ret[1])) || (retT && sessionById(retT[1]));
  const back = retSess && ret
    ? `<a href="#/deal/${ret[1]}/${ret[2]}" class="back">‹ Return to Board ${boardNumberFor(Number(ret[2]), retSess.startBoard)}</a>`
    : retSess ? `<a href="#/s/${retSess.id}" class="back">‹ Return to the table</a>`
    : '<a href="#/others" class="back">‹ All boards</a>';
  $app.innerHTML = shell(retSess ? 'play' : 'others', `
    <header class="top">${back}<h1>Board ${board}</h1><p class="muted">${esc(fmtStart(data.event))}${canSee(board) ? ` · ${plays.length} table${plays.length === 1 ? '' : 's'}` : ''}</p></header>
    <section class="card">${!canSee(board) ? `<p class="muted">${HIDDEN_NOTE}</p>`
      : plays.length ? plays.map((p) => playCard(p, p.s.id === m?.sessionId)).join('') : '<p class="muted">Nobody has recorded this board yet.</p>'}</section>`);
}

// =============================================================
//  Day summary
// =============================================================
async function renderDay() {
  const data = state.data;
  const rows = daySummary(data.sessions);
  const games = data.sessions.length;
  $app.innerHTML = shell('day', `
    <header class="top"><a href="#/play" class="back">‹ ${mine() ? 'Back to the table' : 'Back'}</a><h1>Day summary</h1>${sessionPicker()}</header>
    <p class="muted">${games} table${games === 1 ? '' : 's'} in this session. Pairs are ranked by the total points they won.</p>
    ${rows.length ? rows.map((x) => `<a class="card rank" href="#/pair/${encodeURIComponent(x.key)}">
        <span class="rk">${x.rank}</span>
        <span class="rn"><strong>${esc(x.label)}</strong>
          <span class="muted">${x.boards} board${x.boards === 1 ? '' : 's'} · ${x.games} table${x.games === 1 ? '' : 's'}${x.gamesWon ? `, ${x.gamesWon} won` : ''}</span>
          <span class="muted">Average ${x.avgPerBoard} a board</span></span>
        <span class="rv">${x.points}</span></a>`).join('')
      : '<div class="card"><p class="muted">No results yet in this session.</p></div>'}
    ${state.admin ? organiserPanel(data) : logoutButton()}`);
  wireSessionPicker(); wireLogout();
  if (state.admin) wireOrganiser(data);
}

// ---------- organiser (super-user) tools: only on phones logged in with the organiser code ----------
function organiserPanel(data) {
  const games = data.sessions;
  return `<section class="card organiser">
    <h2>Organiser</h2>
    <p class="muted">Only phones logged in with the organiser code see this.</p>
    <button class="btn primary big block" id="newSession">Start a new session</button>
    <p class="muted small">Showing the session started ${esc(fmtStart(data.event))}${data.event.id === data.latestId ? ' (the newest)' : ''}</p>
    ${games.length ? `<div class="stack">${games.map((g) => `<div class="org-row">
        <span><strong>${esc(pairLabel(g.nsP1, g.nsP2))}</strong> v <strong>${esc(pairLabel(g.ewP1, g.ewP2))}</strong><br>
        <span class="muted">Boards ${g.startBoard}–${g.startBoard + 3} · ${g.deals.length} of 4 entered</span></span>
        <button class="btn danger small-btn" data-delgame="${g.id}">Delete</button></div>`).join('')}</div>
      <button class="btn danger big block" id="clearDay">Clear ${games.length === 1 ? 'the 1 table' : `all ${games.length} tables`} in this session</button>`
      : '<p class="muted">No tables in this session.</p>'}
    <button class="btn ghost block" id="manageNames">Removing player names…</button>
    <button class="btn ghost block" id="leaveOrg">Leave organiser mode (log out)</button>
  </section>`;
}

// Organiser: remove names from (or return them to) the set-up screen's suggestions.
// Game results keep their names; this only affects the suggestion list.
function namesSheet() {
  const shown = state.data.names || [], hidden = state.data.hiddenNames || [];
  const sorted = [...shown].sort((a, b) => a.localeCompare(b));
  sheet(`<div class="sheet-head"><h2>Player names</h2><button class="btn primary" id="namesTop">Done</button></div>
    <p class="muted">These are suggested when setting up a table. Removing a name doesn’t change any results. If a removed name is used in a new game, it’s suggested again.</p>
    ${sorted.length ? `<div class="name-rows">${sorted.map((n) => `<div class="org-row"><span><strong>${esc(n)}</strong></span>
      <button class="btn danger small-btn" data-hide="${esc(n)}">Remove</button></div>`).join('')}</div>`
      : '<p class="muted">No names yet.</p>'}
    ${hidden.length ? `<h3>Removed</h3><div class="name-rows">${hidden.map((n) => `<div class="org-row"><span class="muted">${esc(n)}</span>
      <button class="btn ghost small-btn" data-unhide="${esc(n)}">Put back</button></div>`).join('')}</div>` : ''}
    <button class="btn primary big block" id="namesDone">Done</button>`, (root) => {
    const act = async (btn, action, name) => {
      // Show straight away that the tap registered; block other taps until done.
      const hiding = action === 'hideName';
      const row = btn.closest('.org-row');
      root.querySelectorAll('button').forEach((x) => (x.disabled = true));
      row.classList.add('working');
      btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${hiding ? 'Removing…' : 'Putting back…'}`;
      const scroll = root.querySelector('.sheet').scrollTop;
      try {
        await api('admin', { method: 'POST', body: { action, name } });
        // Update the lists here rather than reloading everything from the server.
        const key = name.toLowerCase();
        const d = state.data;
        if (hiding) {
          d.names = (d.names || []).filter((n) => n.toLowerCase() !== key);
          d.hiddenNames = [...(d.hiddenNames || []), name];
        } else {
          d.hiddenNames = (d.hiddenNames || []).filter((n) => n.toLowerCase() !== key);
          d.names = [name, ...(d.names || [])];
        }
        namesSheet();
        document.querySelector('#sheet .sheet').scrollTop = scroll;
        toast(hiding ? `Removed ${name}` : `Put back ${name}`);
      } catch (e) {
        toast(e.message, 'error');
        namesSheet();
      }
    };
    root.querySelectorAll('[data-hide]').forEach((b) => (b.onclick = () => act(b, 'hideName', b.dataset.hide)));
    root.querySelectorAll('[data-unhide]').forEach((b) => (b.onclick = () => act(b, 'unhideName', b.dataset.unhide)));
    const done = () => { closeSheet(); rerenderKeepScroll(); };
    root.querySelector('#namesDone').onclick = done;
    root.querySelector('#namesTop').onclick = done;
    root.querySelector('#sheetClose').remove();   // Done does the same job
  });
}

function wireOrganiser(data) {
  const after = async (msg) => {
    toast(msg);
    const m = mine();
    await loadDay();
    if (m && !sessionById(m.sessionId)) store.del('my');
    rerenderKeepScroll();
  };
  $app.querySelectorAll('[data-delgame]').forEach((b) => (b.onclick = () => {
    const g = data.sessions.find((x) => x.id === b.dataset.delgame);
    sheet(`<h2>Delete this table?</h2>
      <p><strong>${esc(pairLabel(g.nsP1, g.nsP2))}</strong> v <strong>${esc(pairLabel(g.ewP1, g.ewP2))}</strong>, boards ${g.startBoard}–${g.startBoard + 3}.</p>
      <p>Its ${g.deals.length} saved board${g.deals.length === 1 ? '' : 's'} will be removed for everyone. This can’t be undone.</p>
      <button class="btn danger big block" id="yes">Yes, delete this table</button>`, (root) => {
      root.querySelector('#yes').onclick = async () => {
        closeSheet();
        try { await api('admin', { method: 'POST', body: { action: 'deleteGame', id: g.id } }); await after('Table deleted'); }
        catch (e) { toast(e.message, 'error'); }
      };
    });
  }));
  document.getElementById('clearDay')?.addEventListener('click', () => {
    const n = data.sessions.length, boards = data.sessions.reduce((t, g) => t + g.deals.length, 0);
    sheet(`<h2>Clear every table in this session?</h2>
      <p>${esc(fmtStart(data.event))}</p>
      <p>This deletes <strong>all ${n} table${n === 1 ? '' : 's'}</strong> and <strong>${boards} saved board${boards === 1 ? '' : 's'}</strong> for everyone, so you can start again. This can’t be undone.</p>
      <button class="btn danger big block" id="yes">Yes, clear everything</button>`, (root) => {
      root.querySelector('#yes').onclick = async () => {
        closeSheet();
        try { const out = await api('admin', { method: 'POST', body: { action: 'clearSession', eventId: data.event.id } }); await after(`Cleared ${out.deletedGames} table${out.deletedGames === 1 ? '' : 's'}`); }
        catch (e) { toast(e.message, 'error'); }
      };
    });
  });
  document.getElementById('newSession').onclick = () => {
    sheet(`<h2>Start a new session?</h2>
      <p>Every phone moves to the new session and all tables start empty. Earlier sessions are kept and can still be chosen from the Session list.</p>
      <button class="btn primary big block" id="yes">Yes, start a new session</button>`, (root) => {
      root.querySelector('#yes').onclick = async () => {
        closeSheet();
        try {
          await api('admin', { method: 'POST', body: { action: 'newSession' } });
          store.del('event'); store.del('my'); store.del('lastSession');
          state.data = null;
          toast('New session started');
          await render();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };
  document.getElementById('manageNames').onclick = () => namesSheet();
  document.getElementById('leaveOrg').onclick = async () => {
    try { await api('login', { method: 'DELETE' }); } catch { /* ignore */ }
    store.del('my'); store.del('lastSession');
    state.admin = false; state.data = null;
    go('#/login');
  };
}

async function renderPair(r) {
  const data = state.data;
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
        if (!canSee(d.boardNum)) return `<tr><td>Bd ${d.boardNum}</td><td colspan="3" class="muted">Hidden until you’ve entered it</td></tr>`;
        return `<tr><td>Bd ${d.boardNum}</td><td>${contractHtml(d)}${d.passedOut ? '' : ' ' + d.declarer}</td><td>${esc(sc.outcome)}</td><td class="num ${pts ? 'pos' : 'muted'}">${pts}</td></tr>`;
      }).join('')}</tbody></table></section>`);
  }
  $app.innerHTML = shell('day', `
    <header class="top"><a href="#/day" class="back">‹ Day summary</a><h1>${esc(row?.label || 'Pair')}</h1>
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
      const y = window.scrollY; await render(); window.scrollTo(0, y);
    }
  } catch { /* offline — try again next time */ }
}, 20000);

// ---------- start ----------
(async () => {
  try {
    const { ok, admin } = await api('login');
    state.admin = !!admin;
    if (!ok) return go('#/login');
  } catch (e) {
    $app.innerHTML = `<main class="screen">${errorBlock(e.message)}</main>`;
    return;
  }
  if (!location.hash || location.hash === '#/login') location.hash = '#/play';
  render();
})();
