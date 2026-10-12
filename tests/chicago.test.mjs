// Run with:  npm test   (Node 18+). No browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  declarerScore, scoreDeal, vulnerabilityFor, dealerFor, sessionTotals, daySummary,
  boardNumberFor, validateDeal, contractText, outcomeText, pairKey, leadText,
} from '../lib/chicago.js';

const NV = false, V = true;
const ds = (level, strain, tricks, vul, doubled = '') => declarerScore({ level, strain, tricks, doubled }, vul);

// ---------- Reference values from the standard duplicate scoring table ----------

test('part-scores, all five denominations, made exactly', () => {
  assert.equal(ds(1, 'C', 7, NV), 70);
  assert.equal(ds(1, 'D', 7, V), 70);
  assert.equal(ds(1, 'H', 7, NV), 80);
  assert.equal(ds(1, 'S', 7, V), 80);
  assert.equal(ds(1, 'NT', 7, NV), 90);
  assert.equal(ds(2, 'C', 8, NV), 90);
  assert.equal(ds(2, 'H', 8, NV), 110);
  assert.equal(ds(2, 'NT', 8, NV), 120);
  assert.equal(ds(3, 'D', 9, V), 110);
  assert.equal(ds(4, 'C', 10, NV), 130);
  assert.equal(ds(4, 'D', 10, V), 130);
});

test('games, non-vulnerable and vulnerable', () => {
  assert.equal(ds(3, 'NT', 9, NV), 400);
  assert.equal(ds(3, 'NT', 9, V), 600);
  assert.equal(ds(4, 'H', 10, NV), 420);
  assert.equal(ds(4, 'S', 10, V), 620);
  assert.equal(ds(5, 'C', 11, NV), 400);
  assert.equal(ds(5, 'D', 11, V), 600);
});

test('overtricks undoubled', () => {
  assert.equal(ds(2, 'H', 9, NV), 140);
  assert.equal(ds(3, 'NT', 10, NV), 430);
  assert.equal(ds(1, 'C', 9, V), 110);
  assert.equal(ds(4, 'S', 11, V), 650);
});

test('slams, all levels 6 and 7', () => {
  assert.equal(ds(6, 'C', 12, NV), 920);
  assert.equal(ds(6, 'H', 12, V), 1430);
  assert.equal(ds(6, 'NT', 12, NV), 990);
  assert.equal(ds(6, 'NT', 13, V), 1470);
  assert.equal(ds(7, 'D', 13, NV), 1440);
  assert.equal(ds(7, 'S', 13, V), 2210);
  assert.equal(ds(7, 'NT', 13, NV), 1520);
  assert.equal(ds(7, 'NT', 13, V), 2220);
});

test('doubled and redoubled contracts made', () => {
  assert.equal(ds(1, 'C', 7, NV, 'X'), 140);       // 40 + 50 + 50
  assert.equal(ds(2, 'S', 8, NV, 'X'), 470);       // 120 → game
  assert.equal(ds(2, 'S', 8, V, 'X'), 670);
  assert.equal(ds(1, 'NT', 7, NV, 'XX'), 560);     // 160 + 300 + 100
  assert.equal(ds(1, 'NT', 7, V, 'XX'), 760);
  assert.equal(ds(4, 'H', 11, NV, 'X'), 690);      // 240+300+50+100
  assert.equal(ds(4, 'H', 11, V, 'X'), 990);       // 240+500+50+200
  assert.equal(ds(3, 'D', 10, NV, 'XX'), 840);     // 240+300+100 + overtrick 200
  assert.equal(ds(3, 'D', 10, V, 'XX'), 1240);     // 240+500+100 + overtrick 400
  assert.equal(ds(6, 'NT', 12, V, 'X'), 1680);
  assert.equal(ds(7, 'NT', 13, V, 'XX'), 2980);
});

test('undertricks undoubled', () => {
  assert.equal(ds(4, 'S', 9, NV), -50);
  assert.equal(ds(4, 'S', 7, NV), -150);
  assert.equal(ds(3, 'NT', 8, V), -100);
  assert.equal(ds(7, 'NT', 6, V), -700);
});

test('undertricks doubled, non-vulnerable', () => {
  const pens = [100, 300, 500, 800, 1100, 1400, 1700];
  pens.forEach((p, i) => assert.equal(ds(7, 'S', 13 - 1 - i, NV, 'X'), -p, `down ${i + 1}`));
});

test('undertricks doubled, vulnerable', () => {
  const pens = [200, 500, 800, 1100, 1400, 1700, 2000];
  pens.forEach((p, i) => assert.equal(ds(7, 'S', 13 - 1 - i, V, 'X'), -p, `down ${i + 1}`));
});

test('undertricks redoubled', () => {
  assert.equal(ds(4, 'H', 9, NV, 'XX'), -200);
  assert.equal(ds(4, 'H', 7, NV, 'XX'), -1000);
  assert.equal(ds(4, 'H', 9, V, 'XX'), -400);
  assert.equal(ds(4, 'H', 6, V, 'XX'), -2200);
});

test('every level 1–7 in every strain makes exactly without error', () => {
  for (let level = 1; level <= 7; level++)
    for (const strain of ['C', 'D', 'H', 'S', 'NT'])
      for (const vul of [NV, V])
        for (const doubled of ['', 'X', 'XX']) {
          const s = ds(level, strain, level + 6, vul, doubled);
          assert.ok(s > 0, `${level}${strain}${doubled} vul=${vul}`);
        }
});

// ---------- Chicago structure ----------

test('standard Chicago vulnerability with North dealing first', () => {
  assert.deepEqual(vulnerabilityFor(1, 'N'), { ns: false, ew: false });
  assert.deepEqual(vulnerabilityFor(2, 'N'), { ns: false, ew: true });   // East deals → E/W vul
  assert.deepEqual(vulnerabilityFor(3, 'N'), { ns: true, ew: false });   // South deals → N/S vul
  assert.deepEqual(vulnerabilityFor(4, 'N'), { ns: true, ew: true });
});

test('vulnerability follows the dealer for other first dealers', () => {
  assert.deepEqual(vulnerabilityFor(2, 'E'), { ns: true, ew: false });   // South deals
  assert.deepEqual(vulnerabilityFor(3, 'E'), { ns: false, ew: true });   // West deals
  assert.deepEqual(vulnerabilityFor(2, 'W'), { ns: true, ew: false });   // North deals
  assert.equal(dealerFor(4, 'S'), 'E');
});

test('board numbers run consecutively from the starting board', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => boardNumberFor(n, 12)), [12, 13, 14, 15]);
});

test('declarer attribution and sign convention', () => {
  const v = (d, dealNo = 1) => scoreDeal({ dealNo, level: 3, strain: 'NT', doubled: '', tricks: 9, declarer: d }, 'N');
  assert.equal(v('N').nsScore, 400);
  assert.equal(v('S').nsScore, 400);
  assert.equal(v('E').nsScore, -400);
  assert.equal(v('W').ewScore, 400);
  assert.equal(v('E').winner, 'EW');
  // defeated contract: the defenders gain
  const down = scoreDeal({ dealNo: 1, level: 4, strain: 'S', doubled: 'X', tricks: 8, declarer: 'W' }, 'N');
  assert.equal(down.nsScore, 300);
  assert.equal(down.ewScore, -300);
  assert.equal(down.winner, 'EW'); // E/W won the auction even though they went down
  assert.equal(down.outcome, 'Down 2');
});

test('vulnerability is applied per deal to the declaring side', () => {
  // Deal 2, N dealt first → E/W vulnerable
  const ew = scoreDeal({ dealNo: 2, level: 4, strain: 'H', doubled: '', tricks: 10, declarer: 'E' }, 'N');
  assert.equal(ew.nsScore, -620);
  const ns = scoreDeal({ dealNo: 2, level: 4, strain: 'H', doubled: '', tricks: 10, declarer: 'N' }, 'N');
  assert.equal(ns.nsScore, 420);
  // Deal 4 both vulnerable
  assert.equal(scoreDeal({ dealNo: 4, level: 4, strain: 'H', doubled: '', tricks: 10, declarer: 'S' }, 'N').nsScore, 620);
});

test('passed-out deal scores zero and needs no contract', () => {
  const r = scoreDeal({ dealNo: 3, passedOut: true }, 'N');
  assert.equal(r.nsScore, 0);
  assert.equal(r.bid, 'Passed out');
  assert.equal(validateDeal({ passedOut: true }), null);
});

test('validation rejects incomplete entries', () => {
  assert.ok(validateDeal({ level: 8, strain: 'S', declarer: 'N', tricks: 9 }));
  assert.ok(validateDeal({ level: 3, strain: 'X', declarer: 'N', tricks: 9 }));
  assert.ok(validateDeal({ level: 3, strain: 'S', declarer: 'Q', tricks: 9 }));
  assert.ok(validateDeal({ level: 3, strain: 'S', declarer: 'N', tricks: 14 }));
  assert.equal(validateDeal({ level: 3, strain: 'S', declarer: 'N', tricks: 9, doubled: '' }), null);
});

test('text helpers', () => {
  assert.equal(contractText({ level: 2, strain: 'S', doubled: 'X' }), '2♠ X');
  assert.equal(contractText({ level: 3, strain: 'NT', doubled: '' }), '3NT');
  assert.equal(outcomeText({ level: 3, tricks: 9 }), 'Made exactly');
  assert.equal(outcomeText({ level: 3, tricks: 11 }), 'Made, +2 overtricks');
  assert.equal(outcomeText({ level: 3, tricks: 7 }), 'Down 2');
  assert.equal(leadText({ leadSuit: 'H', leadRank: '4' }), '♥4');
  assert.equal(leadText({}), '—');
});

// ---------- The agreed worked example (Option A, standard vulnerability) ----------

const example = [
  { dealNo: 1, level: 2, strain: 'H', doubled: '', declarer: 'N', tricks: 9 },
  { dealNo: 2, level: 2, strain: 'S', doubled: '', declarer: 'E', tricks: 8 },
  { dealNo: 3, level: 2, strain: 'C', doubled: '', declarer: 'S', tricks: 8 },
  { dealNo: 4, level: 3, strain: 'D', doubled: '', declarer: 'E', tricks: 10 },
];

test('worked example: four deals and the session net', () => {
  const scored = example.map((d) => scoreDeal(d, 'N'));
  assert.deepEqual(scored.map((d) => d.nsScore), [140, -110, 90, -130]);
  const t = sessionTotals(scored);
  assert.equal(t.nsPoints, 230);
  assert.equal(t.ewPoints, 240);
  assert.equal(t.net, -10);
  assert.equal(t.leader, 'EW');
  assert.equal(t.complete, true);
});

test('incomplete session is reported as incomplete', () => {
  const t = sessionTotals(example.slice(0, 3).map((d) => scoreDeal(d, 'N')));
  assert.equal(t.complete, false);
  assert.equal(t.played, 3);
});

// ---------- Day summary ----------

test('day summary adds each pair once per table and ranks by net', () => {
  const sessions = [
    { id: 'a', nsP1: 'Jon', nsP2: 'Mary', ewP1: 'Ann', ewP2: 'Bob', firstDealer: 'N', deals: example },
    { id: 'b', nsP1: 'Cath', nsP2: 'Dave', ewP1: 'mary ', ewP2: 'Jon', firstDealer: 'N', deals: [
      { dealNo: 1, level: 3, strain: 'NT', doubled: '', declarer: 'N', tricks: 9 }, // NS +400
    ] },
  ];
  const rows = daySummary(sessions);
  const jm = rows.find((r) => r.key === pairKey('Jon', 'Mary'));
  assert.equal(jm.sessions, 2);           // names matched regardless of order/case
  assert.equal(jm.boards, 5);
  assert.equal(jm.net, -10 - 400);
  assert.equal(jm.completed, 1);
  const ab = rows.find((r) => r.key === pairKey('Ann', 'Bob'));
  assert.equal(ab.net, 10);
  assert.equal(rows[0].label, 'Cath & Dave');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows.at(-1).key, pairKey('Jon', 'Mary'));
  // zero-sum across the room
  assert.equal(rows.reduce((s, r) => s + r.net, 0), 0);
});
