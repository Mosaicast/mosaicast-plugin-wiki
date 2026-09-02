# mosaicast-plugin-wiki

> Site plugin: a simple wiki via the declarative schema provider (pages, revisions, search).

Part of **[Mosaicast](https://github.com/mosaicast)** — an extensible website platform for podcasts. Status: **v1 in development**.

![The wiki at /p/wiki, light and dark](assets/screenshots/phase1-wiki-light-1280.png)

## What is this?
A wiki for the site — lore, glossary, people, anything worth a page. It is the one plugin that declares a
relational **schema** instead of using the generic doc store, because a wiki is relational: full-text
search, revisions, backlinks and per-page sources are all queries a key/value store answers badly.

Pages live at **`/p/wiki/{slug}`**, so they are linkable and shareable; the plugin supplies OpenGraph
metadata and sitemap entries for them, and answers the host's route check so an unknown slug is a real 404
rather than a soft one.

See `docs/ARCHITECTURE.md` for the big picture and `docs/BRIEF.md` for this repo's scope.

## Languages
A page states the language it is written in, picked from the site's **content** languages — the ones an
admin permits text to be authored in, which are not necessarily the ones the shell renders in. A page may
also declare which page it translates; readers then get a switcher between the two, the article carries a
real `lang=`, and the index can be filtered by language.

The graph is a **star**: every translation points straight at the original, one page per language per
group. All of it is enforced on the backend's ingest tick, because a draft is a document any podcaster may
write and there is no request-time hook to check it at.

On a site with one content language none of this is shown — no picker, no chip, no switcher.

Crawlers are told the same thing: a page's share metadata names the language it is written in, and its
`sitemap.xml` entry carries the whole translation group as `hreflang` alternates — so a German article is
announced as German whoever scrapes it, and a search engine can offer the right language. A page is listed
in a language only if it is really written in it, and an unpublished translation is never advertised.

### Machine translation
Where the site admin has configured a translation provider, a podcaster can translate a page into a
**draft**. It is shown, labelled, and saved by nobody: the author opens it as a new page or discards it.

Getting markdown past a translator takes work, because markdown is neither `text` nor `html`. The body is
split into blocks (fences kept whole), each line's marker is lifted off, and wiki links, episode
citations, link and image targets, inline code, URLs and HTML are masked into tokens. Every token must
come back exactly once and the line count must be unchanged — a block failing either check is **left in
the source language and counted**, because a paragraph still in English is obvious to a reader and a
silently broken image link is not.

The `Sources` heading a page uses is a setting (`sourceHeadings`, default `sources,quellen`), so a wiki
written in a language the shell has never shipped can still have its sources extracted — add the word and
re-save the page.

## Build & test
```bash
./build.sh                                       # -> dist/
cd backend && ./gradlew test                     # against the SDK test kit
cd frontend && npm test && npm run typecheck     # Vite does not type-check; tsc does
```

## Build & install
`./build.sh` -> `dist/` -> copy to `$MOSAICAST_PLUGINS_DIR` (or run `./install.sh`), restart core.
Core loads plugins **at startup only**, so every rebuild needs a restart.

```bash
./build.sh && MOSAICAST_PLUGINS_DIR=../mosaicast-core/plugins ./install.sh
```

From a release, an operator can skip all of that and install by spec — GitHub Releases are the index, so
there is no registry to register with:

```bash
MOSAICAST_PLUGINS="Mosaicast/mosaicast-plugin-wiki@v0.1.0#sha256:<digest from the release notes>"
```

Each release attaches `plugin.tgz` and publishes its SHA-256, so the spec above is pinned and auditable —
which matters, because a plugin runs in-process and unsandboxed.

## How it stores things
Three stores, each for what it is good at:

- **Schema** (`plugin_wiki_page`, `_revision`, `_link`, `_source`, `_media`) — the read model. The platform
  provisions the tables from `plugin.json`; the plugin never writes DDL. The frontend queries them
  read-only through `ctx.schema`.
- **Doc store** — the write channel. There are no schema writes over HTTP, so the editor saves a
  `draft:<slug>` document and the backend ingests it into the tables on its schedule. **A save is therefore
  eventually consistent**, and the UI says so rather than pretending otherwise.
- **Blobs** (`ctx.blobs`) — uploaded images and documents, served same-origin under `/api/`, so they need no
  CSP host and make no consent decision. A row stores the file's **ref**, never a URL. SVG is never stored.

Nothing machine-written is ever stored: a translation reaches a new editor through memory, not the doc
store, and is cleared the moment it is read.

## Contributing
Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `git commit -s` (DCO, required), SPDX header in new files, add tests.

## License
**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE). Header per source file:
```
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors
```

## Name & trademark
"Mosaicast" and the logo denote the official project. Please rename forks.
