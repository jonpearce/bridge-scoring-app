import { handler, send, readJson, roleForCode, setAuthCookie, clearAuthCookie, authRole, HttpError } from './_lib.js';

// GET    /api/login  → { ok, admin }  (is this phone already let in? as organiser?)
// POST   /api/login  { code } → sets a 30-day cookie: players' code or organiser code
// DELETE /api/login  → logs this phone out (used to leave organiser mode)
export default handler({
  GET: async (req, res) => {
    const role = authRole(req);
    send(res, 200, { ok: !!role, admin: role === 'admin' });
  },
  POST: async (req, res) => {
    const { code } = await readJson(req);
    const role = roleForCode(code);
    if (!role) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      throw new HttpError(401, 'That code isn’t right. Please try again.');
    }
    setAuthCookie(res, role);
    send(res, 200, { ok: true, admin: role === 'admin' });
  },
  DELETE: async (req, res) => {
    clearAuthCookie(res);
    send(res, 200, { ok: false });
  },
});
