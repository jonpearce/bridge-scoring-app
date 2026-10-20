import {
  handler, send, readJson, requireAuth, db, HttpError, todayLocal, toSession, cleanName,
  listEvents, resolveEvent, toEvent,
} from './_lib.js';
import { SEATS } from '../lib/chicago.js';

const SELECT = 'id,location,start_board,first_dealer,ns_p1,ns_p2,ew_p1,ew_p2,created_at,updated_at,chi_deals(*)';

// GET   /api/sessions?event=ID  → every table (with boards) in that playing session
//                                 (newest session if no ID), plus the list of sessions
// POST  /api/sessions  { eventId, startBoard, firstDealer, nsP1, nsP2, ewP1, ewP2, clientToken }
// PATCH /api/sessions  { id, ...fields }  → edit names; board/dealer only before play starts
export default handler({
  GET: async (req, res) => {
    requireAuth(req);
    const url = new URL(req.url, 'http://x');
    const ev = await resolveEvent(url.searchParams.get('event'));
    const events = await listEvents();
    if (!events.some((e) => e.id === ev.id)) events.unshift(ev);
    const [rows, past] = await Promise.all([
      db(`chi_sessions?event_id=eq.${ev.id}&select=${SELECT}&order=created_at.asc`),
      db('chi_sessions?select=ns_p1,ns_p2,ew_p1,ew_p2&order=created_at.desc&limit=2000'),
    ]);
    send(res, 200, {
      event: toEvent(ev),
      latestId: events[0].id,
      events: events.map(toEvent),
      today: todayLocal(),
      sessions: rows.map(toSession),
      names: allNames(past),
    });
  },

  POST: async (req, res) => {
    requireAuth(req);
    const b = await readJson(req);
    const row = sessionFields(b, true);
    const token = /^[0-9a-f-]{36}$/i.test(b.clientToken || '') ? b.clientToken : null;
    const ev = await resolveEvent(b.eventId);
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
    if (played && (row.start_board !== cur.start_board || row.first_dealer !== cur.first_dealer)) {
      throw new HttpError(409, 'The starting board and first dealer can’t be changed once a board has been recorded.');
    }
    const upd = await db(`chi_sessions?id=eq.${b.id}&select=${SELECT}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
    send(res, 200, { session: toSession(upd[0]) });
  },
});

// Every player name ever entered (any day), most recently used first, one
// entry per name ignoring capitals — used to suggest names on the set-up screen.
export function allNames(rows) {
  const seen = new Map();
  for (const r of rows) for (const n of [r.ns_p1, r.ns_p2, r.ew_p1, r.ew_p2]) {
    const name = cleanName(n);
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()];
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
