# Project: Mosaicast – mosaicast-plugin-wiki

Site plugin: a simple wiki via the declarative schema provider (pages, revisions, search).

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the whole system. On conflict, this file wins.
- `docs/BRIEF.md` — what THIS repo builds, scope, public contract, tasks.

Read both fully before writing code. Work in plan mode first.

### `docs/BRIEF.md` is stale — known corrections
It predates SDK 0.4.0 and is a read-only spec, so the corrections live here instead of in it. Where it
disagrees with the SDK working tree or `mosaicast-plugin-sample`, the latter win.
- `platformApi` is **`0.7.1`** (exact `major.minor` match; the docs' `"1.x"` does not even parse).
- Its `site / main` slot **renders nowhere** — `main` is the *episode page body*. This plugin uses
  `placement: "page"` (scope `site`, required or `/p/wiki/*` is a real 404) plus `placement: "site"`.
  `placement: "admin"` also validates but renders nowhere, so podcaster tooling lives at `/p/wiki/_admin`.
- It has no `data` block. Absent, `readableBy` defaults to the **write** floor and anonymous reads 403 —
  against its own DoD. `readableBy: "anonymous"` is declared explicitly.
- Consent is `consent.services[]`; its `{ categories, externalSources }` shape is rejected since 0.4.0.

### Platform gaps this plugin is designed around
- **No blob/upload surface for plugins** ([core#81](https://github.com/Mosaicast/mosaicast-core/issues/81)) —
  media is external URLs only; the `media` entity gains an `uploadRef` column additively when it lands.
- **No timestamped episode links** ([core#82](https://github.com/Mosaicast/mosaicast-core/issues/82)) —
  a page can cite an episode, but not a moment in one.
- **No request-time backend hook** (v1 contract, ARCHITECTURE §7.6) — hence the draft/ingest write path.

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
Disposable and seeded only with the fictional sample feed — seeding and deleting wiki data there is free.
Core loads plugins **at startup only**: a rebuilt backend needs a restart (a rebuilt bundle does not).
Capture light + dark at 375×667, 768×1024, 1280×800 into `assets/screenshots/`; put them in the PR.

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
