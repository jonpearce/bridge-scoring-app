# Flinders Chicago Bridge — social four-deal scoring

A phone-first web app for recording social bridge games using **Chicago
(four-deal) scoring**. One person from each pair enters results; every
phone can compare results for the same board from other tables, and a Day
summary ranks every pair.

**Stack:** plain HTML/CSS/JavaScript (no build step) · Vercel (hosting and
small server functions in `/api`) · Supabase (database) · GitHub (code).

---

## Words used

- **Table**: four boards played by two pairs (one Chicago).
- **Board**: one deal.

## Scoring rules used (agreed 12–13 Oct 2026)

| Rule | What the app does |
| --- | --- |
| Contract score | Each board scored on its own, duplicate style: trick points, overtricks, undertricks, +50 part-score, +300/+500 game, slams, doubled/redoubled, insult bonus. No part-score carry-over, no deal-4 bonus, no honours. |
| Who scores | **Only one pair scores on each board.** Made: the declaring pair gets the points. Down: the defending pair gets the penalty. Nobody ever has a negative score. |
| Vulnerability | Defaults to standard Chicago: deal 1 neither, deals 2 and 3 the **dealer's side**, deal 4 both (dealer rotates N → E → S → W from the first dealer). **It can be changed for any board — on the scoring screen, or by tapping the N/S or E/W vulnerability button on the board's tile on the table screen (each one switches on or off).** The vulnerability used is saved with the board. |
| Passed-out board | Nobody scores; it counts as one of the four. |
| Table result | Each pair's total points over the four boards; the higher total wins by the difference. |
| Sessions | The organiser starts a **new session** before play; every table then starts empty and all phones move to it. Earlier sessions can still be chosen from the **Session** list (date and start time) on Play, Other results and Day summary. |
| Day ranking | Total points each pair won in the chosen session; ties broken by average points per board. Each table is one shared record, so no board is counted twice. |

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
2. **Set up a new table** (one person per table is enough): choose whether your
   pair is North/South or East/West, type the four names, and check the first
   board number and who deals first. Names are remembered.
   - The other pair can instead tap the table under **Join a table already
     started**. If the phone already remembers that pair's two names, it joins
     straight away on the right side; otherwise it asks North/South or East/West.
   - Picked the wrong side? Tap **Swap** next to "You are …" on the table screen.
3. **Enter each board:** the next board to enter is highlighted in green; tap its *Enter result*, then (if needed) change the
   vulnerability, then level → suit → (doubled?) → declarer → adjust tricks
   with − / + → optionally the lead card and suit → **Save result**. The
   score shows before you save.
   - *Board was passed out* records no score.
   - **See previous Board Ns** (top right) shows every table's result for the
     board before this one; **Return to Board …** comes back with your entry
     untouched. It is greyed out until someone has entered that board.
4. **Correct a mistake:** tap the board's card, change it, Save. The same
   record is updated. If the other phone saved or changed that board a moment
   earlier, you're told what it says before anything is overwritten.
5. **Other results:** compare every table's result for a board. The board
   entry screen also shows other tables' results underneath.
6. **Day summary:** rankings for today (or an earlier day). Tap a pair for
   its board-by-board history.
7. **New table (next four boards, usually new opponents):** once all four
   boards are in, tap **All 4 boards done & displayed below: set up a new table**. The next first
   board is suggested automatically (it goes back to board 1 after the organiser
   clears the day, after logging out, or on a new day). To stop part-way, use **Leave this table**
   at the bottom, then choose **Set up a new table** or **Join a different table**;
   boards already saved are kept. Each new day starts fresh on
   its own.

8. **Log out:** at the bottom of the Play, Other results and Day summary screens, tap **Log out** (for
   example to log back in with the organiser code).
9. **Organiser (super-user):** log in with the organiser code instead of the
   players' code. On **Day summary**, an *Organiser* section lists every table
   that day with a **Delete** button, plus **Clear all tables on this day** to
   start completely fresh. Both ask "are you sure?" first and can't be undone.
   **Leave organiser mode (log out)** logs that phone out. Players never see these
   buttons, and the server refuses organiser actions from player phones.

---

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `app.js`, `styles.css`, `icon.svg` | The phone app |
| `lib/chicago.js` | Scoring engine (no browser or database code) |
| `api/login.js` | Checks the access code, sets a 30-day signed cookie |
| `api/sessions.js` | Start, edit and list tables for a day |
| `api/deal.js` | Save or correct one board; calculates the official score |
| `api/admin.js` | Organiser only: start a new session, delete a table, or clear a session |
| `api/_lib.js` | Shared server helpers (database access, cookie signing) |
| `tests/chicago.test.mjs` | Scoring tests |
| `tests/api.test.mjs` | Server tests against an in-memory database |
| `supabase/migrations/20261012_chicago_tables.sql` | Adds the new tables |
| `supabase/migrations/20261012_chicago_tables_ROLLBACK.sql` | Removes them again |
| `supabase/migrations/20261013_vulnerability_and_cleanup.sql` | Removes test tables; adds the vulnerability columns |
| `supabase/migrations/20261013_vulnerability_ROLLBACK.sql` | Removes the vulnerability columns |
| `supabase/legacy-duplicate-schema.sql` | The old app's schema, kept for reference |

Run the tests (Node 18+): `npm test`

---

## Database

The new app uses three **new** tables. The old app's tables (`sessions`,
`boards`, `results`, `day_controllers`) are untouched.

| Table | One row per |
| --- | --- |
| `chi_events` | Playing session (started by the organiser; its start time is shown in the Session list) |
| `chi_sessions` | One table: first board, first dealer, four names (the `location` column holds a label made from the names) |
| `chi_deals` | One board at a table: contract, declarer, tricks, lead, vulnerability used, `ns_score`. Unique per table + deal number, so corrections never duplicate. Indexed by board number for comparisons. |

Board numbers identify a deal **within a playing session**. If separate events
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
| `ACCESS_CODE` | No | Players' code. Defaults to `golf` |
| `ADMIN_CODE` | For organiser mode | The organiser's code word. Must be different from the players' code. If missing, organiser mode is off. |
| `SUPABASE_URL` | No | Defaults to this project's Supabase address |
| `APP_TIME_ZONE` | No | Defaults to `Australia/Melbourne` (decides what "today" is) |
