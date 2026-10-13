// =============================================================
//  Chicago (four-deal) bridge scoring engine
//  Pure functions only — used by the server (authoritative) and by
//  the phone screens (live preview). No browser or database code here.
//
//  Agreed conventions (12 Oct 2026):
//   • Each deal is scored on its own, duplicate style (Law 77):
//     part-score +50, game +300/+500, slams, doubles, insult bonus.
//     No part-score carry-over, no deal-4 bonus. No honours.
//   • Vulnerability (standard Chicago): deal 1 neither; deals 2 and 3
//     the DEALER's side; deal 4 both. Dealer rotates N → E → S → W
//     from the session's first dealer.
//   • A passed-out deal scores 0 and still counts as one of the four.
//   • Only ONE pair scores on each board: the declarers if the contract
//     is made, the defenders if it goes down. Nobody ever has a negative
//     score. (Stored internally as one signed number, nsScore: + means the
//     points went to N/S, − means they went to E/W. nsPoints / ewPoints
//     are the positive points each pair received.)
//   • Vulnerability defaults to the Chicago rule but can be changed on any
//     board (vulNs / vulEw on the deal).
//   • Game result: each pair's total points over the four boards; the
//     higher total wins by the difference.
//   • Day ranking: total points won over the day.
// =============================================================

export const SCORING_VERSION = 1;

export const STRAINS = ['C', 'D', 'H', 'S', 'NT'];
export const SEATS = ['N', 'E', 'S', 'W'];
export const LEAD_RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
export const SUITS = ['S', 'H', 'D', 'C'];

export const strainSymbol = (s) => ({ C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[s] || s);
export const seatName = (s) => ({ N: 'North', E: 'East', S: 'South', W: 'West' }[s] || s);
export const sideOf = (seat) => (seat === 'N' || seat === 'S' ? 'NS' : 'EW');
export const sideName = (side) => (side === 'NS' ? 'North/South' : 'East/West');

// ---------- Chicago deal structure ----------

export function dealerFor(dealNo, firstDealer = 'N') {
  const start = SEATS.indexOf(firstDealer);
  if (start < 0) throw new Error(`Unknown first dealer: ${firstDealer}`);
  return SEATS[(start + dealNo - 1) % 4];
}

export function vulnerabilityFor(dealNo, firstDealer = 'N') {
  if (dealNo === 1) return { ns: false, ew: false };
  if (dealNo === 4) return { ns: true, ew: true };
  if (dealNo === 2 || dealNo === 3) {
    const side = sideOf(dealerFor(dealNo, firstDealer));
    return { ns: side === 'NS', ew: side === 'EW' };
  }
  throw new Error(`Deal number must be 1–4, got ${dealNo}`);
}

export function vulnerabilityText(v) {
  if (v.ns && v.ew) return 'Both vulnerable';
  if (v.ns) return 'N/S vulnerable';
  if (v.ew) return 'E/W vulnerable';
  return 'Neither vulnerable';
}

export const boardNumberFor = (dealNo, startBoard) => startBoard + dealNo - 1;

// ---------- Contract score (one deal, duplicate style) ----------

const PER_TRICK = { C: 20, D: 20, H: 30, S: 30, NT: 30 };

function contractTrickPoints(level, strain) {
  return strain === 'NT' ? 40 + 30 * (level - 1) : PER_TRICK[strain] * level;
}

function undertrickPenalty(down, vul, doubled) {
  if (doubled === '') return down * (vul ? 100 : 50);
  let p;
  if (vul) {
    p = 200 + (down - 1) * 300; // 200, 500, 800, 1100 ...
  } else {
    // 100, 300, 500, then 300 each
    p = down === 1 ? 100 : down === 2 ? 300 : 500 + (down - 3) * 300;
  }
  return doubled === 'XX' ? p * 2 : p;
}

function normaliseDoubled(d) {
  if (d == null || d === '' || d === 'No' || d === 'none') return '';
  if (d === 'X' || d === 'XX') return d;
  throw new Error(`Doubled must be '', 'X' or 'XX', got ${d}`);
}

/**
 * Validate a deal entry. Returns an error message, or null when valid.
 */
export function validateDeal(d) {
  if (d.passedOut) return null;
  if (!Number.isInteger(d.level) || d.level < 1 || d.level > 7) return 'Choose the contract level (1–7).';
  if (!STRAINS.includes(d.strain)) return 'Choose the suit or No Trumps.';
  if (!SEATS.includes(d.declarer)) return 'Choose the declarer.';
  try { normaliseDoubled(d.doubled); } catch { return 'Doubled must be none, X or XX.'; }
  if (!Number.isInteger(d.tricks) || d.tricks < 0 || d.tricks > 13) return 'Tricks must be between 0 and 13.';
  if (d.leadSuit && !SUITS.includes(d.leadSuit)) return 'Unknown lead suit.';
  if (d.leadRank && !LEAD_RANKS.includes(d.leadRank)) return 'Unknown lead card.';
  return null;
}

/**
 * Score for the DECLARING side (positive if made, negative if defeated).
 */
export function declarerScore({ level, strain, doubled, tricks }, vul) {
  const dbl = normaliseDoubled(doubled);
  const need = level + 6;
  if (tricks < need) return -undertrickPenalty(need - tricks, vul, dbl);

  const mult = dbl === 'XX' ? 4 : dbl === 'X' ? 2 : 1;
  const trickScore = contractTrickPoints(level, strain) * mult;
  const over = tricks - need;
  const overScore = over * (dbl === '' ? PER_TRICK[strain] : (vul ? 200 : 100) * (mult / 2));
  const levelBonus = trickScore >= 100 ? (vul ? 500 : 300) : 50;
  const slam = level === 7 ? (vul ? 1500 : 1000) : level === 6 ? (vul ? 750 : 500) : 0;
  const insult = dbl === 'X' ? 50 : dbl === 'XX' ? 100 : 0;
  return trickScore + overScore + levelBonus + slam + insult;
}

/**
 * Full result of one deal of a Chicago session.
 * deal: { dealNo, passedOut, level, strain, doubled, declarer, tricks, leadSuit, leadRank }
 */
export function vulForDeal(deal, firstDealer = 'N') {
  const def = vulnerabilityFor(deal.dealNo, firstDealer);
  return {
    ns: typeof deal.vulNs === 'boolean' ? deal.vulNs : def.ns,
    ew: typeof deal.vulEw === 'boolean' ? deal.vulEw : def.ew,
  };
}

export const pointsOf = (nsScore) => ({ ns: Math.max(nsScore, 0), ew: Math.max(-nsScore, 0) });

export function scoreDeal(deal, firstDealer = 'N') {
  const vul = vulForDeal(deal, firstDealer);
  const base = { dealNo: deal.dealNo, vul, vulText: vulnerabilityText(vul), dealer: dealerFor(deal.dealNo, firstDealer) };
  if (deal.passedOut) {
    return { ...base, passedOut: true, nsScore: 0, ewScore: 0, nsPoints: 0, ewPoints: 0, scoredBy: null, bid: 'Passed out', winner: null, outcome: 'Passed out' };
  }
  const err = validateDeal(deal);
  if (err) throw new Error(err);
  const side = sideOf(deal.declarer);
  const s = declarerScore(deal, side === 'NS' ? vul.ns : vul.ew);
  const nsScore = side === 'NS' ? s : -s;
  return {
    ...base,
    passedOut: false,
    nsScore,
    ewScore: -nsScore,
    nsPoints: Math.max(nsScore, 0),
    ewPoints: Math.max(-nsScore, 0),
    scoredBy: nsScore > 0 ? 'NS' : nsScore < 0 ? 'EW' : null,
    bid: contractText(deal),
    winner: side,
    outcome: outcomeText(deal),
  };
}

export function contractText(d) {
  if (d.passedOut) return 'Passed out';
  const dbl = normaliseDoubled(d.doubled);
  return `${d.level}${strainSymbol(d.strain)}${dbl ? ' ' + dbl : ''}`;
}

export function outcomeText(d) {
  if (d.passedOut) return 'Passed out';
  const diff = d.tricks - (d.level + 6);
  if (diff === 0) return 'Made exactly';
  if (diff > 0) return `Made, +${diff} overtrick${diff > 1 ? 's' : ''}`;
  return `Down ${-diff}`;
}

export function leadText(d) {
  if (!d.leadSuit && !d.leadRank) return '—';
  return `${d.leadSuit ? strainSymbol(d.leadSuit) : ''}${d.leadRank || ''}`;
}

// ---------- Session (four deals) ----------

/**
 * deals: array of scored deals (output of scoreDeal), any number 0–4.
 * nsPoints / ewPoints are the points each side won; net = nsPoints − ewPoints.
 */
export function sessionTotals(scoredDeals) {
  let nsPoints = 0, ewPoints = 0;
  for (const d of scoredDeals) {
    if (d.nsScore > 0) nsPoints += d.nsScore;
    else ewPoints += -d.nsScore;
  }
  const net = nsPoints - ewPoints;
  return {
    played: scoredDeals.length,
    complete: scoredDeals.length === 4,
    nsPoints,
    ewPoints,
    net,
    margin: Math.abs(net),
    leader: net > 0 ? 'NS' : net < 0 ? 'EW' : null,
  };
}

// ---------- Day summary ----------

export function pairKey(p1, p2) {
  return [p1, p2].map((n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase()).sort().join(' & ');
}

export function pairLabel(p1, p2) {
  return [p1, p2].map((n) => String(n || '').trim()).filter(Boolean).join(' & ');
}

/**
 * sessions: [{ id, nsP1, nsP2, ewP1, ewP2, firstDealer, deals: [raw deals] }]
 * Each game is one shared record, so no board is ever counted twice.
 * Ranking: total points won over the day (higher is better);
 * ties broken by average points per board.
 */
export function daySummary(sessions) {
  const acc = new Map();
  const touch = (key, label) => {
    if (!acc.has(key)) acc.set(key, { key, label, games: 0, completed: 0, boards: 0, points: 0, gamesWon: 0, nsBoards: 0, ewBoards: 0 });
    return acc.get(key);
  };
  for (const s of sessions) {
    const scored = (s.deals || []).map((d) => scoreDeal(d, s.firstDealer));
    if (!scored.length) continue;
    const t = sessionTotals(scored);
    const sides = [
      { side: 'NS', key: pairKey(s.nsP1, s.nsP2), label: pairLabel(s.nsP1, s.nsP2), pts: t.nsPoints },
      { side: 'EW', key: pairKey(s.ewP1, s.ewP2), label: pairLabel(s.ewP1, s.ewP2), pts: t.ewPoints },
    ];
    for (const x of sides) {
      if (!x.label) continue;
      const r = touch(x.key, x.label);
      r.games += 1;
      if (t.complete) r.completed += 1;
      if (t.complete && t.leader === x.side) r.gamesWon += 1;
      r.boards += t.played;
      r.points += x.pts;
      if (x.side === 'NS') r.nsBoards += t.played; else r.ewBoards += t.played;
    }
  }
  const rows = [...acc.values()].map((r) => ({ ...r, avgPerBoard: r.boards ? Math.round(r.points / r.boards) : 0 }));
  rows.sort((a, b) => b.points - a.points || b.avgPerBoard - a.avgPerBoard || a.label.localeCompare(b.label));
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (!prev || prev.points !== r.points || prev.avgPerBoard !== r.avgPerBoard) rank = i + 1;
    r.rank = rank;
    prev = r;
  });
  return rows;
}
