# Project: Mosaicast – mosaicast-plugin-wiki

Site plugin: a simple wiki via the declarative schema provider (pages, revisions, search).

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the whole system. On conflict, this file wins.
- `docs/BRIEF.md` — what THIS repo builds, scope, public contract, tasks.

Read both fully before writing code. Work in plan mode first.

### `docs/BRIEF.md` is stale — known corrections
It predates SDK 0.4.0 and is a read-only spec, so the corrections live here instead of in it. Where it
disagrees with the SDK working tree or `mosaicast-plugin-sample`, the latter win.
- `platformApi` is **`0.12.0`** (exact `major.minor` match; the docs' `"1.x"` does not even parse). Pin the
  same string in all four places — `plugin.json`, both gradle coordinates, `package.json`. Nothing is a
  literal: `manifest.test.ts` compares the manifest and the npm pin against the SDK's own
  `PLATFORM_API_VERSION`, and `ci.yml` compares the manifest against both gradle coordinates.
- Its `site / main` slot **renders nowhere** — `main` is the *episode page body*. This plugin uses
  `placement: "page"` (scope `site`, required or `/p/wiki/*` is a real 404) plus `placement: "site"`.
  `placement: "admin"` also validates but renders nowhere, so podcaster tooling lives at `/p/wiki/_admin`.
- It has no `data` block. Absent, `readableBy` defaults to the **write** floor and anonymous reads 403 —
  against its own DoD. `readableBy: "anonymous"` is declared explicitly.
- Consent is `consent.services[]`; its `{ categories, externalSources }` shape is rejected since 0.4.0.
- It predates languages: §30's "page content is author data" holds; `page.locale` only makes it readable.

### Platform surfaces this plugin depends on
Every gap this repo filed is **closed**: file storage and timestamped episode links (core#81/#82, SDK 0.8.0),
real 404s for unknown subpaths ([core#89], core 0.6.22), and per-page language on both SEO surfaces
(SDK 0.12.0 / core 0.6.24).
- **`ctx.blobs`** (manifest `blobs` block; `null` without one). **Store the `ref`, never the URL** —
  `urlFor(ref)` is derived at render time. **Nothing collects orphans**: the ingest tick deletes what the
  wiki stops pointing at. `quota()` is the only honest source for the effective limits (an admin grant
  *replaces* the manifest's ask). **SVG is never storable.** Uploads are same-origin under `/api/`, so they
  need no CSP host and make no consent decision — prefer them to external URLs.
- **`ctx.links.episode(slug, { t })` / `.feed(slug, …)`** — never hardcode `/episodes/…` or `/feeds/…`.
  Core ships its **own share dialog** since 0.6.12 — do not build a second.
- **`--mc-icon-*` icons** (§12.3): `iconCss(ICON_NAMES, { className })` builds the stylesheet since SDK 0.9.
  **The class name must be kebab-case or `iconCss` throws** — at runtime inside a render, which the error
  boundary turns into a blanked tile; `tsc` does not catch it. An icon is not a word: never in a string.
- **The SDK's nav type and core disagree, and core wins.** `PluginNavDeclaration` says `role`; core reads
  **`visibleTo`**. Worse than it sounds: core maps an *absent* value to **anonymous**, so following the SDK
  type would advertise the podcaster-only entrance to everyone. Pinned in `manifest.contract.test.ts`.
- **Credit fields** `license`/`author`/`homepage`(/`attribution`) surface on `/about`. Unvalidated and
  additive: **never bump `platformApi` for them** — the check is exact and a bump rejects every plugin.
- **Releases publish `plugin.tgz`** (`release.yml`) — install by spec
  `MOSAICAST_PLUGINS=Mosaicast/mosaicast-plugin-wiki@v<x>#sha256:<digest>`. The asset name is load-bearing;
  the workflow refuses a tag disagreeing with the manifest `version`.
- **The `?t=` grammar is shared** (§6.4). `WikiMarkdown.seconds` and `markdown.ts#parseTimestamp` are the
  *third and fourth* implementations of core's `util/timestamp.ts` / `web/TimestampParam.java`, same case
  table (`754`, `12:04`, `1:02:03`, `1h02m03s`, `90m`; bounded fields, 24 h cap, unreadable values dropped).
  A link that previews as one moment and plays another is worse than one with none — change all four or none.
- **No request-time backend hook** (v1 contract, §7.6) — hence the draft/ingest write path, and why every
  invariant lives in `ingestOne`. **Unknown subpaths are a real 404**: `hasRoute` answers, and **the empty
  subpath is our own root** — a lookup over slugs alone 404s the landing page.
- **`ctx.locales()` / `ctx.locale.content()`** are the site's *content* languages — what an admin permits
  text to be **authored** in, which is a different list from `available()` (what the shell can render in).
  Every language control here comes from `content()`; `isContentLocale` validates on ingest, because the
  browser's list is a hint and what reaches storage is input.
- **`ctx.translation` has two indistinguishable ways of being `null`** — this manifest's `external.kinds`,
  or the operator's provider choice, which moves under a running plugin. **Read it at the point of use,
  never cache it.** `usedBy: podcaster` is the floor the host enforces on the browser call (403 below it);
  Java's `ctx.translation()` is gated on the declared kind alone.
- **Both SEO surfaces carry a page's language** (0.12.0). `OgMeta.locale` is the language of *this* page —
  a German article stays German for an English scraper. `SitemapUrl.alternates` is a **map of locale →
  path**, the shape a wiki needs: a translation lives at its own slug, so "also in German, same URL +
  `?lang=`" would describe a wiki nobody has. The map **must** name `loc`'s own language, every member of a
  group declares the **same** map, and values are paths — the host adds `?lang=`, owns `x-default`, confines
  each to `/p/wiki/`. Pin it with `SitemapProviderHarness`: a bad group is dropped silently.
- **`?lang=` is a *UI* locale and changes the shell, not the article.** Core validates it against the UI
  list and never persists it. The wiki serves a language by **slug**, so switcher links stay bare paths —
  matching `x-default` and the canonical, and leaving the visitor's site language alone.

## Tech stack
Java 21 (Gradle, PF4J extension) · React + Vite (Web Component)

## Commands
```
./build.sh                                      # -> dist/ (jar + assets/wiki.es.js + plugin.json)
cd backend  && ./gradlew test
cd frontend && npm test && npm run typecheck    # Vite does not type-check; tsc is what enforces it
```

## Embeds: decided against
No `consent` block, no iframe providers. Uploads are same-origin under `/api/`, so a page shows an image
with no CSP host and no consent decision — and any consent service would cost the site its banner-free
state (§12.5) for a feature uploads already cover. External image URLs still work.

## Live testing (do this every phase)
```
./build.sh && rm -rf ../mosaicast-core/plugins/wiki && cp -r dist ../mosaicast-core/plugins/wiki
cd ../mosaicast-core && dev/instance.sh up --plugins --admin  # :8081, fleeting PG :5433, sample feed
#   dev-login: POST /api/auth/dev-login?role=podcaster|fan|admin (prime /api/meta, send X-XSRF-TOKEN)
dev/instance.sh status | logs [-f] | psql | down
```
`dev/screenshots.sh` is gone; `dev/instance.sh` replaced it and needs `--plugins` (the default loads none).
(`status`/`logs`/`psql` were missing and landed in core 0.6.24; they work now.)
5. **An env var you export does not reach the app.** `up` starts `bootRun`, whose JVM is forked from the
   long-lived Gradle daemon and inherits *its* environment, not your shell's. To set a property, either
   pass it in `--args="… --some.property=value"` (what `instance.sh` does) or `./gradlew --stop` first and
   export before the daemon is recreated.
Translation needs a provider: a LibreTranslate on `http://localhost:5000` and core booted with
`--mosaicast.external.allowed-private-origins=http://localhost:5000` (exact origins, not a subnet — the
`MOSAICAST_EXTERNAL_ALLOWED_PRIVATE_ORIGINS` env spelling is subject to the trap above). Then
`PUT /api/admin/external/translation/providers/libretranslate/settings {"baseUrl":…}`,
`PUT …/translation/provider {"providerId":"libretranslate"}`, and `POST …/translation/test` to confirm.
German is a content language on a fresh install; **Admin → Languages** is where that is changed. With one
content language the whole language UI is correctly invisible.
**Three ways this loop lies to you, all seen in practice:**
1. **`up` accepts a stale instance.** Its health check answers from an app that is already running, so a
   rebuilt plugin never loads and you test the previous build. After `down`, wait until
   `curl -sf localhost:8081/actuator/health` *fails* before `up`.
2. **Never wrap `up` in `timeout`, and don't background it.** The app is a grandchild of the call; when
   that call's process group is reaped the JVM dies mid-test. Symptom: `curl` starts returning `000`, and
   a fresh fleeting Postgres means every schema table looks empty — which reads exactly like a bug in
   your own code. Check `docker inspect -f '{{.State.StartedAt}}' mosaicast-shots` before believing it.
3. **Check what you actually shipped.** A build that runs in a call which then times out can leave a
   *stale* bundle installed, and the symptom is a feature that behaves as if it were never written.
   `grep -c <a-new-class> dist/assets/wiki.es.js` before believing a live result.
4. **Don't run `./build.sh` while the stack is up** — a second Gradle invocation can take the bootRun
   daemon with it. Build first, install, then boot.
Disposable, seeded only with the fictional sample feed — writing and deleting wiki data there is free.
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

## Access is per row, not per surface
`data.readableBy: anonymous` opens the schema **surface**; it says nothing about which rows a visitor may
see. Core has no model of a wiki page and cannot know that `status` decides one — the same rule
`SearchProvider` states out loud, and it applies just as much to the reader. **Three places must filter
`status = published` for anyone who cannot edit**: `PageView`, `SearchProvider`, and `hasRoute`. Missing it
in the reader meant a guessed draft URL rendered the draft.

The language switcher is the fourth place it *would* have applied, and does not: it is built from the
`index` projection, which holds published pages only, so a draft translation is unlistable **by
construction** rather than by a filter someone could forget. Prefer that shape when adding a view.

## The front page is an ordinary wiki page
`homePageSlug` (config, default `main-page`) names it; the backend publishes its body to the `home` doc key
and the home view renders that above the generated sections — so it gets the editor, revisions, history,
search and backlinks for nothing. **Publish nothing as an absent key, never a null** — the doc store refuses
a null value, so storing "no front page" that way throws on every tick of a new install.

## The lead is only shown when it was written
`page.summary` is auto-derived from the first paragraph when an author gives none, so rendering it above the
body would print it twice. The reader shows a lead only when summary and first paragraph differ.

## Languages, and the translation graph
`page.locale` is the language a page is **written** in (from `content()`, never `available()`); unstated
means the site default and is what every pre-existing page says. `page.translationOf` names the original,
and the graph is a **star, never a chain**: a draft naming another translation is collapsed one hop, and a
page others translate cannot itself become a translation. One page per language per group — a switcher can
only offer one. `WikiPlugin.ingestOne` is where all of it is enforced, because nothing runs at request
time; the editor's dropdowns are a convenience.

Machine translation (`translate.ts`) never writes. **Markdown is neither `'text'` nor `'html'`** — the body
is split into blocks (fences whole), line markers are lifted off, and links/citations/targets/code/URLs are
masked into `MCWIKI<n>X` tokens (core's `CatalogDraftRunner` shape). Every token must return exactly once
and the line count must be unchanged; a block failing either is **kept in the source language and counted**.
The draft reaches a new editor through module state, cleared on read — a doc-store handoff would mean
storing machine output, which is the one thing this refuses to do.

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

[core#89]: https://github.com/Mosaicast/mosaicast-core/issues/89
