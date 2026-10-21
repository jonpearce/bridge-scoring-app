import { handler, send, readJson, requireAuth, db, HttpError, toDeal, getSettings } from './_lib.js';
import { scoreDeal, validateDeal, boardNumberFor, vulnerabilityFor, SCORING_VERSION } from '../lib/chicago.js';

// PUT /api/deal
// { sessionId, dealNo, passedOut, level, strain, doubled, declarer, tricks, leadSuit, leadRank, vulNs, vulEw, expectedUpdatedAt }
// The score is calculated HERE, on the server — the phone's figure is only a preview.
// New result: refused (409) if another phone saved this deal first.
// Correction: send expectedUpdatedAt; refused (409) if someone changed it in the meantime.
export default handler({
  PUT: async (req, res) => {
    requireAuth(req);
    const b = await readJson(req);
    if (!/^[0-9a-f-]{36}$/i.test(b.sessionId || '')) throw new HttpError(400, 'Missing session');
    const dealNo = Number(b.dealNo);
    if (![1, 2, 3, 4].includes(dealNo)) throw new HttpError(400, 'Deal must be 1–4');

    const sess = (await db(`chi_sessions?id=eq.${b.sessionId}&select=id,start_board,first_dealer`))[0];
    if (!sess) throw new HttpError(404, 'Session not found');

    const deal = b.passedOut
      ? { dealNo, passedOut: true }
      : {
          dealNo, passedOut: false,
          level: Number(b.level), strain: b.strain, doubled: b.doubled || '',
          declarer: b.declarer, tricks: Number(b.tricks),
          leadSuit: b.leadSuit || null, leadRank: b.leadRank || null,
        };
    // Vulnerability: as chosen on the scoring screen, else the club default.
    // When the organiser has locked it, nobody can change it: a new board gets
    // the default, a correction keeps whatever the board already had.
    const def = vulnerabilityFor(dealNo, sess.first_dealer);
    const { vulLocked } = await getSettings();
    if (vulLocked) {
      const was = (await db(`chi_deals?session_id=eq.${sess.id}&deal_no=eq.${dealNo}&select=vul_ns,vul_ew`))[0];
      deal.vulNs = typeof was?.vul_ns === 'boolean' ? was.vul_ns : def.ns;
      deal.vulEw = typeof was?.vul_ew === 'boolean' ? was.vul_ew : def.ew;
    } else {
      deal.vulNs = typeof b.vulNs === 'boolean' ? b.vulNs : def.ns;
      deal.vulEw = typeof b.vulEw === 'boolean' ? b.vulEw : def.ew;
    }
    const err = validateDeal(deal);
    if (err) throw new HttpError(400, err);
    const scored = scoreDeal(deal, sess.first_dealer);

    const row = {
      session_id: sess.id,
      deal_no: dealNo,
      board_num: boardNumberFor(dealNo, sess.start_board),
      passed_out: deal.passedOut,
      level: deal.passedOut ? null : deal.level,
      strain: deal.passedOut ? null : deal.strain,
      doubled: deal.passedOut ? '' : deal.doubled,
      declarer: deal.passedOut ? null : deal.declarer,
      tricks: deal.passedOut ? null : deal.tricks,
      lead_suit: deal.passedOut ? null : deal.leadSuit,
      lead_rank: deal.passedOut ? null : deal.leadRank,
      vul_ns: deal.vulNs,
      vul_ew: deal.vulEw,
      ns_score: scored.nsScore,
      scoring_version: SCORING_VERSION,
    };

    const key = `session_id=eq.${sess.id}&deal_no=eq.${dealNo}`;
    let saved;
    if (b.expectedUpdatedAt) {
      saved = await db(`chi_deals?${key}&updated_at=eq.${encodeURIComponent(b.expectedUpdatedAt)}`, {
        method: 'PATCH', body: row, prefer: 'return=representation',
      });
    } else {
      saved = await db('chi_deals?on_conflict=session_id,deal_no', {
        method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation',
      });
    }
    if (!saved.length) {
      const current = (await db(`chi_deals?${key}`))[0];
      throw new HttpError(409, 'This board was just saved or changed on another phone. Please check it.', {
        current: current ? toDeal(current) : null,
      });
    }
    send(res, 200, { deal: toDeal(saved[0]) });
  },
});
