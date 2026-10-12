import { handler, send, readJson, codeMatches, setAuthCookie, isAuthed, HttpError } from './_lib.js';

// GET  /api/login  → { ok: true|false }  (is this phone already let in?)
// POST /api/login  { code } → sets a 30-day cookie if the code is right
export default handler({
  GET: async (req, res) => send(res, 200, { ok: isAuthed(req) }),
  POST: async (req, res) => {
    const { code } = await readJson(req);
    if (!codeMatches(code)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      throw new HttpError(401, 'That code isn’t right. Please try again.');
    }
    setAuthCookie(res);
    send(res, 200, { ok: true });
  },
});
