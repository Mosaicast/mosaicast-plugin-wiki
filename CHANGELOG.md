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

## [0.5.0] — unreleased

`platformApi` moves to **0.17.0** (core **0.7.6** or newer) — mandatory, the host matches on an exact
`major.minor`, so core 0.7.5 and older refuse this build. The 0.16 minor came out of three test passes, and one
of their findings was this plugin's; 0.17 adds nothing the wiki calls, but a 0.16 plugin no longer loads on
0.7.6. PF4J moves to **3.16.0** with the SDK (0.16.2), the version core loads plugins with.

### Security

- **A saved page can no longer restyle the site.** Page bodies were sanitised with
  `DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })` — DOMPurify's defaults, which allow `<style>` and
  `style=`. Under the plugin contract's `style-src 'unsafe-inline'`, a page containing
  `<style>:host{position:fixed;inset:0;background:red;z-index:99999}</style>` covered the whole site for every
  reader, anonymous included, and made the Save button unclickable even for its author; the same primitive
  reaches CSS exfiltration of form values (audit SEC-C07). Everything an author writes now goes through
  **`ctx.sanitize`**, the host's own feed-HTML policy. The wiki's own tokens (links, episode citations, sized
  images) need attributes that policy rightly refuses an author, so they are swapped for placeholder words
  before parsing and put back — into text nodes only — after sanitising; an author can no longer set `class`,
  `data-*` or `style` by hand. The direct `dompurify` dependency is gone. A sized image is the one element
  built from an author-typed URL, so its `src` is held to the rule the host applies to an `<img src>`: the
  policy's allowlist plus its one stated exception, a `data:` image.

### Fixed

- **An episode card's note shows the show notes as text**, not the feed's HTML printed as literal tags: it
  reads `descriptionText` (SDK 0.16.0) instead of `description`.
- **A task list keeps its ticks.** The host policy drops `<input>`, which took `- [x]` and `- [ ]` down to the
  same bullet; the boxes are now ☑/☐ glyphs.
- **A numbered list resumed after an image or a code block keeps its number, and a table keeps its column
  alignment** (SDK 0.16.1 allows `start` and `align`, mosaicast-plugin-sdk#81).
- **External links carry the host's `rel`** (`noopener noreferrer nofollow ugc`). The wiki rewrote it after
  sanitising, dropping `nofollow ugc` and sending a same-origin absolute link to a new tab.

### Changed

- **The episode picker offers every episode.** Nothing changed here: core 0.7.6 stopped cutting `ctx.episodes`
  off at 200, which a long-running show's citation picker had silently hit.
- **Doc reads and writes go through `ctx.docs`**, not hand-built `data/site/main/…` paths on `ctx.api`. Four
  components read `index`, and the host's client now answers concurrent reads of one key with one request;
  the media library and the dashboard use `ctx.docs.list`. The one exception is the editor's receipt poll,
  which stays on `ctx.api` on purpose: the docs client remembers a miss for 30 s, and "no receipt yet" is
  exactly the answer that poll re-asks until it changes.
- **Links and focus rings use `--mc-accent-text`**, the accent clamped to WCAG AA; a pale admin seed measured
  1.12:1 as link text.
- **Numeric settings declare their bounds** — `ingestIntervalSeconds` 1–86400, `revisionsKept` 1–10000,
  `blobGraceMinutes` 0–10080, whole numbers — so core refuses a value outside them on save instead of storing
  it. The backend's own floors stay.

## [0.4.0] — 2026-09-17

`platformApi` moves to **0.15.0** (core 0.7.2 or newer) — mandatory, since the host matches on an exact
`major.minor` and rejects an older manifest at load rather than warning about it. The release exists to fix
two contract bugs, and **the wiki had one of them**.

### Fixed

- **Changing the ingest interval now actually changes it.** The period was read once, when the plugin
  registered, and held until core restarted — so a podcaster who saved a new value was told the save had
  worked and then went on waiting the old interval, with nothing anywhere saying so. It is now re-read
  before every pass, and an edit takes effect within one old interval. This is the setting that decides how
  long a save stays *queued*, since a page reaches the wiki through a draft the next pass applies, so it was
  the worst one to have frozen.

### Added

- **Every setting says what it is, in English and German.** Core's admin form is the only config UI a
  plugin gets — writing its own is precisely what it may not do — and until now it could show an operator
  `blobGraceMinutes` and nothing else. Each of the five fields now carries a name and a sentence on what it
  does, what unit it is in and what changing it costs, resolved against the language the operator is
  reading in.
- Also worth knowing, and core's doing rather than the wiki's: **a podcaster can now open the settings
  page** these fields live on. All five are `editableBy: podcaster` and always have been, but the read fell
  through to an admin-only check, so a podcaster saw "Not allowed" on the whole page and the declaration was
  decorative.

### Fixed (continued)

- **An unsaved page is no longer thrown away when the host rebuilds its context.** `ctx` is reassigned on a
  login, a theme change and a language change, and each one used to cost an author everything typed since
  their last save — the body, the cursor position, an open picker. Three separate things had to be true to
  stop it, and only the first is the contract change:
  - the SDK no longer tears the render down and rebuilds it (`MosaicastHandle.update`, `platformApi`
    0.15.0);
  - reading the page index refetches without first blanking to *loading*, which was unmounting every view
    gated on it, the editor included;
  - and the editor loads its page when the **page** changes rather than when the context object does, or it
    wrote the stored body back over what had been typed.

  Verified in a browser rather than only in tests: the text and the cursor both stay put. On core 0.7.2 the
  four-times-a-second reassignment the contract change was written for does not arise — that release
  memoises the context object — but the everyday ones do, and the wiki's episode tile renders on the page
  with the player on it.

### Not adopted

- **Notifications** (`ctx.notify`), unchanged from 0.3.0: the host delivers only to users a plugin already
  holds `USER`-scope data for, and every document this wiki writes is site-scoped.
- **`options` on a config field.** No setting here has a closed set of values. `sourceHeadings` is
  deliberately open — the whole reason it became a setting is that a fixed list only helps the languages
  somebody thought to add.

## [0.3.0] — 2026-09-08

`platformApi` moves to **0.14.0** (core 0.7.0 or newer) — mandatory, since the host matches on an exact
`major.minor` and rejects an older manifest at load rather than warning about it.

### Added

- **A page history says who wrote it.** `revision.author` and `page.updatedBy` have always been bare
  UUIDs, and the history list rendered them raw, because `ctx.user.id` was the only thing the plugin ever
  had. `ctx.users` (SDK 0.13.0) resolves them to a name and the avatar the host generates for every
  account — and the wiki stores neither. A name is presentation and the id is identity; a stored copy
  would outlive the rename meant to shed it and the erasure meant to end it.
- An author who has since been erased renders as **a former contributor** and keeps their revision, which
  is what pseudonymising a public contribution means. A site whose operator has not granted `identity`
  attributes nothing at all rather than calling every author a former one.

### Not adopted

- **Notifications** (`ctx.notify`, SDK 0.14.0). The host delivers only to users a plugin already holds
  `USER`-scope data for, and this wiki holds none — every document it writes is site-scoped. Declaring
  `notifications` would ship a capability that resolves to an empty recipient list every time. It becomes
  worth revisiting if the wiki ever grows per-user state, such as watching a page for changes.

## [0.2.0] — 2026-09-03

Authoring, mostly: the editor stopped asking anyone to memorise syntax. `platformApi` is unchanged at
**0.12.0**, so this is a drop-in replacement for 0.1.0 on the same host.

### Added

- **Image width and placement**, as an attribute suffix on the existing syntax:
  `![A squid](blob:<ref>){width=320 align=right}`. `320`/`320px` for pixels, `50%` for a share of the
  column, `align=left|center|right`. Without it an image fills the column, because most uploads are wider
  than it — which was the actual complaint behind a request to move the whole page syntax to
  reStructuredText or LaTeX. Nothing an author types reaches the output: a width is parsed to a number and
  written back out as one, an alignment must be one of three words, and anything else in the block is
  dropped.
- **A media library.** Every upload is filed under a name and can be inserted again from a picker, so the
  same picture is uploaded once rather than once per page. The name is a label; a page body still carries
  `blob:<ref>`, because a ref is the file's identity and a name is something someone renames. The orphan
  sweep counts a library entry as a reference, so a file uploaded and not yet placed on a page survives.
- **Size and placement without the syntax.** The library picker carries a width and placement box, and
  putting the cursor in an image already in the body opens the same box for that one — a textarea has no
  image to right-click, so the token under the cursor is the affordance that works. The defaults produce
  exactly what writing nothing produced before.
- **The body and the preview are the same height, scroll together, and stay matched** when the body is
  resized. The scroll is proportional rather than caret-anchored: mapping a caret offset to the element it
  became would need the renderer to hand back a source map.
- **Insert buttons for wiki links and episode citations.** Pages and episodes are chosen from a searchable
  list by title — an episode slug is not something anyone should have to know — with an optional timestamp
  on a citation, read with the same grammar the rest of the site uses.

## [0.1.0] — 2026-09-03

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

[Unreleased]: https://github.com/Mosaicast/mosaicast-plugin-wiki/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Mosaicast/mosaicast-plugin-wiki/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Mosaicast/mosaicast-plugin-wiki/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Mosaicast/mosaicast-plugin-wiki/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Mosaicast/mosaicast-plugin-wiki/releases/tag/v0.1.0
