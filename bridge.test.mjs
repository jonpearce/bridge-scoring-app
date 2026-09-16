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

// Matchpoints on one board (3 tables):
// T1 NS plays 4S making 620 (vul),   T2 NS plays 3NT+1 = 630,  T3 NS plays 4S-1 = -100
let rows = [
  { table_num: 1, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10, ns_pair: 'P1', ew_pair: 'P2' },
  { table_num: 2, contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'N', tricks: 10, ns_pair: 'P3', ew_pair: 'P4' },
  { table_num: 3, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 9, ns_pair: 'P5', ew_pair: 'P6' },
];
let b = scoreBoard(rows, VUL);
check('board top', b.top, 4);
check('T1 points (620 beats one, loses to 630)', b.rows[0].points, 2);
check('T2 points (630 beats both)', b.rows[1].points, 4);
check('T3 points (beats none)', b.rows[2].points, 0);
check('T2 wins', b.rows[1].wins, 2);

// Standings merge by pair name across tables
rows = [
  { table_num: 1, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10, ns_pair: 'The Club', ew_pair: 'Rivals' },
  { table_num: 2, contract_level: 3, strain: 'NT', doubled: 'No', declarer: 'S', tricks: 11, ns_pair: 'The Club', ew_pair: 'Odds' },
];
const byBoard = { 22: scoreBoard(rows, VUL) };
const st = standings(byBoard, rows.map((r) => ({ ...r, board_num: 22, side: 'NS' })));
check('standings leader merged first', st[0] && st[0].label, 'The Club');
check('standings played', st[0] && st[0].played, 2);

// standings EW labelled
rows = [
  { table_num: 3, contract_level: 2, strain: 'H', doubled: 'No', declarer: 'E', tricks: 8, ns_pair: 'Ann', ew_pair: 'Zed' },
];
const byBoard2 = { 5: scoreBoard(rows, NV) };
const st2 = standings(byBoard2, rows.map((r) => ({ ...r, board_num: 5, side: 'EW' })));
check('standings EW labelled', st2[0] && st2[0].label, 'Zed');

// EW and NS matchpoints on the same board are scored separately:
// T1 & T2 both make 4S as N/S (+620), T3 makes 4S as E/W (-620 to N/S).
rows = [
  { table_num: 1, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'N', tricks: 10, ns_pair: 'A', ew_pair: 'X' },
  { table_num: 2, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'S', tricks: 10, ns_pair: 'B', ew_pair: 'Y' },
  { table_num: 3, contract_level: 4, strain: 'S', doubled: 'No', declarer: 'W', tricks: 10, ns_pair: 'C', ew_pair: 'Z' },
];
b = scoreBoard(rows, VUL);
check('NS ties share top points', b.rows[0].points, 3);
check('NS loser gets none', b.rows[2].points, 0);
check('EW winner gets top', b.rows[2].ewPoints, 4);
check('EW losers tie each other', b.rows[0].ewPoints, 1);
const stb = standings({ 9: b }, [
  { ...rows[0], board_num: 9, side: 'NS' },
  { ...rows[1], board_num: 9, side: 'NS' },
  { ...rows[2], board_num: 9, side: 'EW' },
]);
check('EW pair in standings leads with 4', stb[0].label, 'Z');

out(`\n${pass} passed, ${fail} failed`);
if (typeof process !== 'undefined') process.exit(fail ? 1 : 0);