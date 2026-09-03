<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 The Mosaicast Authors
-->

# Changelog

Notable changes to **mosaicast-plugin-wiki**. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

Two versions are in play and they are not the same thing. The heading below is the **plugin's own** version,
which is what an operator pins. **`platformApi`** is the host contract the backend compiled against; core
matches it on an exact `major.minor`, so a plugin declaring an old one is rejected at load rather than
warned about, and every entry that moves it says so.

## [Unreleased]

## [0.1.0] — unreleased

First release. `platformApi` **0.12.0** (core 0.6.24 or newer).

### The wiki

Pages at `/p/wiki/<slug>` with revisions, full-text search, backlinks, per-page sources and uploaded images.
It is the one plugin that declares a relational **schema** rather than using the generic doc store, because
a wiki is relational: those four are queries a key/value store answers badly.

- **Reading.** A page renders its body, a table of contents, a lead paragraph when the author wrote one, the
  episodes it cites as cards, its sources, and what links to it. Unknown slugs are a real 404 rather than a
  soft one, and unpublished pages are invisible to anyone who could not edit them — in the reader, in search,
  in the route check and in the sitemap alike.
- **Writing.** A podcaster edits in the browser; the editor writes a `draft:<slug>` document and the backend
  ingests it on its schedule. **A save is eventually consistent by construction** — there are no schema
  writes over HTTP — so the editor reports *queued*, polls the receipt the backend leaves, and only claims
  success once the backend agrees. A conflicting save is refused with the writing kept.
- **The front page is an ordinary wiki page**, named by the `homePageSlug` setting, so it gets the editor,
  revisions, history, search and backlinks for nothing.
- **Uploads** through `ctx.blobs`, served same-origin under `/api/` — no CSP host and no consent decision, so
  the site keeps its banner-free state. A page stores the file's ref, never a URL; the ingest tick deletes
  files no page points at any more.
- **Tags** join the site's shared vocabulary, so a page tagged `lore` and an episode tagged `lore` are the
  same word.
- **Search** contributes to the site-wide results rather than growing a second search box.
- **A podcaster dashboard** at `/p/wiki/_admin`: orphans, broken links, pending drafts, media counts.

### Languages

- A page states the language it is **written** in, chosen from the site's content languages — which are not
  the same list as the languages the shell renders in.
- A page may declare which page it translates. The graph is a **star**: every translation points at the
  original, one page per language per group. Readers get a switcher; the article carries a real `lang`; the
  index can be filtered by language. On a site with one content language none of it is shown.
- **Crawlers are told the same thing.** Share metadata names the language of *that page* — a German article
  stays German for an English scraper — and `sitemap.xml` carries the whole translation group as `hreflang`
  alternates. A page is listed in a language only if it is really written in it, and an unpublished
  translation is never advertised.

### Machine translation

Where an admin has configured a translation provider, a podcaster can translate a page into a **draft**:
shown, labelled, and saved by nobody. Markdown is neither plain text nor HTML, so the body is taken apart
before it is sent — blocks split with code fences kept whole, line markers lifted off, and links, episode
citations, image targets, inline code and URLs masked. Every mask must come back intact or the block is
**left in the source language and counted**, because a paragraph still in English is obvious to a reader and
a silently broken image link is not.

### Notes for operators

- **`sourceHeadings`** (default `sources,quellen`) is the heading a page opens its sources with. A wiki
  written in a language the shell has never shipped can still have its sources extracted — add the word.
- Other settings: `homePageSlug`, `ingestIntervalSeconds`, `revisionsKept`, `blobGraceMinutes`.
- Deleting an account **pseudonymises** a contributor's revisions rather than erasing them; a revision is a
  public contribution.
- Install by spec, pinned and auditable — a plugin runs in-process and unsandboxed:

  ```
  MOSAICAST_PLUGINS=Mosaicast/mosaicast-plugin-wiki@v0.1.0#sha256:<digest from the release notes>
  ```

[Unreleased]: https://github.com/Mosaicast/mosaicast-plugin-wiki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Mosaicast/mosaicast-plugin-wiki/releases/tag/v0.1.0
