# Parity

Stats and salaries for the [OCUA Parity League](https://www.ocua.ca/Parity-League), a league where we record stats for every game, turn them into (fake) player salaries, and teams have to stay under a salary cap to keep things balanced.

Production: https://parity.kevinhughes27.workers.dev/ / https://parity.ocua.ca

This is Parity 3.0. Previous versions (2014-2026) were a Python server with an Android stat keeping app in [kevinhughes27/parity-server](https://github.com/kevinhughes27/parity-server), now archived. This repo's history starts with a single commit of the v2 code at `20ee02d`, where v3 branched, followed by the v3 development commits.

## How it works

There is no server to run. Parity is one [Cloudflare Worker](https://developers.cloudflare.com/workers/) that serves three things:

- **The React app**: the stats site, and the stat keeper which records games offline in the browser and uploads them when they are done.
- **The API** at `/api/:league/...`, which the app uses and anyone can use to get the data out (see API below).
- **The daily Zuluru sync**, a cron trigger that keeps the current league's rosters and schedule up to date from OCUA's Zuluru site while its season is being played.

Each league's data lives in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) (`worker/league.ts`), which holds the league's teams, schedule and games. A game is stored as it was recorded, a list of points and their events. Stats and salaries are computed from the events whenever they are asked for; the largest season ever takes ~40ms, so nothing is precomputed or stored.

### Durable Objects

If you haven't used them: a Durable Object is a small class with its own private SQLite database, and Cloudflare runs it for you.

- You get one by name (we use the league id). Cloudflare starts it when a request for it arrives and puts it to sleep when it's idle, which costs nothing. There is no server or database to set up.
- Its database stays with it between requests. We read and write it with plain SQL (`this.ctx.storage.sql`), and the tables are created the first time it runs (`SCHEMA` in `worker/league.ts`, append only).
- It handles one request at a time, so there are no locks or race conditions to think about.
- The Worker calls its methods directly (`stub.stats(...)`), like calling a function on another machine.

In development the same thing runs locally inside `./dev up`, with the databases in `.wrangler/state`.

## Leagues

Every league is a separate Durable Object named by the league's id. They don't share anything and nothing ever reads more than one of them at a time, so a season can't affect any other season and each one stays small.

`shared/leagues.json` is the list of leagues. It is bundled into both the app and the Worker, the first entry is the current league: the one the stat keeper records games for and the Zuluru sync updates.

The app spans leagues without knowing about Durable Objects. The league picker chooses a league from the list and every page asks for `/api/<league>/...`, which the Worker hands to that league's Durable Object.

**Adding a league** is adding it to the top of `leagues.json` and deploying (see New season). There is no other setup: a Durable Object exists as soon as the Worker asks for it, and it creates its tables the first time it is used. The data arrives from the Zuluru sync and the stat keeper.

**League ids are forever.** They name the Durable Object and are in every link. Taking a league out of the list only hides it, its data stays where it was.

**The dev league.** In development (`./dev up`) the list has one more league, id 0, that only exists on your machine. It is the current league, so the stat keeper records games into it, and it fills itself with made up teams, a schedule and a couple of games the first time it is used. The real leagues show production's data so there is something real to look at. They are read only: only GET requests are proxied, anything that would change them stays local. See the development branch in `worker/index.ts` and `worker/dev.ts`.

## API

All data is public and CORS enabled. `:league` is the league id from `/api/leagues`.

|                                             |                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/leagues`                          | all leagues                                                          |
| `GET /api/:league/export`                   | everything for a league: teams, schedule, games with every event     |
| `GET /api/:league/stats`                    | season stats per player                                              |
| `GET /api/:league/weeks` and `/weeks/:week` | weeks played and stats for one week                                  |
| `GET /api/:league/players`                  | salaries                                                             |
| `GET /api/:league/teams` and `/schedule`    | rosters and upcoming games                                           |
| `GET /api/:league/games` and `/games/:id`   | games (`?includePoints=true` for events) and one game with its stats |
| `PUT /api/:league/games/:id`                | save a game from the stat keeper (safe to retry)                     |

Admin (basic auth, user `admin`): `POST /api/:league/games/:id` edit, `DELETE /api/:league/games/:id`, `POST /api/:league/import`, `POST /api/:league/zuluru_sync`.

`/docs` is an interactive version of this list (Swagger UI, requests can be tried out), generated from `public/openapi.json`. Keep the spec in sync when the API changes.

## Development

Everything runs in a container via `./dev` (needs [podman](https://podman.io)), so node, yarn and wrangler never run directly on your machine.

```sh
./dev setup          # install dependencies, create .dev.vars (local secrets)
./dev up             # the whole app at http://localhost:5173, Worker + Durable Objects included
```

The app opens on the dev league (see Leagues). The other leagues are read only from production — you can browse their real data but not change it. Local Durable Object data lives in `.wrangler/state`, delete it to reset the dev league. The local admin password is `dev` (see `.dev.vars`).

### Tests

```sh
./dev check          # type-check, format check and unit tests
./dev e2e            # the stat keeper in a real browser
```

The e2e tests (`e2e/`) drive the stat keeper through whole games against a production build of the app, then check what was saved in the league's Durable Object. Each test starts with a fresh league from `e2e/fixtures.ts`. The test server uses in memory storage so it never touches your local data. `./dev e2e -g basic` runs matching tests, `./dev e2e --headed` opens a browser window so you can watch. If `./dev up` is running the tests use it (and its dev league); otherwise they build the app (~10s) and boot their own server.

## Deploying

```sh
./dev wrangler login        # login to cloudflare
./dev deploy                # build and deploy production
./dev wrangler tail         # production logs
```

The first `./dev deploy` publishes the Worker and app to your account's `workers.dev` subdomain at `https://parity.<account>.workers.dev`. There is no database or other service to create: a league's Durable Object (and its tables) is created the first time the Worker asks for it. Authenticate once with `./dev wrangler login`.

`wrangler.jsonc` declares the Worker's secrets as required, and Cloudflare only lets you `wrangler secret put` on a Worker that already exists. So the first deploy has to supply them in a git-ignored file called `prod.secrets`:

```
ADMIN_PASSWORD=your-admin-password
ZULURU_USER=your-ocua-username
ZULURU_PASSWORD=your-ocua-password
```

Then:

```sh
./dev deploy --secrets-file prod.secrets
```

Secret values can be replaced but never read back:

```sh
./dev wrangler secret put ADMIN_PASSWORD     # for editing/deleting games in the web UI
./dev wrangler secret put ZULURU_USER        # an OCUA account that can see rosters
./dev wrangler secret put ZULURU_PASSWORD
```

### Importing

`scripts/import_v2.ts` copies leagues between servers and can read a v2 sqlite database. To import the v2 data into the live Worker:

```sh
ADMIN_PASSWORD=... ./dev import_v2 --to https://parity.kevinhughes27.workers.dev --all --from v2.sqlite
```

Without `--all` only the current league is imported. Importing replaces everything in each target league and needs the target Worker's `ADMIN_PASSWORD`, passed through from the host.

### New season

1. Find the Zuluru page that lists the Parity teams. OCUA sets up some seasons as their own Zuluru league and others as a division of a bigger league, so it is either `.../zuluru/leagues/view?league=1234` or `.../zuluru/divisions/view?division=5678`.
2. Add the league to the top of `shared/leagues.json` with that url as `zuluru`, then deploy.
3. The next daily sync fills in the teams and schedule, or sync right away: `curl -u admin:$PASSWORD -X POST https://parity.ocua.ca/api/<league>/zuluru_sync`.

### Zuluru sync

Once a day the Worker logs in to OCUA's Zuluru with the `ZULURU_USER` and `ZULURU_PASSWORD` secrets, scrapes the current league's teams and schedule, and replaces them in the current league's Durable Object. Only the Worker has the credentials. Durable Objects just store what they are given and never sync anything themselves.

The sync only ever touches the current league, and it stops a week after the league's last scheduled game (playoffs are scheduled week by week) so a finished season keeps the rosters it ended with. Adding the next season to `leagues.json` starts it again. `POST /api/<league>/zuluru_sync` (admin) syncs right away, again only for the current league.

When it breaks (Zuluru changes its pages, the password changes) it fails before changing anything: rosters and the schedule stay as they were, and stat keepers can still add anyone missing as a sub. The error shows up in the logs (`./dev wrangler tail` or the dashboard) and in the response from the admin endpoint.

### Backups

Durable Objects can be restored to any point in the last 30 days. For anything longer save the exports, e.g. `curl https://parity.ocua.ca/api/24/export > 24.json`.

### For another organization

Nothing in the data is specific to OCUA, but the deployment is. To run Parity for another organization fork the repo and deploy it to your own Cloudflare account (your Durable Objects are your own, nothing is shared with OCUA's):

1. Replace `shared/leagues.json` with your leagues. Line size, stat values and the salary formula are set per league.
2. Rosters: the Zuluru sync (`worker/zuluru.ts`) scrapes OCUA's site. Point it at your own Zuluru, or set `zuluru` to `null` and load teams with `POST /api/:league/import` before any games are recorded (import replaces everything in the league).
3. Set your time zone (`TIME_ZONE` in `worker/index.ts`, used for upcoming games) and where development reads real leagues from (`PRODUCTION` in `worker/dev.ts`).
4. Deploy it (see Deploying) on your own domain.

## Contributing

PRs welcome! If you play in the league and want to help out, get in touch on slack or by email.
