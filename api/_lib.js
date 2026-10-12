// Shared server helpers for the /api functions (not itself a route —
// Vercel ignores files in /api that start with an underscore).
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jykxfndrmdbgwbdedgzg.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const ACCESS_CODE = (process.env.ACCESS_CODE || 'golf').trim().toLowerCase();
export const TIME_ZONE = process.env.APP_TIME_ZONE || 'Australia/Melbourne';
const COOKIE = 'chi_auth';
const COOKIE_DAYS = 30;

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

// ---------- request / response ----------

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function handler(methods) {
  return async (req, res) => {
    try {
      const fn = methods[req.method];
      if (!fn) throw new HttpError(405, 'Method not allowed');
      if (!SERVICE_KEY) throw new HttpError(500, 'Server is not configured: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.');
      if (keyKind() === 'public') throw new HttpError(500, 'Server is not configured: SUPABASE_SERVICE_ROLE_KEY in Vercel holds the PUBLIC (anon/publishable) key. It needs the secret service_role key.');
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e.message || 'Something went wrong', ...(e.extra || {}) });
    }
  };
}

// Which kind of Supabase key is configured — never reveals the key itself.
export function keyKind() {
  if (SERVICE_KEY.startsWith('sb_secret_')) return 'secret';
  if (SERVICE_KEY.startsWith('sb_publishable_')) return 'public';
  if (SERVICE_KEY.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(SERVICE_KEY.split('.')[1], 'base64url').toString()).role;
      return role === 'service_role' ? 'secret' : 'public';
    } catch { return 'unknown'; }
  }
  return 'unknown';
}

// ---------- access code + session cookie ----------

const signingKey = () => crypto.createHash('sha256').update('chi-cookie:' + SERVICE_KEY).digest();
const sign = (s) => crypto.createHmac('sha256', signingKey()).update(s).digest('base64url');

export function codeMatches(code) {
  const a = Buffer.from(String(code || '').trim().toLowerCase());
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setAuthCookie(res) {
  const exp = Date.now() + COOKIE_DAYS * 864e5;
  const value = `${exp}.${sign(String(exp))}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
}

export function isAuthed(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

export function requireAuth(req) {
  if (!isAuthed(req)) throw new HttpError(401, 'Please enter the access code.');
}

// ---------- Supabase REST (server-side only, secret key never leaves here) ----------

export async function db(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, 'Content-Type': 'application/json' };
  if (SERVICE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  if (prefer) headers.Prefer = prefer;
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new HttpError(503, 'Could not reach the database. Please try again.');
  }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    console.error('Supabase error', r.status, data);
    throw new HttpError(r.status >= 500 ? 503 : 400, data?.message || 'Database error');
  }
  return data;
}

// ---------- dates ----------

export function todayLocal() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function validDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
}

export async function eventFor(date, create) {
  const found = await db(`chi_events?play_date=eq.${date}&name=eq.Social%20bridge&select=id,play_date`);
  if (found.length || !create) return found[0] || null;
  const made = await db('chi_events?on_conflict=play_date,name', {
    method: 'POST',
    body: { play_date: date, name: 'Social bridge' },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return made[0];
}

// ---------- shape conversion ----------

export const toDeal = (r) => ({
  dealNo: r.deal_no,
  boardNum: r.board_num,
  passedOut: r.passed_out,
  level: r.level,
  strain: r.strain,
  doubled: r.doubled,
  declarer: r.declarer,
  tricks: r.tricks,
  leadSuit: r.lead_suit,
  leadRank: r.lead_rank,
  nsScore: r.ns_score,
  updatedAt: r.updated_at,
});

export const toSession = (s) => ({
  id: s.id,
  location: s.location,
  startBoard: s.start_board,
  firstDealer: s.first_dealer,
  nsP1: s.ns_p1, nsP2: s.ns_p2, ewP1: s.ew_p1, ewP2: s.ew_p2,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
  deals: (s.chi_deals || []).map(toDeal).sort((a, b) => a.dealNo - b.dealNo),
});

export const cleanName = (s, max = 40) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
