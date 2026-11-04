import {
  handler, send, readJson, requireAuth, db, HttpError, todayLocal, toSession, cleanName,
  listEvents, resolveEvent, toEvent, authRole, getSettings, logEvent,
} from './_lib.js';
import { SEATS, boardNumberFor, pairKey, setStartFor } from '../lib/chicago.js';

const SELECT = 'id,event_id,location,start_board,first_dealer,scoring,ns_p1,ns_p2,ew_p1,ew_p2,created_at,updated_at,chi_deals(*)';

// GET   /api/sessions?event=ID  → every table (with boards) in that playing session
//                                 (newest session if no ID), plus the list of sessions
// POST  /api/sessions  { eventId, startBoard, firstDealer, nsP1, nsP2, ewP1, ewP2, clientToken }
// PATCH /api/sessions  { id, ...fields }  → edit names or board numbers (any time — saved boards
//                                           are renumbered); first dealer only before play starts
export default handler({
  GET: async (req, res) => {
    requireAuth(req);
    const url = new URL(req.url, 'http://x');
    const ev = await resolveEvent(url.searchParams.get('event'));
    const events = await listEvents();
    if (!events.some((e) => e.id === ev.id)) events.unshift(ev);
    const [rows, past, hidden, added, settings, fixes] = await Promise.all([
      db(`chi_sessions?event_id=eq.${ev.id}&select=${SELECT}&order=created_at.asc`),
      db('chi_sessions?select=ns_p1,ns_p2,ew_p1,ew_p2,created_at&order=created_at.desc&limit=2000'),
      db('chi_hidden_names?select=name_key,name,hidden_at&order=name.asc'),
      db('chi_added_names?select=name_key,name,added_at'),
      getSettings(),
      db('chi_name_fixes?select=from_key,to_name'),
    ]);
    const names = nameLists(past, hidden, added);
    send(res, 200, {
      event: toEvent(ev),
      latestId: events[0].id,
      events: events.map(toEvent),
      today: todayLocal(),
      sessions: rows.map(toSession),
      names: names.shown,
      settings,
      nameFixes: fixes.map((f) => ({ from: f.from_key, to: f.to_name })),
      ...(authRole(req) === 'admin' ? { hiddenNames: names.hidden } : {}),
    });
  },

  POST: async (req, res) => {
    requireAuth(req);
    const b = await readJson(req);
    const row = sessionFields(b, true);
    row.start_board = setStartFor(row.start_board);   // sets of four: 1–4, 5–8 …
    await useKnownSpellings(row);
    const token = /^[0-9a-f-]{36}$/i.test(b.clientToken || '') ? b.clientToken : null;
    const ev = await resolveEvent(b.eventId);
    // A double tap (same token) just returns the table already made.
    const again = token && (await db(`chi_sessions?client_token=eq.${token}&select=${SELECT}`))[0];
    if (again) return send(res, 201, { session: toSession(again) });
    // The other pair may already have set up this table: same four players,
    // overlapping boards, same session. Send them to it instead of making a second copy.
    // Only the exact same boards count, and the phone can still choose "set up a separate table".
    const same = b.allowDuplicate ? null : (await db(`chi_sessions?event_id=eq.${ev.id}&select=id,start_board,ns_p1,ns_p2,ew_p1,ew_p2,chi_deals(deal_no)`)).find((x) => {
      const a = [pairKey(x.ns_p1, x.ns_p2), pairKey(x.ew_p1, x.ew_p2)].sort().join('|');
      const c = [pairKey(row.ns_p1, row.ns_p2), pairKey(row.ew_p1, row.ew_p2)].sort().join('|');
      return a === c && x.start_board === row.start_board;
    });
    if (same) {
      const done = (same.chi_deals || []).length;
      throw new HttpError(409, `${same.ns_p1} & ${same.ns_p2} v ${same.ew_p1} & ${same.ew_p2} on Boards ${same.start_board}–${same.start_board + 3} has already been set up (${done} of 4 boards entered).`,
        { existingId: same.id, logDetail: { existingId: same.id } });
    }
    // How this table is scored is fixed now, from the organiser's switch.
    // Only written when Rubber, so Chicago tables are created exactly as before.
    const { scoringMode } = await getSettings();
    if (scoringMode === 'rubber') row.scoring = 'rubber';
    const made = await db('chi_sessions?on_conflict=client_token&select=' + SELECT, {
      method: 'POST',
      body: { ...row, event_id: ev.id, client_token: token },
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
    // A repeat tap returns nothing (duplicate ignored) — fetch the original.
    const s = made[0] || (token && (await db(`chi_sessions?client_token=eq.${token}&select=${SELECT}`))[0]);
    if (!s) throw new HttpError(500, 'Could not create the session');
    await logEvent(req, 'table_set_up', {
      boards: `${s.start_board}–${s.start_board + 3}`, ns: `${s.ns_p1} & ${s.ns_p2}`, ew: `${s.ew_p1} & ${s.ew_p2}`,
      firstDealer: s.first_dealer, scoring: s.scoring || 'chicago', ...(b.allowDuplicate ? { setUpAnyway: true } : {}),
      ...(row.ns_p1 !== cleanName(b.nsP1) || row.ns_p2 !== cleanName(b.nsP2) || row.ew_p1 !== cleanName(b.ewP1) || row.ew_p2 !== cleanName(b.ewP2)
        ? { typed: [b.nsP1, b.nsP2, b.ewP1, b.ewP2].map((n) => cleanName(n)).join(', ') } : {}),
    }, { sessionId: s.id, eventId: ev.id });
    send(res, 201, { session: toSession(s) });
  },

  PATCH: async (req, res) => {
    requireAuth(req);
    const b = await readJson(req);
    if (!/^[0-9a-f-]{36}$/i.test(b.id || '')) throw new HttpError(400, 'Missing session id');
    const cur = (await db(`chi_sessions?id=eq.${b.id}&select=${SELECT}`))[0];
    if (!cur) throw new HttpError(404, 'Session not found');
    req.logSessionId = cur.id;
    // Board numbers only change when this phone actually changed them: a form
    // opened before another phone renumbered the table must not undo that.
    if (b.fromStartBoard != null && Number(b.startBoard) === Number(b.fromStartBoard)) delete b.startBoard;
    if (b.fromStartBoard != null && b.startBoard != null && Number(b.fromStartBoard) !== cur.start_board) {
      throw new HttpError(409, `Another phone has just changed this table to Boards ${cur.start_board}–${cur.start_board + 3}. Please check and try again.`,
        { session: toSession(cur) });
    }
    if (b.startBoard != null && Number(b.startBoard) !== cur.start_board) b.startBoard = setStartFor(b.startBoard);
    const row = sessionFields({ ...toSession(cur), ...b }, true);
    await useKnownSpellings(row);
    const played = (cur.chi_deals || []).length > 0;
    if (played && row.first_dealer !== cur.first_dealer) {
      throw new HttpError(409, 'The first dealer can’t be changed once a board has been recorded.');
    }
    // New board numbers: move every saved board at this table with them.
    if (row.start_board !== cur.start_board) {
      for (const d of cur.chi_deals || []) {
        await db(`chi_deals?session_id=eq.${cur.id}&deal_no=eq.${d.deal_no}`, {
          method: 'PATCH', body: { board_num: boardNumberFor(d.deal_no, row.start_board) },
        });
      }
    }
    const upd = await db(`chi_sessions?id=eq.${b.id}&select=${SELECT}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
    const changed = {};
    for (const k of ['start_board', 'first_dealer', 'ns_p1', 'ns_p2', 'ew_p1', 'ew_p2']) if (row[k] !== cur[k]) changed[k] = `${cur[k]} → ${row[k]}`;
    await logEvent(req, changed.start_board ? 'board_numbers_changed' : 'table_changed', changed, { sessionId: cur.id, eventId: cur.event_id });
    send(res, 200, { session: toSession(upd[0]) });
  },
});

// Every player name ever entered (any day), most recently used first, one
// entry per name ignoring capitals — used to suggest names on the set-up screen.
// Rows must be newest first.
export function allNames(rows) {
  return [...lastUse(rows).values()].map((x) => x.name);
}
function lastUse(rows) {
  const seen = new Map();
  for (const r of rows) for (const n of [r.ns_p1, r.ns_p2, r.ew_p1, r.ew_p2]) {
    const name = cleanName(n);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, at: r.created_at });
  }
  return seen;
}

// Splits names into those suggested and those the organiser removed.
// A removed name returns if a game created after its removal uses it.
export function nameLists(rows, hiddenRows, addedRows = []) {
  const used = lastUse(rows);
  // Names added by hand on the Edit names page count as used when they were added.
  for (const a of addedRows) {
    const cur = used.get(a.name_key);
    if (!cur) used.set(a.name_key, { name: a.name, at: a.added_at });
    else if (String(a.added_at) > String(cur.at)) cur.at = a.added_at;
  }
  const hid = new Map(hiddenRows.map((h) => [h.name_key, h]));
  const stillHidden = (key) => hid.has(key) && !(String(used.get(key)?.at || '') > String(hid.get(key).hidden_at));
  return {
    shown: [...used.entries()].filter(([k]) => !stillHidden(k))
      .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).map(([, x]) => x.name),
    hidden: hiddenRows.filter((h) => stillHidden(h.name_key)).map((h) => h.name),
  };
}

// A name typed with different capitals or spacing ("ROB V", "rob  v") is the
// same person: use the spelling already in use (or the organiser's correction).
const nameKey = (n) => cleanName(n).toLowerCase();
async function useKnownSpellings(row) {
  const [rows, added, fixes] = await Promise.all([
    db('chi_sessions?select=ns_p1,ns_p2,ew_p1,ew_p2,created_at&order=created_at.desc&limit=2000'),
    db('chi_added_names?select=name_key,name,added_at'),
    db('chi_name_fixes?select=from_key,to_name'),
  ]);
  const known = new Map();
  for (const a of added) known.set(a.name_key, a.name);
  for (const [k, v] of lastUse(rows)) known.set(k, v.name);   // most recent spelling wins
  for (const f of fixes) known.set(f.from_key, f.to_name);
  for (const k of ['ns_p1', 'ns_p2', 'ew_p1', 'ew_p2']) {
    const hit = known.get(nameKey(row[k]));
    if (hit) row[k] = cleanName(hit);
  }
  const keys = ['ns_p1', 'ns_p2', 'ew_p1', 'ew_p2'].map((k) => nameKey(row[k]));
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) throw new HttpError(400, `${row[['ns_p1', 'ns_p2', 'ew_p1', 'ew_p2'][keys.indexOf(twice)]]} is entered twice. Each player needs a different name.`);
  row.location = cleanName(`${row.ns_p1} & ${row.ns_p2} v ${row.ew_p1} & ${row.ew_p2}`, 80);
}

function sessionFields(b, strict) {
  const row = {
    // No venue question any more: label the game by its pairs.
    location: cleanName(`${cleanName(b.nsP1)} & ${cleanName(b.nsP2)} v ${cleanName(b.ewP1)} & ${cleanName(b.ewP2)}`, 80),
    start_board: Number(b.startBoard),
    first_dealer: b.firstDealer || 'N',
    ns_p1: cleanName(b.nsP1), ns_p2: cleanName(b.nsP2),
    ew_p1: cleanName(b.ewP1), ew_p2: cleanName(b.ewP2),
  };
  if (strict) {
    if (!Number.isInteger(row.start_board) || row.start_board < 1 || row.start_board > 999) throw new HttpError(400, 'Please enter the starting board number.');
    if (!SEATS.includes(row.first_dealer)) throw new HttpError(400, 'Please choose who deals first.');
    if (!row.ns_p1 || !row.ns_p2 || !row.ew_p1 || !row.ew_p2) throw new HttpError(400, 'Please enter all four player names.');
  }
  return row;
}
