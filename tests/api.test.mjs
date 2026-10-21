// End-to-end tests of the /api functions against an in-memory stand-in for
// Supabase (no network, no real data touched).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret';
process.env.SUPABASE_URL = 'https://fake.supabase.test';
process.env.ADMIN_CODE = 'Boss';

// ---------- fake PostgREST ----------
const T = { chi_events: [], chi_sessions: [], chi_deals: [], chi_hidden_names: [], chi_added_names: [], chi_settings: [], chi_name_fixes: [] };
let clock = Date.parse('2026-10-12T10:00:00Z');
const now = () => new Date((clock += 1000)).toISOString();
const UNIQUE = { chi_events: ['play_date', 'name'], chi_sessions: ['client_token'], chi_deals: ['session_id', 'deal_no'], chi_hidden_names: ['name_key'], chi_added_names: ['name_key'], chi_settings: ['key'], chi_name_fixes: ['from_key'] };

function parse(url) {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const filters = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    filters.push([k, decodeURIComponent(v.replace(/^eq\./, ''))]);
  }
  return { table, filters, select: u.searchParams.get('select') || '' };
}
const match = (row, filters) => filters.every(([k, v]) => String(row[k]) === v);
const embed = (table, select, r) => (table === 'chi_sessions' && select.includes('chi_deals')
  ? { ...r, chi_deals: T.chi_deals.filter((d) => d.session_id === r.id) } : r);

globalThis.fetch = async (url, opts = {}) => {
  const { table, filters, select } = parse(url);
  const prefer = opts.headers?.Prefer || '';
  const body = opts.body ? JSON.parse(opts.body) : null;
  let out;
  if (!opts.method || opts.method === 'GET') {
    out = T[table].filter((r) => match(r, filters)).map((r) => embed(table, select, r));
  } else if (opts.method === 'POST') {
    const keys = UNIQUE[table];
    const dup = T[table].find((r) => keys.every((k) => body[k] != null && r[k] === body[k]));
    if (dup) out = prefer.includes('ignore-duplicates') ? [] : [dup];
    else {
      const row = { id: crypto.randomUUID(), created_at: now(), updated_at: now(), doubled: '', ...body };
      T[table].push(row);
      out = [embed(table, select, row)];
    }
  } else if (opts.method === 'DELETE') {
    out = T[table].filter((r) => match(r, filters));
    T[table] = T[table].filter((r) => !match(r, filters));
    if (table === 'chi_sessions') { const ids = new Set(out.map((r) => r.id)); T.chi_deals = T.chi_deals.filter((d) => !ids.has(d.session_id)); }
  } else if (opts.method === 'PATCH') {
    out = T[table].filter((r) => match(r, filters));
    out.forEach((r) => Object.assign(r, body, { updated_at: now() }));
    out = out.map((r) => embed(table, select, r));
  }
  return new Response(JSON.stringify(out), { status: 200 });
};

// ---------- tiny request/response doubles ----------
let cookie = '';
async function call(mod, method, body, query = '') {
  const req = { method, url: '/api/x' + query, headers: { cookie }, body };
  const res = {
    statusCode: 200, headers: {}, out: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.out = s; },
  };
  await mod.default(req, res);
  if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].split(';')[0];
  return { status: res.statusCode, body: JSON.parse(res.out) };
}

let login, sessions, deal, admin;
before(async () => {
  login = await import('../api/login.js');
  admin = await import('../api/admin.js');
  sessions = await import('../api/sessions.js');
  deal = await import('../api/deal.js');
});

const newTable = {
  location: 'Clubhouse, table 1', startBoard: 12, firstDealer: 'N',
  nsP1: 'Jon', nsP2: 'Mary', ewP1: 'Ann', ewP2: 'Bob', clientToken: crypto.randomUUID(),
};
let sid;

test('nothing works without the access code', async () => {
  assert.equal((await call(sessions, 'GET')).status, 401);
  assert.equal((await call(login, 'POST', { code: 'chess' })).status, 401);
  assert.equal((await call(login, 'GET')).body.ok, false);
});

test('correct code (any case) lets the phone in', async () => {
  assert.equal((await call(login, 'POST', { code: ' Golf ' })).status, 200);
  assert.equal((await call(login, 'GET')).body.ok, true);
});

test('a tampered cookie is rejected', async () => {
  const good = cookie;
  cookie = good.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await call(sessions, 'GET')).status, 401);
  cookie = good;
});

test('start a session; a double tap does not create a second one', async () => {
  const a = await call(sessions, 'POST', newTable);
  assert.equal(a.status, 201);
  sid = a.body.session.id;
  const b = await call(sessions, 'POST', newTable);
  assert.equal(b.body.session.id, sid);
  assert.equal(T.chi_sessions.length, 1);
});

test('missing names are refused', async () => {
  const r = await call(sessions, 'POST', { ...newTable, ewP2: ' ', clientToken: crypto.randomUUID() });
  assert.equal(r.status, 400);
});

test('save four boards; scores are calculated on the server', async () => {
  const deals = [
    { dealNo: 1, level: 2, strain: 'H', declarer: 'N', tricks: 9, leadSuit: 'S', leadRank: 'K', nsScore: 99999 },
    { dealNo: 2, level: 2, strain: 'S', declarer: 'E', tricks: 8 },
    { dealNo: 3, level: 2, strain: 'C', declarer: 'S', tricks: 8 },
    { dealNo: 4, level: 3, strain: 'D', declarer: 'E', tricks: 10 },
  ];
  const got = [];
  for (const d of deals) {
    const r = await call(deal, 'PUT', { sessionId: sid, ...d });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    got.push(r.body.deal);
  }
  assert.deepEqual(got.map((d) => d.nsScore), [140, -110, 90, -130]);   // phone's 99999 ignored
  assert.deepEqual(got.map((d) => d.boardNum), [12, 13, 14, 15]);
});

test('a second phone saving the same board is told, not allowed to overwrite', async () => {
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 1, level: 4, strain: 'S', declarer: 'N', tricks: 10 });
  assert.equal(r.status, 409);
  assert.equal(r.body.current.level, 2);
});

test('a correction updates the same record (no duplicate)', async () => {
  const cur = T.chi_deals.find((d) => d.session_id === sid && d.deal_no === 1);
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 1, level: 3, strain: 'NT', declarer: 'N', tricks: 9, expectedUpdatedAt: cur.updated_at });
  assert.equal(r.status, 200);
  assert.equal(r.body.deal.nsScore, 600);   // deal 1: N/S vulnerable
  assert.equal(T.chi_deals.filter((d) => d.session_id === sid && d.deal_no === 1).length, 1);
});

test('a correction based on an out-of-date copy is refused', async () => {
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 1, level: 1, strain: 'C', declarer: 'N', tricks: 7, expectedUpdatedAt: '2000-01-01T00:00:00Z' });
  assert.equal(r.status, 409);
});

test('passed-out board stores no contract and scores 0', async () => {
  const cur = T.chi_deals.find((d) => d.session_id === sid && d.deal_no === 3);
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 3, passedOut: true, level: 5, expectedUpdatedAt: cur.updated_at });
  assert.equal(r.status, 200);
  assert.equal(r.body.deal.nsScore, 0);
  assert.equal(r.body.deal.level, null);
});

test('invalid entries are refused', async () => {
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 2, level: 9, strain: 'S', declarer: 'N', tricks: 9 });
  assert.equal(r.status, 400);
});

test('vulnerability is locked by default: choices sent by a phone are ignored', async () => {
  const cur = T.chi_deals.find((d) => d.session_id === sid && d.deal_no === 2);
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 2, level: 2, strain: 'S', declarer: 'E', tricks: 9, vulNs: true, vulEw: true, expectedUpdatedAt: cur.updated_at });
  assert.equal(r.status, 200);
  assert.equal(r.body.deal.vulNs, cur.vul_ns);           // kept what the board had
  assert.equal(r.body.deal.vulEw, cur.vul_ew);
  assert.equal((await call(sessions, 'GET')).body.settings.vulLocked, true);
  // organiser unlocks for the next test
  await call(login, 'POST', { code: 'Boss' });
  assert.equal((await call(admin, 'POST', { action: 'setVulLock', locked: false })).status, 200);
  assert.equal((await call(sessions, 'GET')).body.settings.vulLocked, false);
  await call(login, 'POST', { code: 'golf' });   // back to an ordinary player
});

test('vulnerability chosen on the scoring screen is used and stored', async () => {
  const cur = T.chi_deals.find((d) => d.session_id === sid && d.deal_no === 2);
  const r = await call(deal, 'PUT', { sessionId: sid, dealNo: 2, level: 2, strain: 'S', declarer: 'E', tricks: 9, vulNs: false, vulEw: true, expectedUpdatedAt: cur.updated_at });
  assert.equal(r.status, 200);
  assert.equal(r.body.deal.nsScore, -140);   // 2S+1 by E/W: vulnerability doesn't change an undoubled overtrick
  assert.equal(r.body.deal.vulEw, true);
  const cur2 = T.chi_deals.find((d) => d.session_id === sid && d.deal_no === 2);
  const r2 = await call(deal, 'PUT', { sessionId: sid, dealNo: 2, level: 2, strain: 'S', declarer: 'E', tricks: 7, vulNs: false, vulEw: true, expectedUpdatedAt: cur2.updated_at });
  assert.equal(r2.body.deal.nsScore, 100);   // one down vulnerable → N/S get 100
});

test('a second game can record the same board independently', async () => {
  const s2 = await call(sessions, 'POST', { ...newTable, location: 'Table 2', nsP1: 'Cath', nsP2: 'Dave', ewP1: 'Eve', ewP2: 'Fay', clientToken: crypto.randomUUID() });
  const r = await call(deal, 'PUT', { sessionId: s2.body.session.id, dealNo: 1, level: 4, strain: 'H', declarer: 'S', tricks: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.deal.boardNum, 12);
  const day = await call(sessions, 'GET');
  const plays = day.body.sessions.flatMap((s) => s.deals).filter((d) => d.boardNum === 12);
  assert.equal(plays.length, 2);
});

test('board numbers can change after play (saved boards move); dealer cannot', async () => {
  const was = T.chi_sessions.find((x) => x.id === sid).start_board;
  const r = await call(sessions, 'PATCH', { id: sid, startBoard: 20 });
  assert.equal(r.status, 200);
  assert.equal(r.body.session.startBoard, 20);
  const nums = T.chi_deals.filter((d) => d.session_id === sid).map((d) => [d.deal_no, d.board_num]);
  assert.ok(nums.length > 0 && nums.every(([n, b]) => b === 19 + n));
  assert.ok(r.body.session.deals.every((d) => d.boardNum === 19 + d.dealNo));
  await call(sessions, 'PATCH', { id: sid, startBoard: was });   // put it back for later tests
  const d = await call(sessions, 'PATCH', { id: sid, firstDealer: 'W' });
  assert.equal(d.status, 409);
  const ok = await call(sessions, 'PATCH', { id: sid, nsP2: 'Margaret' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.nsP2, 'Margaret');
  assert.equal(ok.body.session.location, 'Jon & Margaret v Ann & Bob');
});

test('players cannot use organiser actions', async () => {
  const r = await call(admin, 'POST', { action: 'clearSession', eventId: crypto.randomUUID() });
  assert.equal(r.status, 403);
});

test('organiser code logs in as organiser (any case)', async () => {
  const r = await call(login, 'POST', { code: ' boss ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.admin, true);
  assert.equal((await call(login, 'GET')).body.admin, true);
});

test('organiser can delete one game, and its boards go with it', async () => {
  const before = T.chi_sessions.length;
  const r = await call(admin, 'POST', { action: 'deleteGame', id: sid });
  assert.equal(r.status, 200);
  assert.equal(T.chi_sessions.length, before - 1);
  assert.equal(T.chi_deals.filter((d) => d.session_id === sid).length, 0);
});

test('organiser can start a new session: tables start empty, old session kept', async () => {
  const before = await call(sessions, 'GET');
  const oldId = before.body.event.id;
  assert.ok(before.body.sessions.length >= 1);
  const r = await call(admin, 'POST', { action: 'newSession' });
  assert.equal(r.status, 201);
  const now = await call(sessions, 'GET');
  assert.equal(now.body.event.id, r.body.event.id);       // phones follow the newest session
  assert.equal(now.body.sessions.length, 0);              // all tables start empty
  assert.ok(now.body.names.includes('Cath') && now.body.names.includes('Fay')); // earlier names still suggested
  assert.equal(now.body.events.length, 2);                // both sessions offered in the list
  const old = await call(sessions, 'GET', null, `?event=${oldId}`);
  assert.equal(old.body.event.id, oldId);                 // earlier session can still be chosen
  assert.ok(old.body.sessions.length >= 1);
  // a table can be set up in the chosen (older) session
  const t = await call(sessions, 'POST', { ...newTable, eventId: oldId, clientToken: crypto.randomUUID() });
  assert.equal(t.status, 201);
  assert.equal((await call(sessions, 'GET', null, `?event=${oldId}`)).body.sessions.length, old.body.sessions.length + 1);
  // with no session chosen, a new table goes into the newest session
  await call(sessions, 'POST', { ...newTable, clientToken: crypto.randomUUID() });
  assert.equal((await call(sessions, 'GET')).body.sessions.length, 1);
});

test('organiser can clear every table in a session', async () => {
  const day = await call(sessions, 'GET');
  const r = await call(admin, 'POST', { action: 'clearSession', eventId: day.body.event.id });
  assert.equal(r.status, 200);
  assert.equal((await call(sessions, 'GET')).body.sessions.length, 0);
  assert.equal(T.chi_events.length, 2);                   // the sessions themselves remain
});

test('players cannot start or clear sessions', async () => {
  const code = cookie; cookie = '';
  await call(login, 'POST', { code: 'golf' });
  assert.equal((await call(admin, 'POST', { action: 'newSession' })).status, 403);
  cookie = code;
});

test('leaving organiser mode logs the phone out', async () => {
  await call(login, 'DELETE');
  assert.equal((await call(login, 'GET')).body.ok, false);
});

test('name suggestions: most recent first, one per name ignoring capitals', async () => {
  const { allNames } = await import('../api/sessions.js');
  assert.deepEqual(allNames([
    { ns_p1: 'Ann', ns_p2: 'bob', ew_p1: 'Cath', ew_p2: '' },
    { ns_p1: 'ann', ns_p2: 'Bob', ew_p1: ' Dave ', ew_p2: null },
  ]), ['Ann', 'bob', 'Cath', 'Dave']);
});

test('removed names: hidden from suggestions until used again in a new game', async () => {
  const { nameLists } = await import('../api/sessions.js');
  const rows = [
    { ns_p1: 'Ann', ns_p2: 'Bobb', ew_p1: 'Cath', ew_p2: 'Dave', created_at: '2026-10-19T10:00:00Z' },
  ];
  const hidden = [{ name_key: 'bobb', name: 'Bobb', hidden_at: '2026-10-20T00:00:00Z' }];
  assert.deepEqual(nameLists(rows, hidden), { shown: ['Ann', 'Cath', 'Dave'], hidden: ['Bobb'] });
  const later = [{ ns_p1: 'Bobb', ns_p2: 'X', ew_p1: 'Y', ew_p2: 'Z', created_at: '2026-10-21T10:00:00Z' }, ...rows];
  assert.ok(nameLists(later, hidden).shown.includes('Bobb'));
  assert.deepEqual(nameLists(later, hidden).hidden, []);
});

test('organiser can remove a name from suggestions and put it back', async () => {
  await call(login, 'POST', { code: 'Boss' });
  assert.ok((await call(sessions, 'GET')).body.names.includes('Cath'));
  assert.equal((await call(admin, 'POST', { action: 'hideName', name: 'cath' })).status, 200);
  let g = (await call(sessions, 'GET')).body;
  assert.ok(!g.names.includes('Cath'));
  assert.deepEqual(g.hiddenNames, ['cath']);
  await call(admin, 'POST', { action: 'unhideName', name: 'Cath' });
  g = (await call(sessions, 'GET')).body;
  assert.ok(g.names.includes('Cath'));
  assert.deepEqual(g.hiddenNames, []);
  await call(login, 'POST', { code: 'golf' });
  assert.equal((await call(admin, 'POST', { action: 'hideName', name: 'Cath' })).status, 403);
  assert.equal((await call(sessions, 'GET')).body.hiddenNames, undefined);
});

test('organiser can add a name; removing it hides it; putting back keeps it', async () => {
  await call(login, 'POST', { code: 'Boss' });
  const r = await call(admin, 'POST', { action: 'addName', name: '  Zoe   Brown ' });
  assert.equal(r.status, 200);
  let g = (await call(sessions, 'GET')).body;
  assert.equal(g.names[0], 'Zoe Brown');                   // newest first
  await call(admin, 'POST', { action: 'hideName', name: 'Zoe Brown' });
  g = (await call(sessions, 'GET')).body;
  assert.ok(!g.names.includes('Zoe Brown') && g.hiddenNames.includes('Zoe Brown'));
  await call(admin, 'POST', { action: 'unhideName', name: 'Zoe Brown' });
  g = (await call(sessions, 'GET')).body;
  assert.ok(g.names.includes('Zoe Brown') && !g.hiddenNames.includes('Zoe Brown'));
  assert.equal((await call(admin, 'POST', { action: 'addName', name: '   ' })).status, 400);
  await call(login, 'POST', { code: 'golf' });
  assert.equal((await call(admin, 'POST', { action: 'addName', name: 'Sneaky' })).status, 403);
});

test('organiser can lock vulnerability again', async () => {
  await call(login, 'POST', { code: 'Boss' });
  await call(admin, 'POST', { action: 'setVulLock', locked: true });
  assert.equal((await call(sessions, 'GET')).body.settings.vulLocked, true);
  await call(login, 'POST', { code: 'golf' });
  assert.equal((await call(admin, 'POST', { action: 'setVulLock', locked: false })).status, 403);
});

test('fix a misspelt name: every table changes, scores merge, phones are told', async () => {
  await call(login, 'POST', { code: 'Boss' });
  const ev = (await call(sessions, 'GET')).body.event.id;
  const a = await call(sessions, 'POST', { ...newTable, eventId: ev, nsP1: 'Margret', nsP2: 'Tom', ewP1: 'Una', ewP2: 'Vic', clientToken: crypto.randomUUID() });
  const b = await call(sessions, 'POST', { ...newTable, eventId: ev, nsP1: 'Margaret', nsP2: 'Tom', ewP1: 'Wes', ewP2: 'Xan', clientToken: crypto.randomUUID() });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const dry = await call(admin, 'POST', { action: 'renameName', from: 'margret', to: 'Margaret', dryRun: true });
  assert.equal(dry.body.tables, 1);
  assert.equal(T.chi_sessions.find((r) => r.id === a.body.session.id).ns_p1, 'Margret');   // dry run changes nothing
  const r = await call(admin, 'POST', { action: 'renameName', from: 'Margret', to: 'Margaret' });
  assert.equal(r.status, 200); assert.equal(r.body.tables, 1);
  const row = T.chi_sessions.find((x) => x.id === a.body.session.id);
  assert.equal(row.ns_p1, 'Margaret');
  assert.equal(row.location, 'Margaret & Tom v Una & Vic');
  const g = (await call(sessions, 'GET')).body;
  assert.ok(!g.names.includes('Margret') && g.names.includes('Margaret'));
  assert.deepEqual(g.nameFixes, [{ from: 'margret', to: 'Margaret' }]);
  // can't merge two people who sat at the same table
  const c = await call(admin, 'POST', { action: 'renameName', from: 'Tom', to: 'Margaret' });
  assert.equal(c.status, 409);
  await call(login, 'POST', { code: 'golf' });
  assert.equal((await call(admin, 'POST', { action: 'renameName', from: 'Tom', to: 'Tim' })).status, 403);
});
