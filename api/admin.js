import { handler, send, readJson, requireAdmin, db, HttpError, getEvent, createEvent, toEvent, cleanName, pruneEmptyEvents } from './_lib.js';

// Organiser-only actions. Every request must carry the organiser cookie.
// POST /api/admin { action: 'deleteGame', id }       → deletes one game and its boards
// POST /api/admin { action: 'newSession' }           → starts a new playing session (all tables empty)
// POST /api/admin { action: 'clearSession', eventId } → deletes every table (and board) in that session
// POST /api/admin { action: 'hideName', name }        → removes a name from the name suggestions
// POST /api/admin { action: 'unhideName', name }      → puts it back
// POST /api/admin { action: 'addName', name }         → adds a name to the suggestions
// POST /api/admin { action: 'setVulLock', locked }    → lock / unlock vulnerability for everyone
// POST /api/admin { action: 'renameName', from, to, dryRun } → correct a spelling at every table, every day
//      (merges the wrong spelling's scores into the right one). dryRun → just count the tables.
const UUID = /^[0-9a-f-]{36}$/i;

export default handler({
  POST: async (req, res) => {
    requireAdmin(req);
    const b = await readJson(req);

    if (b.action === 'deleteGame') {
      if (!UUID.test(b.id || '')) throw new HttpError(400, 'Missing table');
      const gone = await db(`chi_sessions?id=eq.${b.id}&select=id,event_id`, { method: 'DELETE', prefer: 'return=representation' });
      if (!gone.length) throw new HttpError(404, 'That table has already been deleted.');
      // Last table gone? The empty session leaves the history (unless it's the newest).
      const removed = await pruneEmptyEvents();
      return send(res, 200, { deletedGames: 1, sessionRemoved: removed.includes(gone[0].event_id) });
    }

    if (b.action === 'newSession') {
      const ev = await createEvent();
      await pruneEmptyEvents(ev.id);   // an unused earlier session leaves the history
      return send(res, 201, { event: toEvent(ev) });
    }

    if (b.action === 'clearSession') {
      const ev = await getEvent(b.eventId);
      if (!ev) throw new HttpError(404, 'That session could not be found.');
      // Boards go with their tables (ON DELETE CASCADE). The session itself stays, now empty.
      const gone = await db(`chi_sessions?event_id=eq.${ev.id}&select=id`, { method: 'DELETE', prefer: 'return=representation' });
      const removed = await pruneEmptyEvents();
      return send(res, 200, { deletedGames: gone.length, sessionRemoved: removed.includes(ev.id) });
    }

    if (b.action === 'hideName' || b.action === 'unhideName' || b.action === 'addName') {
      const name = cleanName(b.name);
      if (!name) throw new HttpError(400, 'Please type a name.');
      const k = name.toLowerCase(), key = encodeURIComponent(k);
      const now = new Date().toISOString();
      await db(`chi_hidden_names?name_key=eq.${key}`, { method: 'DELETE' });
      await db(`chi_added_names?name_key=eq.${key}`, { method: 'DELETE' });
      if (b.action === 'hideName') {
        await db('chi_hidden_names', { method: 'POST', body: { name_key: k, name, hidden_at: now } });
      } else {
        // Added or put back: keep it in the list even if no table uses it.
        await db('chi_added_names', { method: 'POST', body: { name_key: k, name, added_at: now } });
      }
      return send(res, 200, { ok: true, name });
    }

    if (b.action === 'setVulLock') {
      if (typeof b.locked !== 'boolean') throw new HttpError(400, 'Missing setting');
      await db('chi_settings?key=eq.vul_locked', { method: 'DELETE' });
      await db('chi_settings', { method: 'POST', body: { key: 'vul_locked', value: b.locked, updated_at: new Date().toISOString() } });
      return send(res, 200, { vulLocked: b.locked });
    }

    if (b.action === 'setScoringMode') {
      if (!['chicago', 'rubber'].includes(b.mode)) throw new HttpError(400, 'Missing setting');
      await db('chi_settings?key=eq.scoring_mode', { method: 'DELETE' });
      if (b.mode === 'rubber') {
        await db('chi_settings', { method: 'POST', body: { key: 'scoring_mode', value: 'rubber', updated_at: new Date().toISOString() } });
      }
      return send(res, 200, { scoringMode: b.mode });
    }

    if (b.action === 'renameName') {
      const from = cleanName(b.from), to = cleanName(b.to);
      if (!from || !to) throw new HttpError(400, 'Please type the correct spelling.');
      const fk = from.toLowerCase(), tk = to.toLowerCase();
      const rows = await db('chi_sessions?select=id,ns_p1,ns_p2,ew_p1,ew_p2');
      const SEATS4 = ['ns_p1', 'ns_p2', 'ew_p1', 'ew_p2'];
      const hits = rows.filter((r) => SEATS4.some((k) => cleanName(r[k]).toLowerCase() === fk));
      // Same table can't end up with one person in two seats.
      const clash = hits.find((r) => SEATS4.some((k) => cleanName(r[k]).toLowerCase() === tk) && fk !== tk);
      if (clash) throw new HttpError(409, `${to} and ${from} played at the same table, so they can’t be the same person.`);
      if (b.dryRun) return send(res, 200, { tables: hits.length });
      for (const r of hits) {
        const nw = Object.fromEntries(SEATS4.map((k) => [k, cleanName(r[k]).toLowerCase() === fk ? to : cleanName(r[k])]));
        nw.location = cleanName(`${nw.ns_p1} & ${nw.ns_p2} v ${nw.ew_p1} & ${nw.ew_p2}`, 80);
        await db(`chi_sessions?id=eq.${r.id}`, { method: 'PATCH', body: nw });
      }
      const now = new Date().toISOString();
      const enc = (k) => encodeURIComponent(k);
      // The wrong spelling leaves the suggestion lists; the right one stays in.
      await db(`chi_added_names?name_key=eq.${enc(fk)}`, { method: 'DELETE' });
      await db(`chi_hidden_names?name_key=eq.${enc(fk)}`, { method: 'DELETE' });
      await db(`chi_hidden_names?name_key=eq.${enc(tk)}`, { method: 'DELETE' });
      if (fk !== tk) {
        await db(`chi_name_fixes?from_key=eq.${enc(fk)}`, { method: 'DELETE' });
        await db('chi_name_fixes', { method: 'POST', body: { from_key: fk, from_name: from, to_name: to, fixed_at: now } });
        // A name that used to be corrected to something else is now a real name again.
        await db(`chi_name_fixes?from_key=eq.${enc(tk)}`, { method: 'DELETE' });
      }
      if (!hits.length) await db('chi_added_names', { method: 'POST', body: { name_key: tk, name: to, added_at: now } });
      return send(res, 200, { tables: hits.length, name: to });
    }

    throw new HttpError(400, 'Unknown action');
  },
});
