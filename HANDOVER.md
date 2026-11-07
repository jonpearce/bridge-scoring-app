# Flinders Bridge App — Handover

7 Nov 2026 · Jon (jonjp@mac.com)

> **For an AI assistant picking this up:** read this file first, then `README.md`. The code on `main` is what is live. Don't push to `main` during a playing session, never change or drop existing database tables (add new ones only, each with a `_ROLLBACK.sql`), and run `npm test` before every push. Jon is not a coder: give him step-by-step instructions for anything he has to do himself.

## At a glance

Flinders Bridge is a phone web app that scores Chicago (four-board) bridge for a social group of 3–5 tables. It has been live since 13 Oct 2026; the last code change was on 4 Nov 2026.

| Item | Detail |
| --- | --- |
| Live address | [bridge-scoring-app.vercel.app](https://bridge-scoring-app.vercel.app) |
| Code | [github.com/jonpearce/bridge-scoring-app](https://github.com/jonpearce/bridge-scoring-app), branch `main` (full instructions in README.md) |
| Hosting | Vercel project `bridge-scoring-app`, Hobby plan; every push to `main` deploys automatically |
| Database | Supabase project `jykxfndrmdbgwbdedgzg` |
| Technology | Plain HTML/CSS/JavaScript (no build step) plus small Vercel server functions in `api/` |
| Owner / contact | Jon — jonjp@mac.com (also shown to players when the database is down) |
| Latest deployment | 235bbca (4 Nov: stay awake) |

## Access and codes

Players log in with a shared code; the organiser uses a second, secret code. Both are read from Vercel environment variables (`api/_lib.js`).

| Code | Where it is set | Current state |
| --- | --- | --- |
| Player code | Vercel → bridge-scoring-app → Settings → Environment Variables → `ACCESS_CODE` | Not set as of 20 Oct, so the built-in default `golf` applies |
| Organiser code | Same place → `ADMIN_CODE` | Set (secret). Must differ from the player code or organiser mode is switched off |

**To change a code:**

1. Open Vercel → bridge-scoring-app → Settings → Environment Variables.
2. Add (or edit) `ACCESS_CODE` or `ADMIN_CODE` with the new word.
3. Go to Deployments → newest deployment → ⋯ → **Redeploy**. The new code only works after this.
4. Tell players the new word.

**Accounts the next person needs:** the GitHub account `jonpearce` (or collaborator access to the repo), the Vercel account that owns `bridge-scoring-app`, and the Supabase account that owns project `jykxfndrmdbgwbdedgzg`.

**Security model:** phones never talk to the database directly. Every read and write goes through the Vercel server functions, which check the code. All tables have row-level security on and the public key has no access.

## How it is built

Phone screens (`index.html`, `app.js`) → Vercel server functions (`api/`) → Supabase tables. The server calculates every score; the phone shows a preview using the same file.

| File | What it does |
| --- | --- |
| `index.html`, `app.js` | All screens (`DB_SLEEP_MSG`, `sleepBlock`, `splashHtml`, `setSplash` live here) |
| `styles.css` | Look and feel (`.btn.go` green buttons, `.card.sleep`, `body.splash`) |
| `lib/chicago.js` | Contract scoring and Chicago rules; `VUL_ORDER_FROM` (vulnerability cut-over time), `setStartFor` (sets of four boards) |
| `lib/rubber.js` | Rubber bridge scoring |
| `api/_lib.js` | Shared server code: code checks, `DB_DOWN_MESSAGE`, `logEvent` (activity log, gives up after 1.5 s) |
| `api/login.js`, `api/sessions.js`, `api/deal.js`, `api/admin.js` | Log-in, tables/sessions, saving boards, organiser actions |
| `api/log.js` | Receives activity-log batches from phones |
| `tests/*.test.mjs` | `chicago`, `rubber` and `api` tests — run with `npm test` |
| `supabase/migrations/` | Every database change, dated, each with a matching `_ROLLBACK.sql` |

**Database tables** (Supabase `jykxfndrmdbgwbdedgzg`, checked 7 Nov 2026)

| Table | Holds | Rows (7 Nov) |
| --- | --- | --- |
| `chi_events` | Sessions (playing days) | 3 |
| `chi_sessions` | Tables / games; `scoring` = 'chicago' or 'rubber' | 48 |
| `chi_deals` | Boards; `saved_by` = phone that last saved it | 150 |
| `chi_settings` | Organiser switches: `vul_locked`, `scoring_mode` | 1 |
| `chi_added_names`, `chi_hidden_names`, `chi_name_fixes` | Player name list and spelling fixes | 0 / 0 / 1 |
| `chi_log` | Activity log, kept 120 days | 288 |

The old matchpoint app's tables (`sessions`, `boards`, `results`, `day_controllers`) have been removed (`20261013_remove_old_app.sql`).

## Scoring rules

Each board is scored on its own, duplicate style, and only one pair scores per board, so nobody goes negative. The day is ranked by total points won.

- No part-score carry-over and no honours.
- Declarers score if the contract makes; defenders score if it goes down.
- A passed-out board scores nothing but still counts as one of the four.
- Game result = each pair's total points.
- In the database each board's score is one number, `ns_score`: + to North/South, − to East/West.

**Vulnerability** (same at every table, whoever deals). Every saved board stores its own vulnerability, so changing the order never changes old scores.

| In force | Deal 1 | Deal 2 | Deal 3 | Deal 4 |
| --- | --- | --- | --- | --- |
| From 4 Nov 2026, 2:05 pm (current) | Neither | N/S | E/W | Both |
| 21 Oct – 4 Nov | N/S | E/W | Both | Neither |
| Before 21 Oct | Neither | Dealer's side | Dealer's side | Both |

Tables set up before 4 Nov 2:05 pm keep the 21 Oct order for unplayed boards. The cut-over time is `VUL_ORDER_FROM` in `lib/chicago.js`. (README.md still describes the original rule in places; this file and the live notes are current.)

**Vulnerability lock** — organiser switch on Day summary, locked by default (`vul_locked` in `chi_settings`; no row = locked). Locked means nobody can change vulnerability; the server enforces it. Unlocked, it can be changed only on the board tiles of the table screen.

**Rubber bridge option** (from 28 Oct) — organiser switch "Scoring: Chicago / Rubber bridge" (`scoring_mode`; no row = Chicago). It applies only to tables set up after switching; each table's choice is fixed in `chi_sessions.scoring`.

- Trick points below the line add up across boards; 100 = game, then part-scores are wiped.
- A side with a game is vulnerable automatically. First to 2 games wins +700 (2–0) or +500 (2–1); a new rubber then starts with nobody vulnerable.
- If the 4-board round ends mid-rubber: +300 to a side with one game, +100 to a side with a part-score in the unfinished game ("End of round").
- Saving or correcting a board re-scores the later boards at that table.
- After Save, a yellow pencil-style rubber score sheet replaces the keypad (font Caveat, loaded only when shown); "Change this board" brings the keypad back.

## How players use it

A pair sets up a table, plays four boards entering each result, then moves on to the next set of four. Players cannot see other tables' results for a board until they have entered it themselves.

**A typical round**

1. Log in with the player code (dark green splash screen). The screen stays awake while the app is open (Android Chrome; iPhone iOS 16.4+).
2. Play tab → set up a table: four names (suggested from past names) and board numbers. Numbers come in sets of four (1–4, 5–8…); typing 7 gives Boards 5–8.
3. **Start playing** (green) goes straight to Board 1. Enter Contract, Declarer, Opening lead, Tricks → **Save result**.
4. After Save the screen stays put and shows "At other tables" for that board, then **Next: Board N ›**.
5. After four boards: **Play the next 4 boards ›** → set up the next round (numbers +4, names filled in) or join a table already started.

**Safeguards built in**

- Names matching an existing one, ignoring capitals and spaces, are saved with the existing spelling. The same player twice at a table is refused.
- Setting up a table that already exists (same four players, exactly the same boards, same session) offers **Join that table** or **Set up a separate table**.
- Two phones on one board: a phone changing the other phone's result is asked first; if both saved different results, "Saved on another phone" shows both with **Save again** or **Cancel**. Same result = no question.
- Board numbers changed on one phone appear on the other within 20 seconds.
- **Start again on this phone** clears what the phone remembers (table, names, half-entered boards) but keeps saved results and the login.

**Viewing results:** Other results shows a board grid (faint green ✓ on boards this pair has played) and a page per board with ‹ › arrows. Day summary ranks everyone and highlights this phone's pair in gold with "You". Hiding unplayed boards is done on the phone only, so a determined player with browser developer tools could still see them.

## Organiser tasks

Everything the organiser does is on Day summary after entering the organiser code. The panel holds: Start a new session · Scoring (Chicago / Rubber) · Vulnerability lock · Edit names… · Activity log… · Tables in this session (Delete each) · Clear all tables · Leave organiser mode.

| Task | How |
| --- | --- |
| Start a playing day | Day summary → **Start a new session** |
| Switch to rubber bridge | Scoring switch → "Use Rubber" → confirm. Affects new tables only |
| Allow vulnerability changes | Turn the lock off; change it on the table screen's board tiles; turn it back on |
| Correct a finished table's board | Open the table → dashed gold **Organiser: correct a board ›** (players don't see it) |
| Fix a misspelt name everywhere | Edit names… → **Fix spelling**. If the right spelling exists, the two scores merge permanently. Refused if both spellings sat at one table |
| Add / hide / restore a name | Edit names… |
| Remove a duplicate table | Tables in this session → Delete. A full copy goes into the activity log, so it can be restored by hand |
| See what happened | **Activity log…** — newest first, this session; tick to include every screen change |

**Activity log** (`chi_log`, kept 120 days) is the record to use: Vercel's own logs keep only 1 hour on the Hobby plan. It records logins (never the code typed), wrong codes, tables set up, boards saved and corrected, every refusal and error, and every organiser action. Each phone has a random id (first 4 characters shown) and the pair names it last played as.

## Making changes and rolling back

Changes go live by pushing to `main` on GitHub; a bad release is undone in Vercel in about a minute by promoting an earlier deployment. Saved results are in the database, so rolling back the app never deletes them.

**Before changing anything**

- Run `npm test` and check every test passes.
- Database changes: add new tables or columns only, as a new dated file in `supabase/migrations/` with a matching `_ROLLBACK.sql`; never alter or drop existing ones.
- Changing the database-down wording means changing both `DB_DOWN_MESSAGE` (`api/_lib.js`) and `DB_SLEEP_MSG` (`app.js`).
- Avoid deploying during a playing session.
- After a change, update this file and the "Rollback" list.

**To roll back**

1. Vercel → bridge-scoring-app → Deployments.
2. Pick the earlier deployment you want (by commit, table below).
3. ⋯ → **Promote to Production**.
4. To return to the latest, promote the newest deployment the same way.

| Commit | Date | Change |
| --- | --- | --- |
| 235bbca | 4 Nov | Screen stays awake (current) |
| 9f44ac1 | 4 Nov | Played-board ticks |
| 85ebf3e | 4 Nov | Two phones on one board |
| e3d95ab | 4 Nov | Save again / Cancel on conflicts |
| 14ea8b6 | 4 Nov | Splash-style opening screen |
| 27af97c | 4 Nov | Day summary "You" highlight |
| e1249f2 | 4 Nov | Sets of four; green go buttons |
| 9dab1c2 | 4 Nov | Exact-boards duplicate check |
| e59a9ee | 4 Nov | Vul order, names/duplicates, Play tab, activity log |
| 7765716 | 29 Oct | Score sheet suit symbols |
| 8ce788f | 29 Oct | Rubber score sheet after save |
| 093ec48 | 28 Oct | Rubber bridge option |
| cc80312 | 21 Oct | Vul order + lock, fix spelling |

**Cautions:** rolling back before 093ec48 makes rubber tables show Chicago scores until you roll forward. Rolling back before e59a9ee loses the activity log and duplicate checks, and before cc80312 brings back the old vulnerability rule for new boards.

## Known issues and open items

The app is stable; the main loose end is the player code.

- [ ] **Set a real player code.** `ACCESS_CODE` isn't set, so the default `golf` (visible in this public repo) works. Add it in Vercel and redeploy (see Access and codes).
- [ ] **Reduce Vercel storage.** Vercel reported 75% usage; old deployments are candidates for clearing.
- [ ] **Check remaining duplicate tables from 4 Nov.** The 10:01 and 10:03 copies were deleted on 4 Nov; check Day summary for any other doubled tables set up before the duplicate check.
- [ ] **Consider making the repo private.** It is public, so anyone can read the code.
- [ ] **Bring README.md up to date** with the current vulnerability rule and lock.

**Known limits (by design):**

- Hiding other tables' results is done on the phone, not the server.
- iPhone Low Power Mode can still dim the screen.
- Merging two names with Fix spelling can't be undone.
- Activity log entries older than 120 days are removed.

## Where to find more

- **README.md** in this repo — set-up and full instructions.
- **Live notes** (claude.ai Project "Chicago Bridge Scoring", file `claude/chicago-app-live-notes.md`, updated 4 Nov) — every feature with its date and the complete rollback list.
- **Activity log** in the app (Day summary → Activity log…) — what actually happened on a playing day.
