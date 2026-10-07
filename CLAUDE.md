# Project: Mosaicast – mosaicast-plugin-wiki

Site plugin: a simple wiki via the declarative schema provider (pages, revisions, search).

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the whole system. On conflict, this file wins.
- `docs/BRIEF.md` — what THIS repo builds, scope, public contract, tasks.
- `BACKLOG.md` — what is open, and why the things not built were not built.

Read the first two fully before writing code. Work in plan mode first.

### `docs/BRIEF.md` is stale — known corrections
It predates SDK 0.4.0 and is a read-only spec, so the corrections live here. Where it disagrees with the SDK
working tree or `mosaicast-plugin-sample`, the latter win.
- `platformApi` is **`0.19.1`** (core 0.7.8+; exact `major.minor` match; the docs' `"1.x"` does not even
  parse). Same string in all four places — `plugin.json`, both gradle coordinates, `package.json` — and **none
  of them is a literal in a test**: `manifest.test.ts` compares against the SDK's own `PLATFORM_API_VERSION`,
  `ci.yml` compares the manifest against both gradle coordinates.
- Its `site / main` slot **renders nowhere** (`main` is the episode page body), and so does
  `placement: "admin"` — both validate. Hence `page` + `site`, and tooling at `/p/wiki/_admin`.

### Platform surfaces this plugin depends on
Every gap this repo filed is **closed** (core#81/#82, [core#89], SDK 0.12.0) — filing one works, prefer it to
a workaround. The generic contract is in the **writing-a-mosaicast-plugin** skill and not repeated here;
what is particular to this repo:
- **`ctx.blobs` orphans are ours to collect** — the tick deletes every file nothing points at (a body, an
  unapplied draft, a library entry). **`ctx.links.episode(slug, { t })` / `.feed(…)`** — never hardcode
  `/episodes/…`. Core has shipped its **own share dialog** since 0.6.12; do not build a second.
- **The `?t=` grammar is shared** (§6.4): `WikiMarkdown.seconds` and `markdown.ts#parseTimestamp` are the
  *third and fourth* implementations of core's (`754`, `12:04`, `1:02:03`, `1h02m03s`, `90m`; bounded
  fields, 24 h cap, unreadable dropped). Change all four together or none.
- **No request-time backend hook** (§7.6) — hence the draft/ingest write path, and why every invariant lives
  in `ingestOne`. **Unknown subpaths are a real 404**: `hasRoute` answers, and **the empty subpath is our own
  root** — a lookup over slugs alone 404s the landing page.
- **Every language control here comes from `content()`, never `available()`**, and `isContentLocale`
  validates on ingest: the browser's list is a hint, what reaches storage is input.
- **`ctx.users` names the ids this plugin stores** (`identity` in the manifest; `null` without it).
  `revision.author` and `page.updatedBy` are UUIDs and must stay that way — **never persist a display
  name**, which would outlive the rename meant to shed it and the erasure meant to end it, and which the
  host cannot police inside our tables. Resolve at render. An unknown or erased id is **absent from the
  answer**, not null in it — key a `Map` on the id. With no `identity`, attribute *nothing*: calling every
  live author "a former contributor" is a lie. `eraseUser` nulls every stored id — tables *and* the
  `draft:`/`delete:`/`asset:` docs, under the tick's lock — and `exportFiles` hands a person theirs.
- **Author HTML goes through `ctx.sanitize`, the wiki's own markup does not** (0.5.0, SDK 0.16.0).
  `markdown.ts` swaps each token for a nonce placeholder, sanitises, then restores the elements it built —
  into text nodes only. Never pass author HTML through that restore path, hold any author URL in a built
  element to `FEED_HTML_POLICY.allowedUriRegexp`, and leave `target`/`rel` to the host. Never go back to a
  DOMPurify config: its defaults let `<style>` deface the site (SEC-C07).
- **The ingest period goes through a `Supplier`, never a captured `Duration`** — the latter is read once in
  `register()` and held for the process, and it is the number deciding how long a save stays *queued*. The
  supplier runs on a scheduler thread: one config read, nothing blocking. `scheduledPeriods()` pins it.
- **Surviving a reassigned `ctx` took three things, and the SDK's is only the first.** The elements return a
  `MosaicastHandle` so the render is not torn down; `useSiteDoc` refetches **without blanking to `loading`**,
  or `WikiPage` unmounts every view gated on it, editor included; and the editor's load is keyed on the
  **page**, not on `ctx`, or it writes the stored body over what was typed. Breaking any one loses an
  author's unsaved work. A test asserting on the SDK's own container `div` passes either way — assert on
  component state.
- **`ctx.notify` is declined, not overlooked.** The host only delivers to users a plugin holds `USER`-scope
  data for, and this wiki holds none, so a send reaches nobody. Revisit if it grows per-user state.
- **Both SEO surfaces carry a page's language** (0.12.0). `OgMeta.locale` is the language of *this* page — a
  German article stays German for an English scraper. `SitemapUrl.alternates` is a **map of locale → path**,
  the shape a wiki needs: a translation lives at its own slug, so "also in German, same URL + `?lang=`" would
  describe a wiki nobody has. The map **must** name `loc`'s own language, every member of a group declares
  the **same** map, and values are paths — the host adds `?lang=`, owns `x-default`, confines each to
  `/p/wiki/`. Pin it with `SitemapProviderHarness`: a bad group is dropped silently.
- **`?lang=` is a *UI* locale and changes the shell, not the article.** Core validates it against the UI list
  and never persists it. The wiki serves a language by **slug**, so switcher links stay bare paths — matching
  `x-default` and the canonical, and leaving the visitor's site language alone.

## Commands (Java 21 / Gradle / PF4J · React + Vite)
```
./build.sh                                      # -> dist/ (jar + assets/wiki.es.js + plugin.json)
cd backend  && ./gradlew test
cd frontend && npm test && npm run typecheck    # Vite does not type-check; tsc is what enforces it
scripts/set-version.sh <x.y.z>                  # the plugin's own version, all three anchors at once
```

## Live testing (do this every phase)
```
./build.sh && cd ../mosaicast-core
dev/instance.sh --name wiki up --plugin-dir ../mosaicast-plugin-wiki/dist   # fleeting PG, sample feed
source <(dev/instance.sh --name wiki env)    # MC_APP_URL, MC_APP_PORT, … — ports are allocated
#   dev-login: POST $MC_APP_URL/api/auth/dev-login?role=podcaster|fan|admin (prime /api/meta, send X-XSRF-TOKEN)
dev/instance.sh --name wiki status | logs [-f] | psql | down        # dev/instance.sh ls: everyone's
```
**Always `--name wiki`, and only ever `up`/`down` that name** — core, SDK, sample, bingo and stats sessions
run their own instances beside it. A named instance runs `origin/master`'s core as a cached jar (`--core REF`
pins another) and copies `dist/` in at `up`; **`--name wiki restart`** copies it again and reboots the app
with the database, feed, ports and episode ids kept (`--core origin/master` moves core too). Needing a second
plugin: pass another `--plugin-dir` with a sister repo's existing `dist/`, or build a copy of it in the
scratchpad — never in its tree. Browse on **`127.0.0.1:<port>`**: cookies are per host, not port, so
`localhost` logs the sister instances out. Capture light and dark at 375×667, 768×1024, 1280×800 into
`assets/screenshots/` for a PR that changes what renders.

**Three ways this loop lies to you, all seen in practice:**
1. **Check what you shipped.** A build in a call that then times out leaves a *stale* `dist/`, and the
   symptom is a feature behaving as if never written. `grep -c <a-new-class> dist/assets/wiki.es.js`.
2. **Never wrap `up` in `timeout`, and don't background it.** Symptom: `curl` returns `000`, and a fresh
   fleeting Postgres makes every schema table look empty — which reads exactly like a bug in your own code.
3. **The ingest tick is 30s.** Poll in one command that waits for the result; a `curl` typed between two
   others races the tick and reads the state from before your write.

Translation needs three things true at once: LibreTranslate on `:5000`, core booted with
`--app-arg --mosaicast.external.allowed-private-origins=http://localhost:5000` on `up` (exact origins, not
a subnet; `restart` replays it, a later `up` does not), and the provider selected —
`PUT /api/admin/external/translation/providers/libretranslate/settings {"baseUrl":…}`, then
`…/translation/provider`, then `POST …/translation/test`.
German is a content language on a fresh install (**Admin → Languages** changes that); with only one, the
whole language UI is correctly invisible.

## npm lockfile gotcha (recurs on every dependency bump)
npm 11 records esbuild's 27 optional platform binaries as `extraneous`, so `npm ci` tries to install
netbsd-arm64 on an x64 runner and fails EBADPLATFORM; npm 10 omits them, which npm 11 rejects as out of
sync. After any dependency change:
```
rm -rf node_modules package-lock.json && npm install --ignore-scripts
# then rewrite each `"extraneous": true` to `"dev": true, "optional": true`
npm ci && npx npm@10 ci     # both must pass before pushing
```

## Access is per row, not per surface
`data.readableBy: anonymous` opens the schema **surface** and says nothing about which rows a visitor may
see. Core has no model of a wiki page and cannot know that `status` decides one — the rule `SearchProvider`
states out loud, and it binds the reader just as much. **Four places must filter `status = published` for
anyone who cannot edit**: `PageView`, `SearchProvider`, `hasRoute`, and the sitemap's alternates. Missing it
in the reader meant a guessed draft URL rendered the draft.

The language switcher is the fifth place it *would* have applied and does not: it reads the `index`
projection, which holds published pages only, so a draft translation is unlistable **by construction**
rather than by a filter someone could forget. Prefer that shape when adding a view.

## The front page and the lead
The front page is an ordinary wiki page — `homePageSlug` names it, the backend publishes its body to the
`home` doc key, and the home view renders that above the generated sections, so it gets the editor,
revisions, history, search and backlinks for nothing. **Publish nothing as an absent key, never a null**:
the doc store refuses a null, so storing "no front page" that way throws on every tick of a new install.

`page.summary` is auto-derived from the first paragraph when an author gives none, so the reader shows a lead
only when summary and first paragraph differ — otherwise it prints that paragraph twice.

## Languages, and the translation graph
`page.locale` is the language a page is **written** in (from `content()`, never `available()`); unstated means
the site default and is what every pre-existing page says. `page.translationOf` names the original, and the
graph is a **star, never a chain**: a draft naming another translation is collapsed one hop, and a page
others translate cannot itself become a translation. One page per language per group — a switcher can only
offer one. **Originals are ingested before translations**, or a translation saved in the same tick as its
original is rejected and its draft deleted over iteration order. All of it lives in `WikiPlugin.ingestOne`,
because nothing runs at request time; the editor's dropdowns are a convenience.

Machine translation (`translate.ts`) never writes. **Markdown is neither `'text'` nor `'html'`** — the body
is split into blocks (fences whole), line markers are lifted off, and links/citations/targets/code/URLs are
masked into `MCWIKI<n>X` tokens (core's `CatalogDraftRunner` shape). Links are masked as a **matched pair**:
mask only `](target)` and the translator closes the `[` you left open, somewhere else in the sentence. Every
token must return exactly once and the line count must be unchanged; a block failing either is **kept in the
source language and counted**. The draft reaches a new editor through module state, **read but not consumed**
— navigating re-hands `ctx`, the index refetches, the editor remounts, and a clear-on-read hand-off is
swallowed by the mount React throws away. `WikiPage` clears it when the route leaves `_new`.

## Page syntax (what the backend extracts and the reader renders)
```
[[the-kraken]]  [[the-kraken|label]]        wiki link; unresolved -> red link
[[episode:s01e02]]  [[episode:s01e02@12:04|label]]   episode link via ctx.links.episode(slug,{t})
![caption](blob:<ref>)                      an uploaded file, addressed by ref
![caption](blob:<ref>){width=320 align=right}   …sized; width in px or %, align left|center|right
## Sources / ## Quellen / ...               extracted to `source` rows and rendered from those
```
The Sources vocabulary is the **`sourceHeadings` config field** (default `sources,quellen`) — a per-language
table only helps languages somebody thought to add. The backend records the heading it matched in
`page.sourcesHeading` and the reader strips *that* section, so the browser holds no copy of the list to fall
out of step. Configured headings are `Pattern.quote`d / escaped on both sides: the value comes from a form a
podcaster types into.

The `{…}` suffix is markdown's missing image width, taken over moving the syntax to rST or LaTeX. **Nothing
the author typed reaches the output** — a width is parsed to a number and written back out as one, an
alignment must be one of three words, the rest is dropped — which is what makes emitting a `style` attribute
safe. It sits after the `)`, so the backend's image pattern ignores it.

The editor never asks anyone to remember `{…}`: the library picker carries a width/placement box, and the
caret sitting in an image opens the same box for it — a textarea has no image to right-click, so the token
under the caret is the affordance that works. **Record the token's new span synchronously**; deriving it in
the `requestAnimationFrame` that repositions the caret made a second edit slice against a stale end and
append a block instead of replacing one, and rAF is throttled in a background tab.

The **pickers** are why nobody types a slug: pages from `index`, episodes from `ctx.episodes` +
`ctx.episodeLabels`, timestamps through `parseTimestamp`. Every upload is filed in the **media library** as
a client-written `asset:<ref>` doc; the body still says `blob:<ref>`, because a ref is identity and a name
is a label. **That entry is what keeps the file alive** — the only reference between uploading and placing,
so without it the orphan sweep deletes the upload an hour later.

`WikiMarkdown` (backend) finds these with **regexes, not a parser** — a real parser would mean a shaded JAR
and PF4J classloading. The browser parses properly for rendering; anything the backend misses degrades to a
missing backlink, never a broken page.

## Storage model (why two stores)
`schema` is the read model (`plugin_wiki_*`, read-only from the frontend via `ctx.schema`); the doc store is
the write channel — the editor writes `draft:<slug>` and the backend ingests on its schedule. **Saves are
eventually consistent**: surface that in the UI, never paper over it. Backend-owned keys (`index`, `home`,
`wikistats`, `ingest:*`) are written in `register()` **and** on the tick. Never reserve
`draft:*`/`delete:*`/`asset:*` — the client writes those and reserving them would 403 the editor. Those
three and `ingest:*` carry a `podcaster` **read** floor (`data.keyFloors`): a queued draft is unpublished.

## Releasing
`scripts/set-version.sh` bumps the plugin's own version in all three files that carry it; `ci.yml` fails if
they disagree. `release.yml` refuses a tag disagreeing with the manifest, attaches `plugin.tgz` (**the asset
name is load-bearing**) and appends the SHA-256 an operator pins. `CHANGELOG.md` is the record; the
`releasing-a-mosaicast-plugin` skill has the order. **`git fetch --tags` and check the newest tag before
writing "ships in x.y.z"**: v0.5.0 was released while two PRs still claimed it (BACKLOG 3.9), and no guard
catches that. `scripts/set-version.sh` does not touch `package-lock.json`'s two root `version` lines.

## Conventions (binding)
Java packages `dev.mosaicast.*`, npm scope `@mosaicast`, and imports **only** against the SDK. Tests are
part of the work and CI must be green; document public APIs from the built SDK docs rather than guessing.
No secrets in the repo. **Sign off commits** (`git commit -s`) and put an **SPDX header in every new source
file** — `AGPL-3.0-or-later` + `2026 The Mosaicast Authors`, that fixed holder and not your git config. CI
blocks a PR without either.

## Keep docs current, and when unsure
**README.md**, **BACKLOG.md** and this file are repo-local and yours to maintain; **ARCHITECTURE.md and
BRIEF.md are READ-ONLY specs** — flag deviations rather than editing them. Keep this file **under ~200
lines** and leave incidental learnings to Claude Code's auto memory. Build with the shared
**writing-a-mosaicast-plugin** skill; if it is not available, **pause**, say it is recommended and how to
install it (CONTRIBUTING → "Recommended skill"), and proceed without it only if the user agrees. When
unsure, ask or note the assumption visibly instead of silently diverging from ARCHITECTURE.md.

[core#89]: https://github.com/Mosaicast/mosaicast-core/issues/89
