# Flinders Social Bridge — duplicate bridge scoring app

A phone-first web app for a club duplicate bridge evening. Each pair enters its
own results from its phone; every phone sees the live standings and every
board's traveller as soon as a result lands. Big type, big buttons, no clutter —
built for older players.

**Stack:** static frontend (plain HTML/CSS/JS, no build step) on **Vercel**,
**Supabase** Postgres for storage, and **Supabase Realtime** to push each new
score to every phone instantly. Source lives on **GitHub**.

---

## How it scores

- Duplicate **matchpoint pairs** — every result entered on a board is compared
  with the others on that board.
- N/S and E/W pairs are scored *separately* on each board, as standard, each
  from their own perspective.
- **Vulnerability + dealer are automatic** from the board number (board 1 = N
  dealer / none vul, board 2 = E / NS, and so on). You can override per board
  in setup, but that step is optional.
- **Contracts, scores and penalties** follow Scheme Law 77 (part scores, game,
  slam and doubled/redoubled premiums; doubled and redoubled overtricks and
  undertricks).
- Passed-out boards count as zero for both pairs.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | single-page shell |
| `app.js` | screens, Supabase + realtime, entry flow |
| `bridge.js` | pure scoring + matchpoint engine (also used by tests) |
| `bridge.test.mjs`  | 58 unit checks of the scoring engine |
| `styles.css` | large-type, paper-and-ink theme |
| `config.js` | your Supabase URL + anon key |
| `supabase/schema.sql` | run once in the Supabase SQL editor |

---

## Set up

### 1. Supabase (the database)

1. Create a free project at https://supabase.com (you'll need it to stay on
   free tier — this app's usage is tiny).
2. Open **SQL Editor → New query**, paste the whole contents of
   `supabase/schema.sql`, and run it. This creates the database tables,
   row-level security, and turns on Realtime for the results.
3. In **Project Settings → API**, copy:
   - **Project URL**, and
   - the **anon** public key.
4. Paste both into `config.js` (replacing the `PASTE_…` placeholders).

### 2. GitHub + Vercel (the hosting)

Either deploy the Vercel button style (import this repo, framework = "Other",
build command empty) or, from the CLI:

```bash
vercel    # deploy once — no build step, the site is static
```

That's it. Everyone opens the same URL on their phone. The organiser taps
**Set up session** to start a session, then each pair types its name and taps
**Join**.

### Testing the scoring engine locally (no browser needed)

```bash
node bridge.test.mjs     # requires Node 18+
```

> No Node handy? The same check runs under macOS's JavaScriptCore:
> `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
> --module-file=bridge.js bridge.test.mjs`

### Previewing the UI locally

```bash
python3 -m http.server 8000      # then open localhost:8000 on your phone
```

## Using it at the table

1. **Start** — the host creates a session and picks how many boards (default 24).
   Vulnerability is already correct; adjusting it is optional (tap a board to
   change it).
2. **Each pair joins** — type your pair name and choose N/S or E/W, then tap
   *Join today's session*. The name is remembered on the phone.
3. **Enter a result** — tap a board on your list: bid level, strain, doubled?,
   who declared, opening lead, tricks won. The score and live matchpoints appear
   before you save. Leave everything blank if the board was passed out.
4. After saving, the app shows **every result entered on that board** ("previous
   games of the same cards"), then offers the next board.
5. **Live results** — tap *Live results & standings* anytime; standings and a
   per-board list update as other pairs enter theirs.

## Notes & trade-offs

- **Security:** the app trusts the anon key (fine for a friendly club app). To
  harden it for public deployment, add auth and tighten the RLS policies in
  `schema.sql`.
- **Matchpoints** are plain within-board comparisons (`avLex`). Boards played at
  unequal numbers of pairs don't get a Neuberg adjustment (club use is fine).
- Each pair has one result per board (keyed by pair name), so last write wins
  only if the same pair name is used on two phones at once.