// =============================================================
// Duplicate bridge scoring engine (Law of Duplicate Contract Bridge 77)
// Works in the browser (ESM) and in Node for tests.
// =============================================================

export const STRAINS = ['C', 'D', 'H', 'S', 'NT'];

export const strainGlyph = (s) =>
  ({ C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[s] || s);

export const directionSide = (dir) => (dir === 'N' || dir === 'S' ? 'NS' : 'EW');

const TRICK_POINTS = { C: 20, D: 20, H: 30, S: 30, NT: 30 };

// Trick score for the bid tricks (NT: 40 for the first trick, then 30).
function trickPoints(level, strain) {
  if (strain === 'NT') return 40 + 30 * (level - 1);
  return TRICK_POINTS[strain] * level;
}

// Standard duplicate: dealer + vulnerability repeat every 4 boards.
// Board 1: dealer N, none vul | 2: E, NS vul | 3: S, EW vul | 4: W, both vul
export function boardInfo(boardNum) {
  const dealers = ['N', 'E', 'S', 'W'];
  const vuls = [
    { ns: false, ew: false },
    { ns: true, ew: false },
    { ns: false, ew: true },
    { ns: true, ew: true },
  ];
  const i = ((boardNum - 1) % 4 + 4) % 4;
  return { dealer: dealers[i], ns: vuls[i].ns, ew: vuls[i].ew };
}

export function vulnerabilityText(b) {
  if (b.ns && b.ew) return 'Both vul.';
  if (b.ns) return 'NS vul.';
  if (b.ew) return 'EW vul.';
  return 'Neither vul.';
}

/**
 * Raw N/S score for a played contract.
 * level: 1-7 (null = passed out); strain: C/D/H/S/NT
 * doubled: 'No' | 'X' | 'XX'; declarer: N/E/S/W; tricks: tricks won by declarer side
 * v: { ns, ew } vulnerability state of the board.
 */
export function makeScore(level, strain, doubled, tricks, declarer, v) {
  if (level == null) return 0; // passed out
  const declarerSide = directionSide(declarer);
  const vul = declarerSide === 'NS' ? v.ns : v.ew;
  const downBy = level + 6 - tricks;
  const ns = downBy > 0 ? -penalty(downBy, vul, doubled) : madeScore();
  return declarerSide === 'NS' ? ns : -ns;

  function madeScore() {
    const mv = doubled === 'XX' ? 4 : doubled === 'X' ? 2 : 1;
    const rawTrick = trickPoints(level, strain) * mv;
    const overtricks = tricks - (level + 6);
    const overtrick = overtricks > 0
      ? overtricks * (doubled === 'No' ? TRICK_POINTS[strain] : vul ? 200 * (mv / 2) : 100 * (mv / 2))
      : 0;
    const slam = level >= 6
      ? level === 7 ? (vul ? 1500 : 1000) : (vul ? 750 : 500)
      : 0;
    const insult = doubled === 'X' ? 50 : doubled === 'XX' ? 100 : 0;
    return rawTrick + overtrick + (rawTrick >= 100 ? (vul ? 500 : 300) : 50) + slam + insult;
  }

  function penalty(down, vind, d) {
    const base = (() => {
      if (d === 'No') return vind ? 100 : 50;
      if (!vind) {
        if (down <= 2) return down * 100 + (down === 2 ? 100 : 0);
        if (down === 3) return 500;
        return 800 + (down - 4) * 300;
      } else {
        if (down === 1) return 200;
        if (down <= 3) return (down - 1) * 300 + 200;
        return (down - 3) * 300 + 500;
      }
    })();
    return base * (d === 'XX' ? 2 : 1);
  }
}

export function displayContract(c) {
  if (!c || c.level == null) return 'Passed out';
  const d = c.doubled === 'No' ? '' : c.doubled === 'X' ? ' X' : ' XX';
  return `${c.level}${strainGlyph(c.strain)}${d}`;
}

// ---------- Matchpoint scoring ----------

/**
 * rows: results on ONE board. Each row is one pair's entry and carries
 *       `side` ('NS' | 'EW') plus the raw fields needed by makeScore.
 * boardV: { ns, ew } vulnerability state of that board.
 * Returns { rows: [scored], top } where each scored row adds:
 *   nsScore   raw N/S score of the contract
 *   ownScore  the score from that pair's own perspective (NS positive)
 *   points    matchpoints won by that pair on this board
 * Every result on the board is compared: an NS pair beats lower N/S scores,
 * an E/W pair beats higher N/S scores (its own score is the negative).
 */
export function scoreBoard(rows, boardV) {
  const withScore = rows.map((r) => ({
    ...r,
    nsScore: makeScore(r.contract_level, r.strain, r.doubled, r.tricks, r.declarer, boardV),
  }));

  const scored = withScore.map((r) => {
    let wins = 0, ties = 0;
    for (const o of withScore) {
      if (o === r) continue;
      const beats = r.side === 'EW' ? r.nsScore < o.nsScore : r.nsScore > o.nsScore;
      if (beats) wins++;
      else if (r.nsScore === o.nsScore) ties++;
    }
    const ownScore = r.side === 'EW' ? -r.nsScore : r.nsScore;
    return { ...r, ownScore, wins, ties, points: 2 * wins + ties };
  });

  return { rows: scored, top: (withScore.length > 0 ? withScore.length - 1 : 0) * 2 };
}

// Percentage of available matchpoints.
export const pct = (points, maxPoints) =>
  maxPoints ? Math.round((points / maxPoints) * 1000) / 10 : 0;

// Standings aggregated over every scored board. Pair identity is the name each
// pair entered on its own phone; a pair's matchpoints and raw score come from
// its own perspective on every board it played.
export function standings(byBoard) {
  const acc = new Map();
  for (const sb of Object.values(byBoard)) {
    for (const r of sb.rows) {
      if (!r.pair) continue;
      const cur = acc.get(r.pair) || { points: 0, max: 0, played: 0, score: 0 };
      cur.points += r.points;
      cur.max += sb.top;
      cur.score += r.ownScore;
      cur.played += 1;
      acc.set(r.pair, cur);
    }
  }
  return [...acc.entries()]
    .map(([label, s]) => ({ label, ...s, pct: pct(s.points, s.max) }))
    .sort((a, b) => b.points - a.points || b.pct - a.pct);
}