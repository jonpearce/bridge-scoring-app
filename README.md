# Chicago Bridge — social four-deal scoring

A phone-first web app for recording social bridge games using **Chicago
(four-deal) scoring**. One person from each pair enters results; every
phone can compare results for the same board from other tables, and a Day
summary ranks every pair.

**Stack:** plain HTML/CSS/JavaScript (no build step) · Vercel (hosting and
small server functions in `/api`) · Supabase (database) · GitHub (code).

---

## Scoring rules used (agreed 12 Oct 2026)

| Rule | What the app does |
| --- | --- |
| Contract score | Each deal scored on its own, duplicate style: trick points, overtricks, undertricks, +50 part-score, +300/+500 game, slams, doubled/redoubled, insult bonus. No part-score carry-over, no deal-4 bonus, no honours. |
| Vulnerability | Deal 1 neither · deals 2 and 3 the **dealer's side** · deal 4 both. The dealer rotates N → E → S → W from the first dealer chosen when the table starts. |
| Passed-out deal | Scores 0 and counts as one of the four. |
| Sign convention | Stored as one number `ns_score`: **+ means North/South gained, − means East/West gained.** The screens show both sides (e.g. N/S +400 · E/W −400). |
| Session result | Net points over the four deals (N/S points won minus E/W points won). |
| Day ranking | Each pair's total net points across every board they played that day; ties broken by average per board. Each table session is one shared record, so no board is counted twice. |

The score is calculated on the server (`lib/chicago.js`, called from
`api/deal.js`). The phone shows a preview from the same file. Raw deal facts
(contract, declarer, tricks, lead) are stored so scores can be recalculated.

---

## Using it at the table

1. **Open the app** on your phone and type the access code once. The phone
   stays let in for 30 days.
2. **Start a table** (one person per table is enough): enter where you are
   playing, the first board number, who deals first, which direction your
   pair is sitting, and the four names. Names and venue are remembered.
   - The other pair at the table can instead tap the table under **Join a
     table already started** and choose North/South or East/West.
3. **Enter each board:** tap *Enter board …*, then level → suit → (doubled?)
   → declarer → adjust tricks with − / + → optionally the lead suit and card
   → **Save result**. The score shows before you save.
   - *Board was passed out* records a zero.
4. **Correct a mistake:** tap the board's card, change it, Save. The same
   record is updated. If the other phone saved or changed that board a moment
   earlier, you're told what it says before anything is overwritten.
5. **Other results:** compare every table's result for a board. The board
   entry screen also shows other tables' results underneath.
6. **Day summary:** rankings for today (or an earlier day). Tap a pair for
   its board-by-board history.
7. After four boards, tap **Start the next session**. The next starting
   board is suggested automatically.

---

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `icon.svg` | The phone app |
| `lib/chicago.js` | Scoring engine (no browser or database code) |
| `api/login.js` | Checks the access code, sets a 30-day signed cookie |
| `api/sessions.js` | Start, edit and list table sessions for a day |
| `api/deal.js` | Save or correct one board; calculates the official score |
| `api/_lib.js` | Shared server helpers (database access, cookie signing) |
| `tests/chicago.test.mjs` | Scoring tests |
| `tests/api.test.mjs` | Server tests against an in-memory database |
| `supabase/migrations/20261012_chicago_tables.sql` | Adds the new tables |
| `supabase/migrations/20261012_chicago_tables_ROLLBACK.sql` | Removes them again |
| `supabase/legacy-duplicate-schema.sql` | The old app's schema, kept for reference |

Run the tests (Node 18+): `npm test`

---

## Database

The new app uses three **new** tables. The old app's tables (`sessions`,
`boards`, `results`, `day_controllers`) are untouched.

| Table | One row per |
| --- | --- |
| `chi_events` | Playing day |
| `chi_sessions` | Four-deal session at one table: venue, first board, first dealer, four names |
| `chi_deals` | Board played in a session: contract, declarer, tricks, lead, `ns_score`. Unique per session + deal number, so corrections never duplicate. Indexed by board number for comparisons. |

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
