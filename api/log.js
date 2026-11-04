import { handler, send, readJson, requireAuth, requireAdmin, db, HttpError, logEvent, getEvent } from './_lib.js';

// Activity log (chi_log).
// POST /api/log { events: [{ kind, detail, eventId, sessionId, at }] }
//      → a phone reports what happened on it (screens visited, errors, lost connection…).
//        Up to 20 events per call.
// GET  /api/log?event=ID&limit=300  (organiser only)
//      → newest first: that session's events plus phone/login events since it started.
const KEEP_DAYS = 120;
const UUID = /^[0-9a-f-]{36}$/i;

export default handler({
  POST: async (req, res) => {
    requireAuth(req);
    req.skipLog = true;   // a broken log report must not log itself
    const b = await readJson(req);
    const events = Array.isArray(b.events) ? b.events.slice(0, 20) : [];
    await Promise.all(events.map(async (e) => {
      if (!e || typeof e.kind !== 'string') return;
      // Phones send in batches, so use the phone's own time when it is believable (within 10 minutes).
      const t = Date.parse(e.at);
      const at = Number.isFinite(t) && Math.abs(t - Date.now()) < 10 * 60e3 ? new Date(t).toISOString() : null;
      await logEvent(req, e.kind, { ...(e.detail && typeof e.detail === 'object' ? e.detail : {}), ...(e.at ? { phoneTime: String(e.at).slice(0, 30) } : {}) },
        { sessionId: e.sessionId, eventId: e.eventId, source: 'phone', at });
    }));
    // Now and then, tidy away old entries.
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
      await db(`chi_log?at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE' }).catch(() => {});
    }
    send(res, 200, { ok: true, logged: events.length });
  },

  GET: async (req, res) => {
    requireAdmin(req);
    req.skipLog = true;
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 300));
    const id = url.searchParams.get('event');
    let filter = '';
    if (id) {
      if (!UUID.test(id)) throw new HttpError(400, 'Unknown session');
      const ev = await getEvent(id);
      const since = ev?.startedAt || ev?.started_at || ev?.created_at;
      filter = `&or=(event_id.eq.${id},event_id.is.null)${since ? `&at=gte.${encodeURIComponent(since)}` : ''}`;
    }
    const rows = await db(`chi_log?select=at,device,who,role,kind,source,session_id,detail&order=at.desc&limit=${limit}${filter}`);
    send(res, 200, { entries: rows });
  },
});
