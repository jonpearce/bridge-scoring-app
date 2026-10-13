# Chicago Bridge — social four-deal scoring

A phone-first web app for recording social bridge games using **Chicago
(four-deal) scoring**. One person from each pair enters results; every
phone can compare results for the same board from other games, and a Day
summary ranks every pair.

**Stack:** plain HTML/CSS/JavaScript (no build step) · Vercel (hosting and
small server functions in `/api`) · Supabase (database) · GitHub (code).

---

## Words used

- **Game**: four boards played by two pairs (one Chicago).
- **Board**: one deal.

## Scoring rules used (agreed 12–13 Oct 2026)

| Rule | What the app does |
| --- | --- |
| Contract score | Each board scored on its own, duplicate style: trick points, overtricks, undertricks, +50 part-score, +300/+500 game, slams, doubled/redoubled, insult bonus. No part-score carry-over, no deal-4 bonus, no honours. |
| Who scores | **Only one pair scores on each board.** Made: the declaring pair gets the points. Down: the defending pair gets the penalty. Nobody ever has a negative score. |
| Vulnerability | Defaults to standard Chicago: deal 1 neither, deals 2 and 3 the **dealer's side**, deal 4 both (dealer rotates N → E → S → W from the first dealer). **It can be changed on the scoring screen for any board.** The vulnerability used is saved with the board. |
| Passed-out board | Nobody scores; it counts as one of the four. |
| Game result | Each pair's total points over the four boards; the higher total wins by the difference. |
| Day ranking | Total points each pair won over the day; ties broken by average points per board. Each game is one shared record, so no board is counted twice. |

Inside the database each board's score is one number, `ns_score`: + means
the points went to North/South, − means they went to East/West. The screens
only ever show the positive points each pair received.

The score is calculated on the server (`lib/chicago.js`, called from
`api/deal.js`). The phone shows a preview from the same file. Raw facts
(contract, declarer, tricks, lead, vulnerability) are stored so scores can be
recalculated.

---

## Using it during a game

1. **Open the app** and type the access code once. The phone stays let in
   for 30 days.
2. **Start a new game** (one person per game is enough): choose whether your
   pair is North/South or East/West, type the four names, and check the first
   board number and who deals first. Names are remembered.
   - The other pair can instead tap the game under **Join a game already
     started** and choose North/South or East/West.
3. **Enter each board:** tap *Enter board …*, then (if needed) change the
   vulnerability, then level → suit → (doubled?) → declarer → adjust tricks
   with − / + → optionally the lead suit and card → **Save result**. The
   score shows before you save.
   - *Board was passed out* records no score.
4. **Correct a mistake:** tap the board's card, change it, Save. The same
   record is updated. If the other phone saved or changed that board a moment
   earlier, you're told what it says before anything is overwritten.
5. **Other results:** compare every game's result for a board. The board
   entry screen also shows other games' results underneath.
6. **Day summary:** rankings for today (or an earlier day). Tap a pair for
   its board-by-board history.
7. **New game:** tap **Start a new game** on the game screen. It's the big
   button once four boards are in, and always available at the bottom. The
   next first board is suggested automatically. Each new day starts fresh on
   its own.

---

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `icon.svg` | The phone app |
| `lib/chicago.js` | Scoring engine (no browser or database code) |
| `api/login.js` | Checks the access code, sets a 30-day signed cookie |
| `api/sessions.js` | Start, edit and list games for a day |
| `api/deal.js` | Save or correct one board; calculates the official score |
| `api/_lib.js` | Shared server helpers (database access, cookie signing) |
| `tests/chicago.test.mjs` | Scoring tests |
| `tests/api.test.mjs` | Server tests against an in-memory database |
| `supabase/migrations/20261012_chicago_tables.sql` | Adds the new tables |
| `supabase/migrations/20261012_chicago_tables_ROLLBACK.sql` | Removes them again |
| `supabase/migrations/20261013_vulnerability_and_cleanup.sql` | Removes test games; adds the vulnerability columns |
| `supabase/migrations/20261013_vulnerability_ROLLBACK.sql` | Removes the vulnerability columns |
| `supabase/legacy-duplicate-schema.sql` | The old app's schema, kept for reference |

Run the tests (Node 18+): `npm test`

---

## Database

The new app uses three **new** tables. The old app's tables (`sessions`,
`boards`, `results`, `day_controllers`) are untouched.

| Table | One row per |
| --- | --- |
| `chi_events` | Playing day |
| `chi_sessions` | One game: first board, first dealer, four names (the `location` column holds a label made from the names) |
| `chi_deals` | One board in a game: contract, declarer, tricks, lead, vulnerability used, `ns_score`. Unique per game + deal number, so corrections never duplicate. Indexed by board number for comparisons. |

Board numbers identify a deal **within a playing day**. If separate events
ever reuse board numbers on the same day, add an event name to `chi_events`
(the table already allows several events per date).

**Security:** Row Level Security is on and the public key has no access to
the new tables. Only the server functions can read or write them, using
`SUPABASE_SERVICE_ROLE_KEY`, which is stored in Vercel and never sent to
phones.

## Settings (Vercel → Settings → Environment Variables)

| Name | Needed | Notes |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase secret key. Never put it in the code. |
| `ACCESS_CODE` | No | Defaults to `golf` |
| `SUPABASE_URL` | No | Defaults to this project's Supabase address |
| `APP_TIME_ZONE` | No | Defaults to `Australia/Melbourne` (decides what "today" is) |
