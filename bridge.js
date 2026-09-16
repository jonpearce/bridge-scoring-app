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
 * rows: results on ONE board, each with table_num and the raw fields needed
 *       by makeScore.
 * boardV: { ns, ew } vulnerability state of that board.
 * Returns { rows: [scored], top } where each scored row adds:
 *   nsScore, points (N/S matchpoints), ewPoints (E/W matchpoints — each
 *   pair's score is the negation of the declaring side's because N/S and E/W
 *   are scored separately on the same board).
 */
export function scoreBoard(rows, boardV) {
  const withScore = rows.map((r) => ({
    ...r,
    nsScore: makeScore(r.contract_level, r.strain, r.doubled, r.tricks, r.declarer, boardV),
  }));

  const matchpoints = (get) => {
    const byTable = new Map();
    for (const r of withScore) {
      let wins = 0, ties = 0;
      for (const o of withScore) {
        if (o.table_num === r.table_num) continue;
        if (get(r) > get(o)) wins++;
        else if (get(r) === get(o)) ties++;
      }
      byTable.set(r.table_num, { wins, ties, points: 2 * wins + ties });
    }
    return byTable;
  };

  const nsMP = matchpoints((r) => r.nsScore);
  const ewMP = matchpoints((r) => -r.nsScore);

  const scored = withScore.map((r) => ({
    ...r,
    ...nsMP.get(r.table_num),
    ewPoints: ewMP.get(r.table_num).points,
  }));

  return { rows: scored, top: (withScore.length > 0 ? withScore.length - 1 : 0) * 2 };
}

// Percentage of available matchpoints.
export const pct = (points, maxPoints) =>
  maxPoints ? Math.round((points / maxPoints) * 1000) / 10 : 0;

// Standings aggregated over every scored board. Pair identity is the free
// text name recorded for that table's NS or EW seat; same name at different
// tables is merged (handles manual movement). N/S and E/W pairs are scored
// from their own perspectives on each board.
export function standings(byBoard, allResults) {
  const acc = new Map();
  allResults.forEach((r) => {
    const label = r.side === 'NS' ? r.ns_pair : r.ew_pair;
    if (!label) return;
    const sb = byBoard[r.board_num];
    const mine = sb && sb.rows.find((x) => x.table_num === r.table_num);
    if (!mine) return;
    const pts = r.side === 'EW' ? mine.ewPoints : mine.points;
    const score = r.side === 'EW' ? -mine.nsScore : mine.nsScore;
    const cur = acc.get(label) || { points: 0, max: 0, played: 0, score: 0 };
    cur.points += pts;
    cur.max += sb.top;
    cur.score += score;
    cur.played += 1;
    acc.set(label, cur);
  });
  return [...acc.entries()]
    .map(([label, s]) => ({ label, ...s, pct: pct(s.points, s.max) }))
    .sort((a, b) => b.points - a.points || b.pct - a.pct);
}