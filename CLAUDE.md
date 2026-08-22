# Project: Mosaicast – mosaicast-plugin-wiki

Site plugin: a simple wiki via the declarative schema provider (pages, revisions, search).

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the whole system. On conflict, this file wins.
- `docs/BRIEF.md` — what THIS repo builds, scope, public contract, tasks.

Read both fully before writing code. Work in plan mode first.

### `docs/BRIEF.md` is stale — known corrections
It predates SDK 0.4.0 and is a read-only spec, so the corrections live here instead of in it. Where it
disagrees with the SDK working tree or `mosaicast-plugin-sample`, the latter win.
- `platformApi` is **`0.8.0`** (exact `major.minor` match; the docs' `"1.x"` does not even parse). Pin the
  same string in all four places — `plugin.json`, both gradle coordinates, `package.json`.
- Its `site / main` slot **renders nowhere** — `main` is the *episode page body*. This plugin uses
  `placement: "page"` (scope `site`, required or `/p/wiki/*` is a real 404) plus `placement: "site"`.
  `placement: "admin"` also validates but renders nowhere, so podcaster tooling lives at `/p/wiki/_admin`.
- It has no `data` block. Absent, `readableBy` defaults to the **write** floor and anonymous reads 403 —
  against its own DoD. `readableBy: "anonymous"` is declared explicitly.
- Consent is `consent.services[]`; its `{ categories, externalSources }` shape is rejected since 0.4.0.

### Platform surfaces this plugin depends on
Both gaps this repo filed are **closed** — [core#81](https://github.com/Mosaicast/mosaicast-core/issues/81)
(file storage) and [core#82](https://github.com/Mosaicast/mosaicast-core/issues/82) (timestamped episode
links) shipped in SDK 0.8.0 / core 0.6.11+.
- **`ctx.blobs`** (manifest `blobs` block; `null` without one). **Store the `ref`, never the URL** —
  `urlFor(ref)` is derived at render time. **Nothing collects orphans**: the ingest tick deletes what the
  wiki stops pointing at. `quota()` is the only honest source for the effective limits (an admin grant
  *replaces* the manifest's ask). **SVG is never storable.** Uploads are served same-origin under `/api/`,
  so they need no CSP host and make no consent decision — prefer them to external URLs.
- **`ctx.links.episode(slug, { t })`** for citing a moment; `ctx.links.feed(slug, …)`. Never hardcode
  `/episodes/…` or `/feeds/…`.
- Core 0.6.12 ships its **own share dialog** on episodes, feeds and the site panel — do not build a second.
- **`--mc-icon-*` icons** (§12.3): the shell publishes its icon set as custom properties, which inherit
  through the shadow boundary — no SDK import, no `platformApi` bump, no version skew. See
  `frontend/src/icons.tsx`. Three rules, all pinned by tests: consume as a **mask** (a background image
  bakes in a colour and ignores the theme); give every reference the **blank fallback** (an unresolved
  `var()` reverts `mask-image` to `none`, painting a solid square); never **declare** into `--mc-*`.
  An icon is not a word — marks never go in a translated string.
- **Credit fields** `license`/`author`/`homepage`(/`attribution`) surface on the host's `/about` page.
  Unvalidated and additive: **never bump `platformApi` for them**, since that check is an exact
  `major.minor` match and a bump rejects every installed plugin.
- **Releases publish `plugin.tgz`** (`.github/workflows/release.yml`), so an operator can install by spec:
  `MOSAICAST_PLUGINS=Mosaicast/mosaicast-plugin-wiki@v<x>#sha256:<digest>`. The asset name is load-bearing
  and the workflow refuses a tag that disagrees with the manifest `version`.
- **The `?t=` grammar is shared** (§6.4). `WikiMarkdown.seconds` and `markdown.ts#parseTimestamp` are the
  *third and fourth* implementations of core's `util/timestamp.ts` / `web/TimestampParam.java`, held to
  the same case table: `754`, `12:04`, `1:02:03`, `1h02m03s`, `90m`; bounded fields, 24 h cap, unreadable
  values dropped. A link that previews as one moment and plays another is worse than one with no
  timestamp — so change all four together or none.
- **No request-time backend hook** (v1 contract, ARCHITECTURE §7.6) — hence the draft/ingest write path.
- **Unknown subpaths under `/p/wiki/` answer 200, not 404**
  ([core#89](https://github.com/Mosaicast/mosaicast-core/issues/89)) — the reader renders its own
  not-found view, but crawlers will index typos until core gains a route-existence hook.

## Tech stack
Java 21 (Gradle, PF4J extension) · React + Vite (Web Component)

## Commands
```
./build.sh                                      # -> dist/ (jar + assets/wiki.es.js + plugin.json)
cd backend  && ./gradlew test
cd frontend && npm test && npm run typecheck    # Vite does not type-check; tsc is what enforces it
```

## Live testing (do this every phase)
```
./build.sh && rm -rf ../mosaicast-core/plugins/wiki && cp -r dist ../mosaicast-core/plugins/wiki
cd ../mosaicast-core && dev/screenshots.sh up   # :8081, fleeting PG :5433, sample feed seeded
#   dev-login: POST /api/auth/dev-login?role=podcaster|fan|admin (prime /api/meta, send X-XSRF-TOKEN)
dev/screenshots.sh down
```
**Three ways this loop lies to you, all seen in practice:**
1. **`up` accepts a stale instance.** Its health check answers from an app that is already running, so a
   rebuilt plugin never loads and you test the previous build. After `down`, wait until
   `curl -sf localhost:8081/actuator/health` *fails* before `up`.
2. **Never wrap `up` in `timeout`, and don't background it.** The app is a grandchild of the call; when
   that call's process group is reaped the JVM dies mid-test. Symptom: `curl` starts returning `000`, and
   a fresh fleeting Postgres means every schema table looks empty — which reads exactly like a bug in
   your own code. Check `docker inspect -f '{{.State.StartedAt}}' mosaicast-shots` before believing it.
3. **Don't run `./build.sh` while the stack is up** — a second Gradle invocation can take the bootRun
   daemon with it. Build first, install, then boot.
Disposable and seeded only with the fictional sample feed — seeding and deleting wiki data there is free.
Core loads plugins **at startup only**: a rebuilt backend needs a restart (a rebuilt bundle does not).
Capture light + dark at 375×667, 768×1024, 1280×800 into `assets/screenshots/`; put them in the PR.

## npm lockfile gotcha (recurs on every dependency bump)
npm 11.16.0 records esbuild's 27 optional platform binaries as `extraneous`, so `npm ci` tries to install
netbsd-arm64 on an x64 runner and fails with EBADPLATFORM. npm 10 omits the entries entirely, which npm 11
then rejects as out of sync. After any dependency change, regenerate and correct:
```
rm -rf node_modules package-lock.json && npm install --ignore-scripts
# then rewrite each `"extraneous": true` to `"dev": true, "optional": true`
npm ci && npx npm@10 ci     # both must pass before pushing
```

## Page syntax (what the backend extracts and the reader renders)
```
[[the-kraken]]  [[the-kraken|label]]        wiki link; unresolved -> red link
[[episode:s01e02]]  [[episode:s01e02@12:04|label]]   episode link via ctx.links.episode(slug,{t})
![caption](blob:<ref>)                      an uploaded file, addressed by ref
## Sources  /  ## Quellen                   extracted to `source` rows and rendered from those
```
`WikiMarkdown` (backend) finds these with **regexes, not a parser** — a real parser would mean a shaded
JAR and PF4J classloading. The browser parses properly for rendering; anything the backend misses degrades
to a missing backlink, never a broken page. The reader strips the body's own Sources section, since the
structured rows replace it.

## Storage model (why two stores)
`schema` = read model (`plugin_wiki_*`, queried read-only from the frontend via `ctx.schema`).
Doc store = write channel: the editor writes `draft:<slug>`, the backend ingests on its schedule. **Saves
are eventually consistent** — surface that in the UI, never paper over it. Backend-owned keys (`index`,
`episodes`, `wikistats`, `ingest:*`) are written in `register()` **and** on the tick. Never reserve
`draft:*`/`delete:*` — the client writes those and reserving them would 403 the editor.

## Conventions (binding)
- Java packages `dev.mosaicast.*`; npm scope `@mosaicast`.
- Plugins import ONLY against the SDK, never against core code.
- The manifest `platformApi` must match the built SDK version.
- Never commit secrets; configure via `.env` / environment variables.
- Migrations exclusively via Flyway.
- **Tests are part of the work** (see DoD in the BRIEF, ARCHITECTURE §13.5; plugins test against the SDK test kit).
- **CI:** create and maintain `.github/workflows/ci.yml` (build + tests on every PR) as soon as the build exists; the Definition of Done includes green CI.
- **Document public APIs** (Javadoc/TSDoc); take SDK signatures from the built SDK docs, don't guess (§3.5).
- **Sign off commits** (`git commit -s`, DCO).
- **SPDX header in EVERY new source file**:
  `// SPDX-License-Identifier: AGPL-3.0-or-later`
  `// SPDX-FileCopyrightText: 2026 The Mosaicast Authors`
  Don't guess the copyright holder from git config — use this fixed value. CI blocks PRs without a header.

## Architecture guardrails (do not violate)
- Identity (`EpisodeRef`) is separate from presentation (feed snapshot). Runtime/date in the core display come from the feed; plugin metrics are non-authoritative and live only in the plugin UI.
- The host resolves scopes and decides access/filters — plugins only consume.
- The generic doc store is the default; schema tables only platform-mediated (declarative).

## Keep docs current (continuously)
- Keep **README.md** and **this CLAUDE.md** up to date (commands, structure, setup, conventions) — repo-local, your job.
- **ARCHITECTURE.md and BRIEF.md are READ-ONLY specs** — don't change them unilaterally; flag deviations.
- Keep CLAUDE.md slim (< ~200 lines); leave incidental learnings to Claude Code's auto memory.

## Plugin-dev skill (check before building)
This repo is meant to be built with the shared **writing-a-mosaicast-plugin** skill (from the `mosaicast-skills` marketplace). Before scaffolding or modifying plugin code, check whether that skill is among your available skills.
- Available -> use it.
- Not available -> **pause**, tell the user it's recommended and how to install it (see CONTRIBUTING -> "Recommended skill"), and proceed without it only if the user confirms.

## When unsure
Ask, or note the assumption visibly, instead of silently diverging from ARCHITECTURE.md.
