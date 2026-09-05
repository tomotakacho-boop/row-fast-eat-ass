# Row Fast Eat Ass Season 10 · Draft Room 2026

A standalone draft-day website for the 12-team ESPN full-PPR league **Row Fast Eat Ass Season 10**. This repository contains only this league’s room, configuration, player pool, watchlists, research models, mock-draft history interface, and Netlify deployment setup.

## League configuration

- Team: **Meet The Robinson's** · Tomotaka Cho
- Draft: 12-team snake · confirmed slot **#5**
- Draft time: September 8, 2026 at 6:30 PM Central
- Picks: **5, 20, 29, 44, 53, 68, 77, 92, 101, 116, 125, 140, 149, 164, 173, 188**
- Starters: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K
- Bench: 7; IR: 1
- Waivers: $100 FAAB
- Scoring: full PPR, 4-point passing touchdowns, −2 interceptions and fumbles lost

The confirmed draft order is Team Rex, Wet Willies, Juulio Jones, Shayshawn Broccoli, Meet The Robinson's, Eat The Boutte Like Groceries, OnlyFannins, Pukana Matatas, Rex On Rex, Two-Point Conversion Therapy, Goff Balls, and Kittle League.

## Included tools

- Integrated **Draft room** with a hard-CPU mock simulator and the complete sortable player research board
- Manual all-team drafting or automated CPU opponents
- On-demand Monte Carlo opportunity-cost simulations on your turns
- One-click Available, Taken, and My Pick controls
- Full-PPR ranks, Boris tiers, ADP, projections, PPG, per-game stats, expert range, confidence, and injury risk
- **Demo live draft board** with nine practice scenarios
- **Rankings & context** with all-position tiers, positional tiers, offensive environments, O-line context, K, and D/ST
- **Injuries & durability** with current availability and a transparent 0–100 relative risk index
- The complete shared **Like / Avoid / Rookie / Potential Diamond / League Winner** watchlist and source-linked rationale
- Ten draft-plan scenarios, roster construction, saved mock history, team grades, and full-roster reports
- Methods and sources for the ranking, projection, injury, research, and Monte Carlo layers

## Deploy on GitHub and Netlify

1. Create a new empty GitHub repository.
2. Upload this folder’s contents to the repository root. Do not upload `node_modules`, `.next`, `out`, or a ZIP archive.
3. In Netlify, select **Add new project → Import an existing project** and choose the new repository.
4. Netlify reads `netlify.toml`; the build command is `pnpm run build` and the publish directory is `out`.
5. Deploy. No Netlify environment variables are required for the checked-in snapshot.

Optional: add a GitHub Actions secret named `FANTASYPROS_API_KEY` if you have FantasyPros API access. The scheduled workflow refreshes the full-PPR player snapshot and shared research model each morning, commits changes, and triggers a new Netlify build.

## Local development

Requires Node.js 22+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

Production verification:

```bash
pnpm build
```

Manual data refresh:

```bash
pnpm refresh-data
pnpm build-research-models
```

## Data and persistence

- `public/data/players-full-ppr.json` is the complete league-specific player snapshot used by the site.
- `public/data/league-b-config.json` stores scoring, roster rules, draft order, and confirmed slot.
- `public/data/shared-watchlist.json` preserves the user-owned Like, Avoid, Potential Diamond, and League Winner seeds.
- `public/data/expert-watchlist.json`, `draft-research-2026.json`, `league-winners.json`, and `potential-diamonds.json` preserve the research and rationale behind those flags.
- `public/data/injury-overrides.json` is the dated source-linked injury correction layer used during refreshes.
- `public/data/research-models.json` stores O-line, team-environment, and historical durability context.

Personal draft status, editable watchlist changes, notes, plans, and mock history are saved in the current browser’s local storage. The repository seeds are available on every device, but changes made inside the deployed website do not automatically write back to GitHub. Export board JSON from **Methods & sources** if you want to move current browser state to another device.

## Important source files

- `app/RedraftBoard.tsx` — standalone league room and league-specific views
- `app/DraftRoomHub.tsx` — integrated simulator/research workspace
- `app/DemoLiveDraftBoard.tsx` — live practice board and mock history
- `app/monteCarloDraft.ts` — opportunity-cost simulation and draft grading
- `app/UnifiedWatchlist.tsx` — editable unified watchlist
- `app/TeamEnvironmentBoard.tsx` — team production and offensive-line context
- `app/InjuryResearchBoard.tsx` — injury and durability workspace
- `scripts/refresh-data.mjs` — full-PPR player data refresh
- `scripts/build-research-models.mjs` — team and durability model refresh
- `.github/workflows/refresh-data.yml` — scheduled GitHub data update
- `netlify.toml` — Netlify build settings
