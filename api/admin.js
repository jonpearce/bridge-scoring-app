import { handler, send, readJson, requireAdmin, db, HttpError, validDate, eventFor } from './_lib.js';

// Organiser-only actions. Every request must carry the organiser cookie.
// POST /api/admin { action: 'deleteGame', id }       → deletes one game and its boards
// POST /api/admin { action: 'clearDay', date }       → deletes every game (and board) on that day
const UUID = /^[0-9a-f-]{36}$/i;

export default handler({
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);

    if (b.action === 'deleteGame') {
      if (!UUID.test(b.id || '')) throw new HttpError(400, 'Missing game');
      const gone = await db(`chi_sessions?id=eq.${b.id}&select=id,event_id`, { method: 'DELETE', prefer: 'return=representation' });
      if (!gone.length) throw new HttpError(404, 'That game has already been deleted.');
      await removeEmptyEvent(gone[0].event_id);
      return send(res, 200, { deletedGames: 1 });
    }

    if (b.action === 'clearDay') {
      if (!validDate(b.date)) throw new HttpError(400, 'Bad date');
      const ev = await eventFor(b.date, false);
      if (!ev) return send(res, 200, { deletedGames: 0 });
      // Boards go with their games (ON DELETE CASCADE).
      const gone = await db(`chi_sessions?event_id=eq.${ev.id}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
      await removeEmptyEvent(ev.id);
      return send(res, 200, { deletedGames: gone.length });
    }

    throw new HttpError(400, 'Unknown action');
  },
});

async function removeEmptyEvent(eventId) {
  const left = await db(`chi_sessions?event_id=eq.${eventId}&select=id&limit=1`);
  if (!left.length) await db(`chi_events?id=eq.${eventId}`, { method: 'DELETE' });
}
