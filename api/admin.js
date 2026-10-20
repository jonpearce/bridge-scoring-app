import { handler, send, readJson, requireAdmin, db, HttpError, getEvent, createEvent, toEvent, cleanName } from './_lib.js';

// Organiser-only actions. Every request must carry the organiser cookie.
// POST /api/admin { action: 'deleteGame', id }       → deletes one game and its boards
// POST /api/admin { action: 'newSession' }           → starts a new playing session (all tables empty)
// POST /api/admin { action: 'clearSession', eventId } → deletes every table (and board) in that session
// POST /api/admin { action: 'hideName', name }        → removes a name from the name suggestions
// POST /api/admin { action: 'unhideName', name }      → puts it back
const UUID = /^[0-9a-f-]{36}$/i;

export default handler({
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);

    if (b.action === 'deleteGame') {
      if (!UUID.test(b.id || '')) throw new HttpError(400, 'Missing table');
      const gone = await db(`chi_sessions?id=eq.${b.id}&select=id,event_id`, { method: 'DELETE', prefer: 'return=representation' });
      if (!gone.length) throw new HttpError(404, 'That table has already been deleted.');
      return send(res, 200, { deletedGames: 1 });
    }

    if (b.action === 'newSession') {
      const ev = await createEvent();
      return send(res, 201, { event: toEvent(ev) });
    }

    if (b.action === 'clearSession') {
      const ev = await getEvent(b.eventId);
      if (!ev) throw new HttpError(404, 'That session could not be found.');
      // Boards go with their tables (ON DELETE CASCADE). The session itself stays, now empty.
      const gone = await db(`chi_sessions?event_id=eq.${ev.id}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
      return send(res, 200, { deletedGames: gone.length });
    }

    if (b.action === 'hideName' || b.action === 'unhideName') {
      const name = cleanName(b.name);
      if (!name) throw new HttpError(400, 'Missing name');
      const key = encodeURIComponent(name.toLowerCase());
      await db(`chi_hidden_names?name_key=eq.${key}`, { method: 'DELETE' });
      if (b.action === 'hideName') {
        await db('chi_hidden_names', { method: 'POST', body: { name_key: name.toLowerCase(), name, hidden_at: new Date().toISOString() } });
      }
      return send(res, 200, { ok: true });
    }

    throw new HttpError(400, 'Unknown action');
  },
});
