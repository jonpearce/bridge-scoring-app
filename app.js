// ═══════════════════════════════════════════════════════════════
//  Duplicate Bridge Scoring — app
//  Phone-first, large type, real-time collation via Supabase.
// ═══════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  boardInfo, makeScore, scoreBoard, standings,
  displayContract, vulnerabilityText, strainGlyph,
} from './bridge.js';

/* ---------- tiny helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frag = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
const fmtScore = (n) => (n > 0 ? `+${n}` : `${n}`);
const suits = ['C', 'D', 'H', 'S', 'NT'];
const SUIT_COLORS = { C: 'var(--green)', D: 'var(--red)', H: 'var(--red)', S: 'var(--ink)', NT: 'var(--accent-2)' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normSuit = (s) => ({ '♣': 'C', '♦': 'D', '♥': 'H', '♠': 'S' }[s] || s);

const appEl = document.getElementById('app');
let toastTimer = null;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = frag(`<div class="toast">${esc(msg)}</div>`).firstElementChild;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

const randomCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

/* ---------- Supabase ---------- */
const configured = SUPABASE_URL.startsWith('http') && !SUPABASE_ANON_KEY.startsWith('PASTE');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/* ---------- state ---------- */
const state = {
  screen: 'home',
  sheet: null,                    // { done: {boardNum}, detail: {boardNum}, tables }
  todaySession: null,             // the single session set up for today
  session: null,
  boards: [],
  pairs: [],
  results: [],
  myTable: null,                  // pinned table number for this phone
  draft: {
    tables: 6,
    boards: 24,
    pairs: {},                    // tableNum -> {ns, ew}
    vuln: {},                     // boardNum -> {ns, ew}
  },
  entry: null,                    // current contract being entered
  standingsTab: 'standings',
  standingsBoard: null,
};

const ls = {
  pin(code) { return localStorage.getItem(`bridge:pin:${code}`); },
  setPin(code, t) { localStorage.setItem(`bridge:pin:${code}`, t); },
  clearPin(code) { localStorage.removeItem(`bridge:pin:${code}`); },
};

/* ---------- realtime ---------- */
let chan = null;
function subscribe(code) {
  chan?.unsubscribe();
  if (!supabase) return;
  chan = supabase
    .channel(`room-${code}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'results', filter: `session_id=eq.${code}` }, (p) => {
      applyResultChange(p);
      if (state.screen === 'room' || state.screen === 'entry' || state.screen === 'standings' || state.sheet?.done || state.sheet?.detail) render();
    })
    .subscribe();
}

function applyResultChange(p) {
  const r = p.new || {};
  if (p.eventType === 'DELETE') {
    state.results = state.results.filter((x) => x.id !== p.old.id);
    return;
  }
  if (typeof r.strain === 'string') r.strain = normSuit(r.strain);
  if (typeof r.open_lead === 'string' && r.open_lead.length === 2) r.open_lead = normSuit(r.open_lead[0]) + r.open_lead[1];
  const i = state.results.findIndex((x) => x.id === r.id);
  if (i >= 0) state.results[i] = r; else state.results.push(r);
  refreshEntryMp();
}

function normalizeResults() {
  for (const r of state.results) {
    if (typeof r.strain === 'string') r.strain = normSuit(r.strain);
    if (typeof r.open_lead === 'string' && r.open_lead.length === 2) r.open_lead = normSuit(r.open_lead[0]) + r.open_lead[1];
  }
}

/* ---------- computation ---------- */
function pairAt(tableNum) {
  return state.pairs.find((p) => p.table_num === tableNum) || { ns_pair: `T${tableNum} NS`, ew_pair: `T${tableNum} EW` };
}
function vulnFor(boardNum) {
  return state.boards.find((b) => b.board_num === boardNum) || boardInfo(boardNum);
}
function computeBoards() {
  const byBoard = {};
  for (const r of state.results) {
    const b = byBoard[r.board_num] || (byBoard[r.board_num] = []);
    b.push({ ...r });
  }
  const out = {};
  for (const [bn, rows] of Object.entries(byBoard)) {
    const v = vulnFor(+bn);
    out[+bn] = scoreBoard(rows, { ns: !!v.vul_ns, ew: !!v.vul_ew });
  }
  return out;
}
function computeStandings() {
  const byBoard = computeBoards();
  const shaped = [];
  for (const r of state.results) {
    const side = r.declarer ? directionSideJS(r.declarer) : null;
    const p = pairAt(r.table_num);
    if (side) {
      shaped.push({ ...r, side, ns_pair: p.ns_pair, ew_pair: p.ew_pair });
    } else {
      // passed out: scores zero for both pairs, count it on both sides
      shaped.push({ ...r, side: 'NS', ns_pair: p.ns_pair, ew_pair: p.ew_pair });
      shaped.push({ ...r, side: 'EW', ns_pair: p.ns_pair, ew_pair: p.ew_pair });
    }
  }
  return standings(byBoard, shaped);
}
const directionSideJS = (d) => (d === 'N' || d === 'S' ? 'NS' : 'EW');

/* ---------- data ---------- */
async function createSession(numTables, numBoards, title) {
  const code = randomCode();
  const { data, error } = await supabase.from('sessions').insert({
    code, title: title || null, num_tables: numTables, num_boards: numBoards,
  }).select().single();
  if (error) throw new Error(error.message);

  const boardRows = [];
  for (let n = 1; n <= numBoards; n++) {
    const bi = boardInfo(n);
    boardRows.push({ session_id: code, board_num: n, dealer: bi.dealer, vul_ns: bi.ns, vul_ew: bi.ew });
  }
  const pairRows = Array.from({ length: numTables }, (_, i) => ({
    session_id: code, table_num: i + 1, ns_pair: `NS table ${i + 1}`, ew_pair: `EW table ${i + 1}`,
  }));
  const { error: bErr } = await supabase.from('boards').insert(boardRows);
  if (bErr) throw new Error(bErr.message);
  const { error: pErr } = await supabase.from('session_pairs').insert(pairRows);
  if (pErr) throw new Error(pErr.message);
  return data;
}

async function openSession(code) {
  const codeU = (code || '').trim().toUpperCase();
  if (!codeU) return toast('Enter the room code');
  const { data, error } = await supabase.from('sessions').select().eq('code', codeU).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return toast('No session matches that code');
  await loadSession(data);
  return data;
}

// The single session for today. With one room per evening, the most recent
// session that was set up on the same local day is "the" session.
async function todaySession() {
  if (!configured) return null;
  const { data, error } = await supabase.from('sessions')
    .select().order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const s = data || null;
  if (!s) return null;
  const d = new Date(s.created_at), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate() ? s : null;
}

async function loadSession(sess) {
  state.session = sess;
  const [boards, pairs, results] = await Promise.all([
    supabase.from('boards').select().eq('session_id', sess.code).order('board_num'),
    supabase.from('session_pairs').select().eq('session_id', sess.code).order('table_num'),
    supabase.from('results').select().eq('session_id', sess.code).order('board_num'),
  ]);
  if (boards.error) throw new Error(boards.error.message);
  if (pairs.error) throw new Error(pairs.error.message);
  if (results.error) throw new Error(results.error.message);
  state.boards = boards.data;
  state.pairs = pairs.data;
  state.results = results.data;
  normalizeResults();
  state.myTable = state.myTable ?? (Number(ls.pin(sess.code)) || (sess.num_tables === 1 ? 1 : null));
  state.standingsBoard = null;
  refreshEntryMp();
  subscribe(sess.code);
}

async function upsertResult() {
  const e = state.entry;
  const v = vulnFor(e.boardNum);
  const blank = entryIsBlank();
  const score = blank ? 0 : makeScore(e.level, e.strain, e.doubled || 'No', e.tricks, e.declarer, { ns: !!v.vul_ns, ew: !!v.vul_ew });
  const row = {
    session_id: state.session.code,
    board_num: e.boardNum,
    table_num: state.myTable,
    contract_level: blank ? null : e.level,
    strain: blank ? null : e.strain,
    doubled: blank ? 'No' : (e.doubled || 'No'),
    declarer: blank ? null : e.declarer,
    open_lead: e.lead,
    tricks: blank ? null : e.tricks,
    score,
  };
  const { error } = await supabase.from('results').upsert(row, { onConflict: 'session_id,board_num,table_num' });
  if (error) throw new Error(error.message);
  return score;
}

async function deleteResult(boardNum) {
  const { error } = await supabase.from('results')
    .delete()
    .eq('session_id', state.session.code)
    .eq('board_num', boardNum)
    .eq('table_num', state.myTable);
  if (error) throw new Error(error.message);
}

async function resetResults() {
  const { error } = await supabase.from('results')
    .delete()
    .eq('session_id', state.session.code);
  if (error) throw new Error(error.message);
  state.results = [];
  refreshEntryMp();
  render();
}

async function saveSetup() {
  const sess = state.session;
  const pairRows = Object.entries(state.draft.pairs).map(([t, p]) => ({
    session_id: sess.code, table_num: +t, ns_pair: p.ns, ew_pair: p.ew,
  }));
  const boardRows = Object.entries(state.draft.vuln).map(([bn, v]) => ({
    session_id: sess.code, board_num: +bn, dealer: boardInfo(+bn).dealer, vul_ns: v.ns, vul_ew: v.ew,
  }));
  if (pairRows.length) await supabase.from('session_pairs').upsert(pairRows, { onConflict: 'session_id,table_num' });
  if (boardRows.length) await supabase.from('boards').upsert(boardRows, { onConflict: 'session_id,board_num' });
  await loadSession(sess);
}

async function saveBoard(bn) {
  const b = state.boards.find((x) => x.board_num === bn);
  if (!b) return;
  const { error } = await supabase.from('boards').upsert({
    session_id: state.session.code, board_num: bn, dealer: b.dealer, vul_ns: b.vul_ns, vul_ew: b.vul_ew,
  }, { onConflict: 'session_id,board_num' });
  if (error) throw new Error(error.message);
  refreshEntryMp();
  render();
}

/* ---------- entry state ---------- */
function newEntry(boardNum, existing) {
  const e = existing
    ? { boardNum, level: existing.contract_level ?? null, strain: existing.strain ? normSuit(existing.strain) : null, doubled: existing.contract_level != null ? (existing.doubled && existing.doubled !== 'No' ? existing.doubled : null) : null, declarer: existing.declarer ?? null, leadSuit: existing.open_lead ? normSuit(existing.open_lead.slice(0, 1)) : null, leadRank: existing.open_lead ? existing.open_lead.slice(1) : null, tricks: existing.tricks ?? null, editingId: existing.id || null }
    : { boardNum, level: null, strain: null, doubled: null, declarer: null, leadSuit: null, leadRank: null, tricks: null, editingId: null };
  state.entry = e;
  return e;
}

const leadOf = (e) => (e.leadSuit && e.leadRank ? `${e.leadSuit}${e.leadRank}` : null);

function entryDoneTricks() { return state.entry.level + 6; }
const entryIsBlank = () => !state.entry.level && !state.entry.strain && !state.entry.declarer;
const entryIsComplete = () => !!(state.entry.level && state.entry.strain && state.entry.declarer && state.entry.tricks != null);
function entryPreview() {
  const e = state.entry;
  if (entryIsBlank()) return { nsScore: null, declarerSide: null, down: 0, made: 0 };
  if (!entryIsComplete()) return { nsScore: null, declarerSide: null, down: 0, made: 0 };
  const v = vulnFor(e.boardNum);
  const nsScore = makeScore(e.level, e.strain, e.doubled || 'No', e.tricks, e.declarer, { ns: !!v.vul_ns, ew: !!v.vul_ew });
  return { nsScore, declarerSide: directionSideJS(e.declarer), down: Math.max(0, e.level + 6 - e.tricks), made: Math.max(0, e.tricks - (e.level + 6)) };
}

// live matchpoints for the current in-progress entry versus known results
function refreshEntryMp() {
  if (!state.entry || !state.session) return;
  const e = state.entry;
  if (entryIsBlank() || !entryIsComplete()) { state.entry.mp = null; return; }
  const v = vulnFor(e.boardNum);
  const mine = {
    table_num: 999,
    contract_level: e.level,
    strain: e.strain,
    doubled: e.doubled || 'No',
    declarer: e.declarer,
    tricks: e.tricks,
  };
  const rows = [
    ...state.results.filter((r) => r.board_num === e.boardNum && r.table_num !== state.myTable),
    mine,
  ];
  if (rows.length < 2) { state.entry.mp = null; return; }
  const sb = scoreBoard(rows, { ns: !!v.vul_ns, ew: !!v.vul_ew });
  const mineRow = sb.rows.find((r) => r.table_num === 999);
  if (mineRow) {
    const pts = directionSideJS(e.declarer) === 'EW' ? mineRow.ewPoints : mineRow.points;
    state.entry.mp = { points: pts, top: sb.top };
  } else state.entry.mp = null;
}

/* ---------- render ---------- */
function render() {
  const fn = {
    home: renderHome, create: renderCreate, setup: renderSetup,
    room: renderRoom, entry: renderEntry, standings: renderStandings,
  }[state.screen] || renderHome;
  appEl.innerHTML = '';
  appEl.appendChild(frag(fn()));
  if (state.sheet) appEl.appendChild(frag(renderSheet()));
  requestAnimationFrame(() => {
    document.querySelectorAll('input[autofocus]')?.forEach((i) => i.focus());
  });
}

function renderSheet() {
  const s = state.sheet;
  if (s === 'tables') {
    const opts = Array.from({ length: state.session.num_tables }, (_, i) => i + 1)
      .map((t) => `<div class="chip ${t === state.myTable ? 'on' : ''}" data-action="pin_table" data-t="${t}">Table ${t}</div>`).join('');
    return `
    <div class="sheet-back" data-action="sheet_close"><div class="sheet" data-stop="1">
      <div class="label">Which table is this phone at?</div>
      <div class="chips" style="grid-auto-flow:row;grid-template-columns:repeat(2,1fr)">${opts}</div>
    </div></div>`;
  }
  if (s.done) return renderDoneSheet();
  if (s.detail) return renderDetailSheet();
  if (s === 'reset') return `
    <div class="sheet-back" data-action="sheet_close"><div class="sheet" data-stop="1">
      <h2 class="screen-title" style="margin-bottom:4px">Reset all scores?</h2>
      <div class="muted" style="margin-bottom:16px">This deletes every result entered at all tables. Scores on the board list and live standings will be wiped.</div>
      <button class="btn danger grow" data-action="reset_confirm">Delete all scores</button>
      <button class="btn soft grow" data-action="sheet_close">Cancel</button>
    </div></div>`;
  return '';
}

function renderDoneSheet() {
  const bn = state.sheet.done;
  const onEntry = state.results.find((r) => r.board_num === bn && r.table_num === state.myTable);
  const v = vulnFor(bn);
  const sb = computeBoards()[bn];
  const rows = sb ? sb.rows.slice().sort((a, b) => b.nsScore - a.nsScore) : [];
  const highest = rows[0]?.nsScore;
  return `
    <div class="sheet-back"><div class="sheet">
      <h2 class="screen-title" style="margin-bottom:2px">Board ${bn} — other tables</h2>
      <div class="muted" style="margin-bottom:14px">${esc(vulnerabilityText({ ns: !!v.vul_ns, ew: !!v.vul_ew }))} · ${esc(displayContract(onEntry ? { level: onEntry.contract_level, strain: onEntry.strain, doubled: onEntry.doubled } : null))}</div>
      ${rows.length === 0 ? `<div class="card">No results yet on this board.</div>` : rows.map((r) => {
        const mine = r.table_num === state.myTable;
        const lab = pairAt(r.table_num)[r.declarer ? directionSideJS(r.declarer) : 'ns_pair'] || '';
        const best = r.nsScore === highest;
        return `
        <div class="summary-row${mine ? ' highlight' : ''}">
          <div class="fp" style="width:64px">T${r.table_num}</div>
          <div style="flex:1">
            <div style="font-weight:700">${esc(displayContract({ level: r.contract_level, strain: r.strain, doubled: r.doubled }))}${r.declarer ? ` · ${r.declarer}` : ''}${lab ? ` · <span class="muted">${esc(lab)}</span>` : ''}</div>
            <div class="small muted">${r.contract_level == null ? 'Passed out' : `${r.tricks} tricks`}${best && !mine ? ' · <b>best</b>' : ''}</div>
          </div>
          <div style="font-weight:800;font-size:1.1rem">${fmtScore(r.nsScore)}</div>
          <div class="mp">${r.points}</div>
        </div>`;
      }).join('')}
      <button class="btn grow" data-action="enter_next_board">${bn < state.session.num_boards ? `Enter board ${bn + 1}` : 'Board list'}</button>
      <button class="btn ghost" style="margin-top:10px" data-action="go_room">Done — back to room</button>
    </div></div>`;
}

function renderDetailSheet() {
  const bn = state.sheet.detail;
  const v = vulnFor(bn);
  const sb = computeBoards()[bn];
  const rows = sb ? sb.rows : [];
  return `
    <div class="sheet-back"><div class="sheet">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 class="screen-title">Board ${bn}</h2>
        <button class="btn small soft" data-action="sheet_close_refresh">Close</button>
      </div>
      <div class="muted" style="margin-bottom:12px">Dealer ${v.dealer} · ${esc(vulnerabilityText({ ns: !!v.vul_ns, ew: !!v.vul_ew }))}</div>
      ${rows.length === 0 ? '<div class="card">No results yet on this board.</div>' : `
      ${rows.sort((a, b) => b.points - a.points).map((r) => `
        <div class="board-line ${r.table_num === state.myTable ? 'mine' : ''}">
          <span class="t">T${r.table_num}</span>
          <span class="ct">${r.contract_level == null ? 'Passed out' : esc(displayContract({ level: r.contract_level, strain: r.strain, doubled: r.doubled }))}${r.declarer ? ` · ${r.declarer}` : ''}</span>
          <span class="tk">${r.contract_level == null ? '0 tricks' : `${r.tricks} tricks`}</span>
          <span class="sc ${r.nsScore > 0 ? 'plus' : r.nsScore < 0 ? 'minus' : ''}">${fmtScore(r.nsScore)}</span>
          <span class="mp ${r.points === sb.top ? 'hi' : ''}">${r.points} MP</span>
        </div>`).join('')}`}
    </div></div>`;
}

/* ---------- screens ---------- */
function renderHome() {
  const has = !!state.todaySession;
  const title = state.todaySession?.title || 'today';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const badge = configured ? '' : `<div class="card" style="border-color:var(--gold)"><b>Not connected yet.</b><br><span class="small muted">Put your Supabase URL and key in config.js, then deploy (see README).</span></div>`;
  return `
    <div class="screen">
      <div class="hero">
        <span class="glyph">♣</span>
        <h1>Flinders Social Bridge</h1>
        <p>${today} · duplicate today made easy</p>
      </div>
      ${badge}

      <button class="btn" style="margin-bottom:14px;min-height:84px;font-size:1.4rem" data-action="join_today" ${has ? '' : 'disabled'}>
        ${has ? `Join today's session` : 'No session set up yet'}
      </button>
      ${has ? `<p class="small muted" style="text-align:center;margin-bottom:18px">${esc(title)} is ready — tap to join and pick your table.</p>`
        : `<p class="small muted" style="text-align:center;margin-bottom:18px">The organiser sets one up below before scoring begins.</p>`}

      <div class="small" style="text-align:center">
        <button class="btn small ghost" data-action="go_create" style="width:auto;margin:0 auto">Set up session</button>
        <div class="small muted" style="margin-top:6px">For the organiser — tables, boards &amp; pairs</div>
      </div>
    </div>`;
}

function renderCreate() {
  const d = state.draft;
  return `
    <div class="screen">
      <div class="topbar"><button class="back" data-action="go_home">‹</button></div>
      <h2 class="screen-title">New session</h2>
      <p class="screen-sub">How many tables and boards?</p>

      <span class="label">Tables</span>
      <div class="stepper">
        <button class="step-btn" data-action="create_tables" data-d="-1">−</button>
        <div><span class="step-val">${d.tables}</span><span class="step-lab">tables</span></div>
        <button class="step-btn" data-action="create_tables" data-d="1">+</button>
      </div>

      <span class="label">Boards</span>
      <div class="stepper" style="margin-bottom:8px">
        <button class="step-btn" data-action="create_boards" data-d="-1">−</button>
        <div><span class="step-val">${d.boards}</span><span class="step-lab">boards</span></div>
        <button class="step-btn" data-action="create_boards" data-d="1">+</button>
      </div>
      <div class="small muted" style="text-align:center">Vulnerability comes automatically from board numbers — <br>easy to adjust next.</div>

      <button class="btn grow" data-action="create_go">Create room</button>
    </div>`;
}

function renderSetup() {
  const d = state.draft;
  const pairRows = Array.from({ length: state.session.num_tables }, (_, i) => i + 1).map((t) => {
    const p = d.pairs[t] || { ns: pairAt(t).ns_pair, ew: pairAt(t).ew_pair };
    return `
      <div class="pair-cell">
        <div>
          <span class="tag">Table ${t} — N/S</span>
          <input class="field" data-action="pair_input" data-t="${t}" data-side="ns" value="${esc(p.ns)}" placeholder="Pair or names" />
        </div>
        <div>
          <span class="tag">Table ${t} — E/W</span>
          <input class="field" data-action="pair_input" data-t="${t}" data-side="ew" value="${esc(p.ew)}" placeholder="Pair or names" />
        </div>
      </div>`;
  }).join('');

  const vulnCells = Array.from({ length: state.session.num_boards }, (_, i) => {
    const n = i + 1;
    const v = d.vuln[n] || { ns: boardInfo(n).ns, ew: boardInfo(n).ew };
    const st = vulnerabilityText({ ns: v.ns, ew: v.ew });
    return `
      <button class="vuln-cell" data-action="vuln_toggle" data-bn="${n}">
        <span class="chip ${(v.ns || v.ew) ? 'on' : ''}">
          <span class="bn">${n}</span>
          <span class="st">${esc(st)}</span>
        </span>
      </button>`;
  });
  const split = Math.ceil(vulnCells.length / 2);
  const [vulOpen, vulFixed] = [vulnCells.slice(0, split).join(''), vulnCells.slice(split).join('')];

  return `
    <div class="screen">
      <div class="topbar"><button class="back" data-action="go_room">‹</button><div style="flex:1">
        <div style="font-weight:800;font-size:1.1rem">${esc(state.session.title || 'Session')}</div>
        <div class="small muted">Room ${esc(state.session.code)}</div>
      </div></div>

      <div class="label">Vulnerability — tap to change</div>
      <p class="small muted" style="margin-top:-6px">Already set correctly from the board numbers. Tap any board to change.</p>
      <div class="vuln-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:22px">${vulOpen}</div>
      <div class="vuln-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:22px">${vulFixed}</div>

      <div class="label">Pairs at each table (optional)</div>
      <div class="pair-grid">${pairRows}</div>

      <button class="btn grow" data-action="save_setup">Save &amp; go to room</button>
    </div>`;
}

function renderRoom() {
  const sess = state.session;
  if (!sess) return renderHome();
  const byBoard = computeBoards();
  const items = Array.from({ length: sess.num_boards }, (_, i) => {
    const n = i + 1;
    const r = state.results.find((x) => x.board_num === n && x.table_num === state.myTable);
    const sb = byBoard[n];
    return `
      <button class="board-item ${r ? 'done' : ''}" data-action="open_board" data-bn="${n}">
        <span class="num">${n}</span>
        <span class="meta">
          ${r
            ? `<span style="font-weight:700">${esc(displayContract({ level: r.contract_level, strain: r.strain, doubled: r.doubled }))}</span>` +
              (r.declarer ? ` · ${r.declarer}` : '') +
              `<span class="tiny">${r.contract_level == null ? 'Passed out' : `${r.tricks} tricks`}${sb ? ` · ${sb.rows.find((x) => x.table_num === state.myTable)?.points}/${sb.top} MP` : ''}</span>`
            : 'Tap to enter score'}
        </span>
        <span class="result">${r ? fmtScore(r.score) : '→'}</span>
      </button>`;
  }).join('');

  return `
    <div class="screen">
      <div class="topbar">
        <button class="back" data-action="go_home">‹</button>
        <div style="flex:1">
          <div style="font-weight:800;font-size:1.1rem">${esc(sess.title || 'Session')}</div>
        </div>
      </div>

      <div class="card flush" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;margin-bottom:16px">
        <div class="small muted" style="font-weight:800;font-size:1.15rem;white-space:nowrap">Table ${state.myTable}</div>
        <button class="btn small ghost" data-action="open_tables" style="width:auto;padding:5px 10px;font-size:0.8rem;min-height:0">Change table</button>
      </div>

      <button class="btn soft grow" style="margin-bottom:16px" data-action="go_standings">Live results &amp; standings</button>

      <div class="small" style="text-align:center;margin-bottom:16px">
        <button class="btn small ghost" data-action="open_reset" style="width:auto;margin:0 auto;color:var(--danger);border-color:var(--danger)">Reset scores</button>
      </div>

      <div class="label">Boards</div>
      ${items}
    </div>`;
}

function nextBoardFor(tableNum, byBoard) {
  for (let n = 1; n <= state.session.num_boards; n++) {
    const has = state.results.some((r) => r.board_num === n && r.table_num === tableNum);
    if (!has) return n;
  }
  return 1;
}

function renderEntry() {
  const e = state.entry;
  const birth = vulnFor(e.boardNum);
  const p = entryPreview();
  const blank = entryIsBlank();
  const showMp = e.mp;
  const leadTxt = e.leadSuit && e.leadRank ? `${strainGlyph(e.leadSuit)}${e.leadRank}` : null;

  const levels = [];
  for (let l = 1; l <= 7; l++) {
    levels.push(`<button class="chip ${e.level === l ? 'on' : ''}" data-action="ent_level" data-l="${l}">${l}</button>`);
  }
  const strainBtns = suits.map((s) => {
    const on = s === e.strain;
    const glyph = strainGlyph(s);
    const style = on ? '' : ` style="color:${SUIT_COLORS[s]}"`;
    return `<button class="chip suits-btn ${on ? 'on' : ''}"${style} data-action="ent_strain" data-s="${s}">${glyph}</button>`;
  }).join('');
  const doubleBtns = ['No', 'X', 'XX'].map((d) =>
    `<button class="chip ${e.doubled === d ? 'on' : ''}" data-action="ent_double" data-d="${d}">${d === 'No' ? 'Undoubled' : d}</button>`).join('');
  const dirBtns = ['N', 'E', 'S', 'W'].map((di) =>
    `<button class="chip ${e.declarer === di ? 'on' : ''}" data-action="ent_declarer" data-d="${di}">${di}</button>`).join('');

  const leadSuits = ['C', 'D', 'H', 'S'].map((s) => {
    const glyph = strainGlyph(s);
    return `<button class="chip ${e.leadSuit === s ? 'on' : ''}" style="color:${SUIT_COLORS[s]}" data-action="ent_lead_suit" data-s="${s}">${glyph}</button>`;
  }).join('');
  const leadRanks = RANKS.map((rk) =>
    `<button class="chip ${e.leadRank === rk ? 'on' : ''}" data-action="ent_lead_rank" data-r="${rk}">${rk}</button>`).join('');

  const sideLab = p.declarerSide ? (p.nsScore != null && p.nsScore >= 0 ? 'N/S' : 'E/W') : '';
  const dealerBtns = ['N', 'E', 'S', 'W'].map((d) =>
    `<button class="chip ${birth.dealer === d ? 'on' : ''}" data-action="ent_dealer" data-d="${d}">${d}</button>`).join('');
  const vulnBtns = [
    { ns: false, ew: false, label: 'Neither' },
    { ns: true, ew: false, label: 'NS' },
    { ns: false, ew: true, label: 'EW' },
    { ns: true, ew: true, label: 'Both' },
  ].map((o) => {
    const on = !!birth.vul_ns === o.ns && !!birth.vul_ew === o.ew;
    return `<button class="chip ${on ? 'on' : ''}" data-action="ent_vuln" data-ns="${o.ns}" data-ew="${o.ew}">${o.label}</button>`;
  }).join('');

  return `
    <div class="screen">
      <div class="topbar">
        <button class="back" data-action="leave_entry">‹</button>
        <div style="flex:1">
          <div style="font-weight:800;font-size:1.05rem">Table ${state.myTable} · Board ${e.boardNum}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn small soft" data-action="ent_prev_board" style="min-height:36px;width:auto;padding:4px 12px">‹</button>
          <button class="btn small soft" data-action="ent_next_board2" style="min-height:36px;width:auto;padding:4px 12px">›</button>
        </div>
      </div>

      <div class="entry-block" style="margin-bottom:14px">
        <div class="label" style="margin-top:0">Dealer</div>
        <div class="chips">${dealerBtns}</div>
        <div class="label">Vulnerability</div>
        <div class="chips">${vulnBtns}</div>
      </div>

      <div class="entry-block">
        <div class="label" style="margin-top:0">Contract level</div>
        <div class="chips" style="grid-auto-flow:column;grid-auto-columns:1fr">${levels}</div>
        <div class="label">Suit</div>
        <div class="chips strains">${strainBtns}</div>
        ${e.level ? `
          <div class="label">Doubled?</div>
          <div class="chips">${doubleBtns}</div>
          <div class="label">Who declared?</div>
          <div class="dir-grid">${dirBtns}</div>` : ''}
      </div>

      <div class="entry-block">
        <div class="label" style="margin-top:0">Opening lead</div>
        <div class="lead-pick">
          <div class="ranks">${leadRanks}</div>
          <div class="suits" style="margin-top:8px">${leadSuits}</div>
        </div>
        ${leadTxt ? `<div class="small" style="margin-top:8px;text-align:center">Leading: <b style="color:${SUIT_COLORS[e.leadSuit]};font-size:1.2rem">${leadTxt}</b> <button class="btn small soft" data-action="ent_clear_lead" style="width:auto;padding:4px 10px">clear</button></div>` : '<div class="small muted" style="margin-top:8px;text-align:center">Skip if you prefer</div>'}
      </div>

      <div class="entry-section">
        <span class="label">Tricks won</span>
        <div class="stepper">
          <button class="step-btn" data-action="ent_tricks" data-d="-1">−</button>
          <div><span class="step-val">${e.tricks == null ? '—' : e.tricks}</span><span class="step-lab">of 13</span></div>
          <button class="step-btn" data-action="ent_tricks" data-d="1">+</button>
        </div>
        <div class="tricks-note muted">${e.tricks == null ? '' : noteForEntry(e)}</div>
        ${blank ? '<div class="small muted" style="text-align:center;margin-top:6px">Leave everything blank if the hand was passed out.</div>' : ''}
      </div>

      <div class="score-preview">
        <div>
          <div class="who">${sideLab ? `${sideLab} score` : 'Score'}</div>
          ${showMp ? `<div class="small" style="opacity:0.85">${showMp.points} of ${showMp.top} matchpoints</div>` : ''}
        </div>
        <div class="amt">${p.nsScore == null ? (blank ? '0' : '') : fmtScore(p.nsScore)}</div>
      </div>

      <button class="btn grow" data-action="ent_save" style="min-height:64px;font-size:1.25rem">Save result</button>
      ${e.editingId ? `<button class="btn danger" style="margin-top:10px" data-action="delete_result">Delete this result</button>` : ''}
    </div>`;
}

function noteForEntry(e) {
  const d = entryDoneTricks();
  if (e.tricks === d) return 'Contract made';
  if (e.tricks > d) return `${e.tricks - d} overtrick${e.tricks - d > 1 ? 's' : ''}`;
  return `${d - e.tricks} down`;
}

function renderStandings() {
  const sb = computeStandings();
  const t = state.standingsTab;
  const rank = sb.map((s, i) => ({ ...s, rank: i + 1 }));
  let boardsTabs = '';
  const bInfo = computeBoards();
  let boardsBody = '';
  if (t === 'boards') {
    const bn = state.standingsBoard || (state.results.length ? state.results[state.results.length - 1].board_num : 1);
    state.standingsBoard = bn;
    boardsTabs = Array.from({ length: state.session.num_boards }, (_, i) => {
      const n = i + 1;
      return `<button class="chip ${n === bn ? 'on' : ''}" data-action="sb_board" data-bn="${n}">${n}</button>`;
    }).join('');
    const v = vulnFor(bn);
    const info = bInfo[bn];
    const rows = info ? info.rows.slice().sort((a, b) => b.points - a.points) : [];
    boardsBody = `
      <div class="small muted" style="margin:-6px 0 10px">Dealer ${v.dealer} · ${esc(vulnerabilityText({ ns: !!v.vul_ns, ew: !!v.vul_ew }))}</div>
      ${rows.length ? rows.map((r) => `
        <div class="board-line ${r.table_num === state.myTable ? 'mine' : ''}">
          <span class="t">T${r.table_num}</span>
          <span class="ct">${r.contract_level == null ? 'Passed out' : esc(displayContract({ level: r.contract_level, strain: r.strain, doubled: r.doubled }))}</span>
          <span class="tk">${r.contract_level == null ? '0 tricks' : `${r.tricks} tricks`}</span>
          <span class="sc ${r.nsScore > 0 ? 'plus' : r.nsScore < 0 ? 'minus' : ''}">${fmtScore(r.nsScore)}</span>
          <span class="mp ${r.points === info.top ? 'hi' : ''}">${r.points} MP</span>
        </div>`).join('') : '<div class="card">No results on this board yet.</div>'}`;
  }

  return `
    <div class="screen">
      <div class="topbar">
        <button class="back" data-action="go_room">‹</button>
        <div style="flex:1">
          <div style="font-weight:800;font-size:1.1rem">Live results</div>
          <div class="small muted" style="display:flex;align-items:center;gap:6px"><span class="tick" style="font-size:0.7rem">●</span> updating live</div>
        </div>
      </div>

      <div class="tabs">
        <button class="chip ${t === 'standings' ? 'on' : ''}" data-action="sb_tab" data-t="standings">Standings</button>
        <button class="chip ${t === 'boards' ? 'on' : ''}" data-action="sb_tab" data-t="boards">By board</button>
      </div>

      ${t === 'standings' ? `
        ${rank.length ? rank.map((s) => `
          <div class="rank-row ${s.rank === 1 ? 'first' : ''}">
            <span class="place">${s.rank}</span>
            <span class="who">${esc(s.label)}<span class="small muted" style="display:block;font-weight:400">${s.played} board${s.played === 1 ? '' : 's'} · total ${fmtScore(s.score)}</span></span>
            <span class="pts"><span class="big">${s.points}</span> <span class="pct">· ${s.pct}%</span></span>
          </div>`).join('')
        : '<div class="card">No results yet. Scores appear here live as tables enter them.</div>'}
      ` : `
        <div class="chips" style="grid-auto-flow:column;overflow-x:auto;padding-bottom:4px;justify-content:start;gap:6px">${boardsTabs}</div>
        ${boardsBody}
      `}
      <div class="small muted" style="text-align:center;margin-top:22px">Passed-out boards count as zero for both pairs.</div>
    </div>`;
}

/* ---------- action dispatch ---------- */
const actions = {
  go_home() { closeSheets(); state.screen = 'home'; render(); refreshToday(); },
  join_today() { closeSheets(); busy(async () => {
    state.todaySession = state.todaySession || await todaySession();
    if (!state.todaySession) return toast('No session has been set up yet');
    await loadSession(state.todaySession);
    enterRoom();
  }, 'Joining…'); },
  go_create() { closeSheets(); busy(async () => {
    state.todaySession = await todaySession();
    if (state.todaySession) {
      await loadSession(state.todaySession);
      updateDraftFromSession();
      state.screen = 'setup'; render();
    } else {
      state.draft.tables = 6; state.draft.boards = 24; state.screen = 'create'; render();
    }
  }, 'Opening…'); },
  sheet_close() { closeSheets(); render(); },
  sheet_close_refresh() { closeSheets(); render(); },
  open_reset() { state.sheet = 'reset'; render(); },
  reset_confirm() { closeSheets(); busy(async () => {
    await resetResults();
    toast('All scores deleted');
  }, 'Resetting…'); },

  create_tables(el) { state.draft.tables = Math.min(6, Math.max(1, state.draft.tables + +el.dataset.d)); render(); },
  create_boards(el) { state.draft.boards = Math.min(24, Math.max(1, state.draft.boards + +el.dataset.d)); render(); },
  create_go() { busy(async () => {
    const s = await createSession(state.draft.tables, state.draft.boards, null);
    await loadSession(s);
    updateDraftFromSession();
    state.screen = 'setup'; render();
  }, 'Creating room…'); },
  pair_input(el) {
    const t = el.dataset.t, side = el.dataset.side;
    (state.draft.pairs[t] ||= {}); state.draft.pairs[t][side] = el.value;
  },
  vuln_toggle(el) {
    const bn = +el.dataset.bn;
    const cur = state.draft.vuln[bn] || { ns: boardInfo(bn).ns, ew: boardInfo(bn).ew };
    if (!cur.ns && !cur.ew) cur.ns = true;
    else if (cur.ns && !cur.ew) { cur.ns = false; cur.ew = true; }
    else if (!cur.ns && cur.ew) { cur.ns = true; cur.ew = true; }
    else { cur.ns = false; cur.ew = false; }
    state.draft.vuln[bn] = cur;
    render();
  },
  save_setup() { busy(async () => { await saveSetup(); updateDraftFromSession(); enterRoom(); }, 'Saving…'); },

  open_tables() { state.sheet = 'tables'; render(); },
  pin_table(el) {
    const t = +el.dataset.t;
    state.myTable = t; ls.setPin(state.session.code, String(t));
    closeSheets(); enterRoom();
  },
  open_entry_next() {
    if (!state.myTable) { state.sheet = 'tables'; render(); return; }
    const bn = nextBoardFor(state.myTable, computeBoards());
    newEntry(bn, state.results.find((r) => r.board_num === bn && r.table_num === state.myTable));
    state.screen = 'entry'; render();
  },
  open_board(el) {
    if (!state.myTable) { state.sheet = 'tables'; render(); return; }
    const bn = +el.dataset.bn;
    newEntry(bn, state.results.find((r) => r.board_num === bn && r.table_num === state.myTable));
    state.screen = 'entry'; render();
  },
  ent_prev_board() {
    if (state.entry.boardNum > 1) { state.entry.boardNum--; refreshEntryMp(); render(); }
  },
  ent_next_board2() {
    if (state.entry.boardNum < state.session.num_boards) { state.entry.boardNum++; refreshEntryMp(); render(); }
  },
  leave_entry() { enterRoom(); },

  ent_level(el) { const l = +el.dataset.l; state.entry.level = l; if (state.entry.tricks == null) state.entry.tricks = entryDoneTricks(); refreshEntryMp(); render(); },
  ent_strain(el) { state.entry.strain = el.dataset.s; refreshEntryMp(); render(); },
  ent_double(el) { state.entry.doubled = el.dataset.d; refreshEntryMp(); render(); },
  ent_declarer(el) { state.entry.declarer = el.dataset.d; refreshEntryMp(); render(); },
  ent_lead_suit(el) { state.entry.leadSuit = (state.entry.leadSuit === el.dataset.s) ? null : el.dataset.s; render(); },
  ent_lead_rank(el) { state.entry.leadRank = (state.entry.leadRank === el.dataset.r) ? null : el.dataset.r; render(); },
  ent_clear_lead() { state.entry.leadSuit = null; state.entry.leadRank = null; render(); },
  ent_dealer(el) {
    const bn = state.entry.boardNum;
    const b = state.boards.find((x) => x.board_num === bn);
    if (b) b.dealer = el.dataset.d; else state.boards.push({ session_id: state.session.code, board_num: bn, dealer: el.dataset.d, vul_ns: boardInfo(bn).ns, vul_ew: boardInfo(bn).ew });
    busy(async () => { await saveBoard(bn); }, 'Saving…');
  },
  ent_vuln(el) {
    const bn = state.entry.boardNum;
    const b = state.boards.find((x) => x.board_num === bn);
    const cur = b || { session_id: state.session.code, board_num: bn, dealer: boardInfo(bn).dealer, vul_ns: boardInfo(bn).ns, vul_ew: boardInfo(bn).ew };
    cur.vul_ns = el.dataset.ns === 'true';
    cur.vul_ew = el.dataset.ew === 'true';
    if (!b) state.boards.push(cur);
    busy(async () => { await saveBoard(bn); }, 'Saving…');
  },
  ent_tricks(el) {
    let t = (state.entry.tricks ?? entryDoneTricks()) + +el.dataset.d;
    t = Math.min(13, Math.max(0, t));
    state.entry.tricks = t; refreshEntryMp(); render();
  },
  ent_save() {
    const e = state.entry;
    if (!state.myTable) { state.sheet = 'tables'; render(); return; }
    if (!entryIsBlank() && (!e.strain || !e.declarer)) {
      toast('Choose the contract and who declared first');
      return;
    }
    busy(async () => {
      const bn = e.boardNum;
      e.lead = leadOf(e);
      await upsertResult();
      await loadSession(state.session);
      state.sheet = { done: bn };
      enterRoom();
    }, 'Saving…');
  },
  delete_result() {
    busy(async () => {
      const bn = state.entry.boardNum;
      await deleteResult(bn);
      toast('Result deleted');
      enterRoom();
    }, 'Deleting…');
  },
  enter_next_board() {
    if (state.sheet.done >= state.session.num_boards) {
      state.sheet = null; enterRoom();
      return;
    }
    const bn = state.sheet.done + 1;
    if (!state.myTable) { state.sheet = 'tables'; render(); return; }
    newEntry(bn, state.results.find((r) => r.board_num === bn && r.table_num === state.myTable));
    state.sheet = null; state.screen = 'entry'; render();
  },

  go_room() { closeSheets(); enterRoom(); },
  go_standings() { closeSheets(); state.screen = 'standings'; state.standingsTab = 'standings'; render(); },
  sb_tab(el) { state.standingsTab = el.dataset.t; render(); },
  sb_board(el) { state.standingsBoard = +el.dataset.bn; render(); },
};

function enterRoom() {
  state.screen = 'room';
  if (!state.myTable && state.session && state.session.num_tables > 1) state.sheet = 'tables';
  render();
}
function closeSheets() { state.sheet = null; }
function updateDraftFromSession() {
  state.draft.pairs = {};
  state.draft.vuln = {};
}

/* ---------- busy / toasts ---------- */
async function busy(fn, msg) {
  const prev = [...document.querySelectorAll('button')];
  prev.forEach((b) => (b.disabled = true));
  try { await fn(); } catch (err) {
    console.error(err);
    toast(`Something went wrong: ${err.message}`);
  } finally { prev.forEach((b) => (b.disabled = false)); }
}

/* ---------- global listeners ---------- */
appEl.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = actions[el.dataset.action];
  if (a) a(el, ev);
});
appEl.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = actions[el.dataset.action];
  if (typeof a === 'function' && a.length >= 1) a(el, ev);
});
document.addEventListener('click', (ev) => {
  // close sheets by tapping backdrop
  if (ev.target.matches('.sheet-back') && !state.sheet?.done && !state.sheet?.detail &&
      !ev.target.closest('[data-stop]')) {
    closeSheets(); render();
  }
});

/* ---------- boot ---------- */
async function refreshToday() {
  if (!configured) return;
  try { state.todaySession = await todaySession(); } catch (e) { state.todaySession = null; }
  if (state.screen === 'home') render();
}

(async function boot() {
  if (!configured) { render(); return; }
  await refreshToday();
  render();
  // Poll so players' "Join" button appears once the organiser has set up.
  setInterval(() => { if (state.screen === 'home') refreshToday(); }, 15000);
})();