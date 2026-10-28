// =============================================================
//  Rubber bridge scoring engine (organiser switch, from 28 Oct 2026)
//  Pure functions only — used by the server (authoritative) and the phones.
//
//  Used only by tables set up while the organiser's switch is on
//  "Rubber". Tables set up under Chicago keep Chicago scoring for good.
//
//  Rules (Laws of Rubber Bridge, no honours):
//   • Contract trick points go "below the line" and add up across deals.
//     100 or more below the line = a GAME. Then both sides' part-scores
//     are wiped and a new game starts. No part-score or game bonus.
//   • A side that has won a game in the current rubber is VULNERABLE.
//     So vulnerability is never chosen: it comes from the games won.
//   • First side to two games wins the rubber: +700 if the other side has
//     no game (2–0), +500 if they have one (2–1). A new rubber starts on
//     the next deal, with nobody vulnerable.
//   • Above the line (scored straight away): overtricks, slam bonuses,
//     insult bonus for making a doubled contract, penalties for going down.
//   • The four boards of a round are one sitting. If the rubber is not
//     finished after board 4: +300 to a side that has one game, +100 to a
//     side that has a part-score in the unfinished game.
//   • As with Chicago, only one pair scores on each board (declarers if
//     made, defenders if down), and the game is won on total points.
//   • Dealer rotates N → E → S → W from the table's first dealer.
// =============================================================

import {
  PER_TRICK, contractTrickPoints, undertrickPenalty, normaliseDoubled, validateDeal,
  sideOf, dealerFor, vulnerabilityText, contractText, outcomeText,
} from './chicago.js';

export const RUBBER_BONUS_FAST = 700;   // 2–0
export const RUBBER_BONUS_SLOW = 500;   // 2–1
export const UNFINISHED_GAME = 300;
export const UNFINISHED_PART = 100;

const other = (side) => (side === 'NS' ? 'EW' : 'NS');
const shortSide = (side) => (side === 'NS' ? 'N/S' : 'E/W');

/** Below / above the line for the declaring side, given its vulnerability. */
export function rubberDealParts({ level, strain, doubled, tricks }, vul) {
  const dbl = normaliseDoubled(doubled);
  const need = level + 6;
  if (tricks < need) return { made: false, below: 0, above: undertrickPenalty(need - tricks, vul, dbl) };
  const mult = dbl === 'XX' ? 4 : dbl === 'X' ? 2 : 1;
  const over = tricks - need;
  const overScore = over * (dbl === '' ? PER_TRICK[strain] : (vul ? 200 : 100) * (mult / 2));
  const slam = level === 7 ? (vul ? 1500 : 1000) : level === 6 ? (vul ? 750 : 500) : 0;
  const insult = dbl === 'X' ? 50 : dbl === 'XX' ? 100 : 0;
  return { made: true, below: contractTrickPoints(level, strain) * mult, above: overScore + slam + insult };
}

/**
 * Score every board at one rubber table, in deal order (1 → 4).
 * deals: the table's saved deals (any of 1–4). A board not yet entered is
 * skipped (it changes nothing), so the next board's vulnerability is still known.
 * Returns {
 *   deals: { [dealNo]: scored deal — same shape as Chicago's scoreDeal, plus
 *            below, above, game, rubberBonus, note },
 *   vulBefore: { [dealNo]: { ns, ew } }   vulnerability each board is played at,
 *   state: { games: {NS, EW}, below: {NS, EW}, rubberNo }  after the last board,
 *   complete: all four boards entered,
 *   extras: [{ side, points, why }]  end-of-round bonuses (only when complete),
 * }
 */
export function scoreRubberTable(deals, firstDealer = 'N') {
  const byNo = new Map((deals || []).map((d) => [d.dealNo, d]));
  let games = { NS: 0, EW: 0 }, below = { NS: 0, EW: 0 }, rubberNo = 1;
  const out = {}, vulBefore = {};
  for (let n = 1; n <= 4; n++) {
    const vul = { ns: games.NS > 0, ew: games.EW > 0 };
    vulBefore[n] = vul;
    const d = byNo.get(n);
    if (!d) continue;
    const base = { dealNo: n, vul, vulText: vulnerabilityText(vul), dealer: dealerFor(n, firstDealer), rubberNo };
    if (d.passedOut) {
      out[n] = { ...base, passedOut: true, nsScore: 0, ewScore: 0, nsPoints: 0, ewPoints: 0, scoredBy: null, bid: 'Passed out', winner: null, outcome: 'Passed out', below: 0, above: 0, game: false, rubberBonus: 0, note: '' };
      continue;
    }
    const err = validateDeal(d);
    if (err) throw new Error(err);
    const side = sideOf(d.declarer);
    const p = rubberDealParts(d, side === 'NS' ? vul.ns : vul.ew);
    const scorer = p.made ? side : other(side);
    let above = p.above, game = false, rubberBonus = 0, note = '';
    if (p.made) {
      below[side] += p.below;
      if (below[side] >= 100) {
        game = true;
        games[side] += 1;
        below = { NS: 0, EW: 0 };
        note = `Game to ${shortSide(side)}`;
        if (games[side] === 2) {
          rubberBonus = games[other(side)] === 0 ? RUBBER_BONUS_FAST : RUBBER_BONUS_SLOW;
          above += rubberBonus;
          note = `Rubber to ${shortSide(side)} ${games[side]}–${games[other(side)]} (+${rubberBonus})`;
          games = { NS: 0, EW: 0 };
          rubberNo += 1;
        }
      }
    }
    const total = p.below + above;
    const nsScore = scorer === 'NS' ? total : -total;
    out[n] = {
      ...base, passedOut: false,
      nsScore, ewScore: -nsScore, nsPoints: Math.max(nsScore, 0), ewPoints: Math.max(-nsScore, 0),
      scoredBy: total ? scorer : null,
      bid: contractText(d), winner: side, outcome: outcomeText(d),
      below: p.below, above, game, rubberBonus, note,
    };
  }
  const complete = [1, 2, 3, 4].every((n) => byNo.has(n));
  const extras = [];
  if (complete) {
    for (const side of ['NS', 'EW']) {
      if (games[side] === 1) extras.push({ side, points: UNFINISHED_GAME, why: 'one game up in an unfinished rubber' });
      if (below[side] > 0) extras.push({ side, points: UNFINISHED_PART, why: 'part-score in the unfinished game' });
    }
  }
  return { deals: out, vulBefore, state: { games: { ...games }, below: { ...below }, rubberNo }, complete, extras };
}

/** Totals for a rubber table — same shape as Chicago's sessionTotals. */
export function rubberTotals(table) {
  let nsPoints = 0, ewPoints = 0;
  const scored = Object.values(table.deals);
  for (const d of scored) { nsPoints += d.nsPoints; ewPoints += d.ewPoints; }
  for (const x of table.extras) { if (x.side === 'NS') nsPoints += x.points; else ewPoints += x.points; }
  const net = nsPoints - ewPoints;
  return {
    played: scored.length, complete: scored.length === 4,
    nsPoints, ewPoints, net, margin: Math.abs(net), leader: net > 0 ? 'NS' : net < 0 ? 'EW' : null,
  };
}
