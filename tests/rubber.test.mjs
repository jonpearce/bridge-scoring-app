// Rubber bridge engine. Run with:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRubberTable, rubberTotals, rubberDealParts } from '../lib/rubber.js';
import { daySummary } from '../lib/chicago.js';

const D = (dealNo, level, strain, declarer, tricks, doubled = '') => ({ dealNo, passedOut: false, level, strain, declarer, tricks, doubled });
const P = (dealNo) => ({ dealNo, passedOut: true });

test('below / above the line for one deal', () => {
  assert.deepEqual(rubberDealParts({ level: 2, strain: 'S', tricks: 9, doubled: '' }, false), { made: true, below: 60, above: 30 });
  assert.deepEqual(rubberDealParts({ level: 3, strain: 'NT', tricks: 9, doubled: '' }, false), { made: true, below: 100, above: 0 });
  // 2♠ doubled, vulnerable, +1: 120 below; 200 overtrick + 50 insult above
  assert.deepEqual(rubberDealParts({ level: 2, strain: 'S', tricks: 9, doubled: 'X' }, true), { made: true, below: 120, above: 250 });
  // 1♣ redoubled non-vul +1: 80 below; 200 overtrick + 100 insult
  assert.deepEqual(rubberDealParts({ level: 1, strain: 'C', tricks: 8, doubled: 'XX' }, false), { made: true, below: 80, above: 300 });
  // 6♥ vul made: 180 below, 750 slam above
  assert.deepEqual(rubberDealParts({ level: 6, strain: 'H', tricks: 12, doubled: '' }, true), { made: true, below: 180, above: 750 });
  // Down: penalties, same table as duplicate
  assert.deepEqual(rubberDealParts({ level: 4, strain: 'S', tricks: 9, doubled: 'X' }, false), { made: false, below: 0, above: 100 });
  assert.deepEqual(rubberDealParts({ level: 4, strain: 'S', tricks: 8, doubled: '' }, true), { made: false, below: 0, above: 200 });
});

test('no part-score or game bonus; part-scores add up to a game', () => {
  const t = scoreRubberTable([D(1, 2, 'S', 'N', 9), D(2, 2, 'H', 'S', 8)]);
  assert.equal(t.deals[1].nsScore, 90);          // 60 below + 30 above, no +50
  assert.equal(t.deals[1].game, false);
  assert.equal(t.deals[2].nsScore, 60);          // 60 below — and that makes 120 = game
  assert.equal(t.deals[2].game, true);
  assert.equal(t.deals[2].note, 'Game to N/S');
  assert.deepEqual(t.vulBefore[1], { ns: false, ew: false });
  assert.deepEqual(t.vulBefore[2], { ns: false, ew: false });
  assert.deepEqual(t.vulBefore[3], { ns: true, ew: false });   // N/S won a game → vulnerable
  assert.deepEqual(t.state.below, { NS: 0, EW: 0 });
});

test('fast rubber 2–0 gets 700, then a new rubber starts with nobody vulnerable', () => {
  const t = scoreRubberTable([D(1, 4, 'S', 'N', 10), D(2, 3, 'NT', 'S', 9), D(3, 1, 'C', 'E', 7), P(4)]);
  assert.equal(t.deals[1].nsScore, 120);
  assert.equal(t.deals[2].rubberBonus, 700);
  assert.equal(t.deals[2].nsScore, 800);         // 100 below + 700
  assert.equal(t.deals[2].note, 'Rubber to N/S 2–0 (+700)');
  assert.deepEqual(t.vulBefore[2], { ns: true, ew: false });
  assert.deepEqual(t.vulBefore[3], { ns: false, ew: false });
  assert.equal(t.deals[3].rubberNo, 2);
  assert.equal(t.deals[3].ewPoints, 20);
  // End of round: E/W have 20 below in an unfinished game → +100
  assert.deepEqual(t.extras, [{ side: 'EW', points: 100, why: 'part-score in the unfinished game' }]);
  const tot = rubberTotals(t);
  assert.equal(tot.nsPoints, 920);
  assert.equal(tot.ewPoints, 120);
  assert.equal(tot.complete, true);
});

test('slow rubber 2–1 gets 500; vulnerability follows the games', () => {
  const t = scoreRubberTable([D(1, 4, 'H', 'E', 10), D(2, 4, 'S', 'N', 10), D(3, 5, 'D', 'W', 11), P(4)]);
  assert.deepEqual(t.vulBefore[2], { ns: false, ew: true });
  assert.deepEqual(t.vulBefore[3], { ns: true, ew: true });
  assert.equal(t.deals[3].rubberBonus, 500);
  assert.equal(t.deals[3].ewPoints, 600);
  assert.deepEqual(t.vulBefore[4], { ns: false, ew: false });
  assert.deepEqual(t.extras, []);
});

test("opponents' game wipes a part-score", () => {
  const t = scoreRubberTable([D(1, 2, 'S', 'N', 8), D(2, 4, 'H', 'E', 10), P(3), P(4)]);
  assert.deepEqual(t.state.below, { NS: 0, EW: 0 });
  assert.deepEqual(t.extras, [{ side: 'EW', points: 300, why: 'one game up in an unfinished rubber' }]);
});

test('unfinished rubber: game up and part-score both counted', () => {
  const t = scoreRubberTable([D(1, 3, 'NT', 'N', 9), D(2, 2, 'C', 'W', 8), P(3), P(4)]);
  assert.deepEqual(t.extras, [
    { side: 'NS', points: 300, why: 'one game up in an unfinished rubber' },
    { side: 'EW', points: 100, why: 'part-score in the unfinished game' },
  ]);
});

test('going down: only the defenders score, at the declarers\' vulnerability', () => {
  const t = scoreRubberTable([D(1, 3, 'NT', 'N', 9), D(2, 4, 'S', 'S', 8, 'X')]);
  assert.equal(t.deals[2].ewPoints, 500);        // N/S vulnerable, down 2 doubled
  assert.equal(t.deals[2].nsPoints, 0);
  assert.equal(t.deals[2].scoredBy, 'EW');
});

test('extras only once all four boards are in; missing boards change nothing', () => {
  const t = scoreRubberTable([D(1, 3, 'NT', 'N', 9), D(3, 1, 'C', 'E', 7)]);
  assert.equal(t.complete, false);
  assert.deepEqual(t.extras, []);
  assert.deepEqual(t.vulBefore[2], { ns: true, ew: false });
  assert.deepEqual(t.vulBefore[3], { ns: true, ew: false });
});

test('day summary can use rubber totals; Chicago tables unaffected', () => {
  const rubber = { nsP1: 'A', nsP2: 'B', ewP1: 'C', ewP2: 'D', firstDealer: 'N', scoring: 'rubber', deals: [D(1, 3, 'NT', 'N', 9), P(2), P(3), P(4)] };
  const chicago = { nsP1: 'A', nsP2: 'B', ewP1: 'E', ewP2: 'F', firstDealer: 'N', deals: [D(1, 3, 'NT', 'N', 9)] };
  const plain = daySummary([chicago]);
  const mixed = daySummary([chicago, rubber], (s) => (s.scoring === 'rubber'
    ? rubberTotals(scoreRubberTable(s.deals, s.firstDealer))
    : daySummary.length && { played: s.deals.length, complete: false, nsPoints: 600, ewPoints: 0, leader: 'NS' }));
  assert.equal(plain.find((r) => r.label === 'A & B').points, 600);   // Chicago 3NT vul = 600
  assert.equal(mixed.find((r) => r.label === 'A & B').points, 600 + 100 + 300);
});
