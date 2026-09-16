// Verifies the scoring engine against known duplicate-bridge values.
import { makeScore, scoreBoard, boardInfo, standings } from './bridge.js';

const out = typeof console !== 'undefined' ? console.log : print;
let pass = 0, fail = 0;
function check(desc, got, want) {
  if (got === want) { pass++; }
  else { fail++; out(`FAIL ${desc}  got ${got}  want ${want}`); }
}

const NV = { ns: false, ew: false };
const VUL = { ns: true, ew: true };
const NSV = { ns: true, ew: false };

// Made contracts (declarer N = NS side, score positive)
check('4S+0 nv', makeScore(4,'S','No',10,'N',NV), 420);
check('4S+0 vul', makeScore(4,'S','No',10,'N',VUL), 620);
check('3NT+0 nv', makeScore(3,'NT','No',9,'N',NV), 400);
check('3NT+0 vul', makeScore(3,'NT','No',9,'N',VUL), 600);
check('2S+0', makeScore(2,'S','No',8,'N',NV), 110);
check('1NT+0', makeScore(1,'NT','No',7,'N',NV), 90);
check('2C+0 (2x20=40 partscore)', makeScore(2,'C','No',8,'N',NV), 90);
check('5D+0', makeScore(5,'D','No',11,'N',NV), 400);
check('5D+0 vul', makeScore(5,'D','No',11,'N',VUL), 600);
// Slam
check('6NT+0 nv', makeScore(6,'NT','No',12,'N',NV), 990);
check('6NT+0 vul', makeScore(6,'NT','No',12,'N',VUL), 1440);
check('6C+0 nv', makeScore(6,'C','No',12,'N',NV), 920);
check('7NT+0 nv', makeScore(7,'NT','No',13,'N',NV), 1520);
check('7NT+0 vul', makeScore(7,'NT','No',13,'N',VUL), 2220);
// Overtricks
check('3S+1 nv', makeScore(3,'S','No',10,'N',NV), 170);
check('3S+1 vul', makeScore(3,'S','No',10,'N',VUL), 170);
check('4S+2 vul', makeScore(4,'S','No',12,'N',VUL), 680);
// Doubled / redoubled
check('4SX made nv', makeScore(4,'S','X',10,'N',NV), 590);
check('4SX+1 nv', makeScore(4,'S','X',11,'N',NV), 690);
check('4SXX made vul', makeScore(4,'S','XX',10,'N',VUL), 1080);
check('1NTX+1 vul', makeScore(1,'NT','X',8,'N',VUL), 380);
check('5CX made vul', makeScore(5,'C','X',11,'N',VUL), 750);
// Undertricks (declarer NS, so negative)
check('4S-1 nv', makeScore(4,'S','No',9,'N',NV), -50);
check('4S-1 vul', makeScore(4,'S','No',9,'N',VUL), -100);
check('4SX-1 nv', makeScore(4,'S','X',9,'N',NV), -100);
check('4SX-1 vul', makeScore(4,'S','X',9,'N',VUL), -200);
check('4SX-3 nv', makeScore(4,'S','X',7,'N',NV), -500);
check('4SX-4 nv', makeScore(4,'S','X',6,'N',NV), -800);
check('4SX-2 vul', makeScore(4,'S','X',8,'N',VUL), -500);
check('4SX-3 vul', makeScore(4,'S','X',7,'N',VUL), -800);
check('5CX-2 vul', makeScore(5,'C','X',9,'N',VUL), -500);
check('4SXX-2 nv', makeScore(4,'S','XX',8,'N',NV), -600);
check('7NTX-1 nv', makeScore(7,'NT','X',12,'N',NV), -100);
// EW declarer flips sign
check('4S+0 by E (EW side, positive for EW = negative NS)', makeScore(4,'S','No',10,'E',NV), -420);
check('1NT+0 by W nv', makeScore(1,'NT','No',7,'W',NV), -90);
// Passed out
check('passed out', makeScore(null,'S','No',0,'N',NV), 0);
// Vul rules: NS vulnerable but declarer EW => uses EW vul
check('E makes 4S, EW vul', makeScore(4,'S','No',10,'E',{ns:true,ew:true}), -620);

// boardInfo
check('board1 dealer', boardInfo(1).dealer, 'N');
check('board1 vul', JSON.stringify([boardInfo(1).ns, boardInfo(1).ew]), '[false,false]');
check('board2', JSON.stringify([boardInfo(2).dealer, boardInfo(2).ns, boardInfo(2).ew]), '["E",true,false]');
check('board3', JSON.stringify([boardInfo(3).dealer, boardInfo(3).ns, boardInfo(3).ew]), '["S",false,true]');
check('board4', JSON.stringify([boardInfo(4).dealer, boardInfo(4).ns, boardInfo(4).ew]), '["W",true,true]');
check('board25 rolls over', JSON.stringify([boardInfo(25).dealer, boardInfo(25).ns]), '["N",false]');

// Matchpoints on one board, all pairs sitting N/S:
// P1 plays 4S making 620 (vul), P3 plays 3NT+1 = 630, P5 plays 4S-1 = -100
let rows = [
  { pair: 'P1', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10 },
  { pair: 'P3', side: 'NS', contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'N', tricks: 10 },
  { pair: 'P5', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 9 },
];
let b = scoreBoard(rows, VUL);
check('board top', b.top, 4);
check('P1 points (620 beats one, loses to 630)', b.rows[0].points, 2);
check('P3 points (630 beats both)', b.rows[1].points, 4);
check('P5 points (beats none)', b.rows[2].points, 0);
check('P3 wins', b.rows[1].wins, 2);

// N/S and E/W pairs are scored from their own perspective on the same board:
// A sits N/S and makes 4S (+420), Z sits E/W and holds 4S to 9 tricks (-50).
rows = [
  { pair: 'A', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10 },
  { pair: 'Z', side: 'EW', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 9 },
];
b = scoreBoard(rows, NV);
check('NS own score', b.rows[0].ownScore, 420);
check('EW own score is negated N/S score', b.rows[1].ownScore, 50);
check('NS pair beats the EW result', b.rows[0].points, 2);
check('EW pair beats the NS result', b.rows[1].points, 2);

// Standings aggregate each pair's matchpoints across boards.
const raw = [
  { board_num: 1, pair: 'The Club', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 11 },
  { board_num: 1, pair: 'Odds', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10 },
  { board_num: 1, pair: 'Rivals', side: 'NS', contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'N', tricks: 9 },
  { board_num: 2, pair: 'The Club', side: 'NS', contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'N', tricks: 9 },
  { board_num: 2, pair: 'Odds', side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 9 },
  { board_num: 2, pair: 'Rivals', side: 'NS', contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'N', tricks: 10 },
];
const grouped = {};
for (const r of raw) (grouped[r.board_num] ||= []).push(r);
const byBoard = {};
for (const [bn, rs] of Object.entries(grouped)) byBoard[bn] = scoreBoard(rs, NV);
const st = standings(byBoard);
check('standings leader', st[0].label, 'The Club');
check('standings played', st[0].played, 2);
check('standings points summed', st[0].points, 6);
check('standings max summed', st[0].max, 8);
check('standings has everyone', st.length, 3);

// A pair scoring with no results or no name is ignored.
check('standings ignores unnamed', standings({ 5: scoreBoard([{ side: 'NS', contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10 }], NV) }).length, 0);

out(`\n${pass} passed, ${fail} failed`);
if (typeof process !== 'undefined') process.exit(fail ? 1 : 0);