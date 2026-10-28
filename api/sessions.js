import {
  handler, send, readJson, requireAuth, db, HttpError, todayLocal, toSession, cleanName,
  listEvents, resolveEvent, toEvent, authRole, getSettings,
} from './_lib.js';
import { SEATS, boardNumberFor } from '../lib/chicago.js';

const SELECT = 'id,location,start_board,first_dealer,scoring,ns_p1,ns_p2,ew_p1,ew_p2,created_at,updated_at,chi_deals(*)';

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
    const token = /^[0-9a-f-]{36}$/i.test(b.clientToken || '') ? b.clientToken : null;
    const ev = await resolveEvent(b.eventId);
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
    send(res, 201, { session: toSession(s) });
  },

  PATCH: async (req, res) => {
    requireAuth(req);
    const b = await readJson(req);
    if (!/^[0-9a-f-]{36}$/i.test(b.id || '')) throw new HttpError(400, 'Missing session id');
    const cur = (await db(`chi_sessions?id=eq.${b.id}&select=${SELECT}`))[0];
    if (!cur) throw new HttpError(404, 'Session not found');
    const row = sessionFields({ ...toSession(cur), ...b }, true);
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
