<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 The Mosaicast Authors
-->

# Backlog

What is known to be open, in one place. `docs/BRIEF.md`'s Definition of Done is **met** — this is everything
past it: reviewer feedback, work deliberately deferred, and release hygiene. What has been done since is
kept at the bottom rather than deleted, so the numbers in it stay meaningful.

Ordered by recommended sequence, not by size. Each item names the files it lands in, because most of them
touch both halves of the plugin and the page-syntax ones touch four files that must agree.

---

## 1. Feedback from 2026-09-02 — open

### 1.3 Image width control — *medium, and not the change that was asked for*
> "switch the wiki pages to rst or something like that? Markdown works perfectly except for if you add
> images since as soon as you add images they are always width filling"

**The diagnosis is right and the proposed cure is much bigger than the disease.** `.wiki__body img` is
`max-width: 100%; height: auto` — nothing forces an image to fill the column. It fills because uploads are
routinely wider than the column, so `max-width` is what every image hits. What is missing is a way for the
author to say *how wide*.

**Recommended:** an attribute suffix on the existing syntax, for both uploads and external URLs:

```
![A squid](blob:<ref>){width=320}
![A squid](blob:<ref>){width=50% align=right}
```

- `frontend/src/markdown.ts` — `BLOB_IMAGE` and the external-image path.
- `backend/.../WikiMarkdown.java` — media extraction must not choke on the suffix, and should ignore it.
- `frontend/src/components/styles.ts` — width/alignment; keep `max-width: 100%` as the ceiling so a width
  larger than the column still cannot overflow on a phone.
- `frontend/locales/{en,de}.json` — `editor.syntaxHint`.
- `README.md` and `CLAUDE.md` page-syntax blocks.

**Why not reStructuredText or LaTeX.** Three costs, and the first is structural:

1. **The backend extracts with regexes on purpose.** A real parser means a shaded JAR and PF4J
   classloading, which is why `WikiMarkdown` is written the way it is. rST and LaTeX are both grammars that
   defeat regex extraction, so backlinks, episode citations, media rows and the Sources section would all
   have to move somewhere else or be lost.
2. **Every existing page and every stored revision** is markdown. A syntax switch is a migration of author
   content, and revisions are a public record that should not be rewritten.
3. **The browser needs a second renderer and a second sanitiser.** `marked` + DOMPurify is the whole
   rendering trust boundary today.

If the width attribute lands and the control is still not enough, that is a real v2 conversation — but it
should start from a specific thing markdown cannot express, not from images.

### 1.4 A blob library: upload once, use on many pages — *large, and the one with hidden depth*
> "even if I need the same image on 10 pages, I would have to upload it 10 times… a kind of blob storage
> browser where you dedicated upload things with a name… The name should not replace the uuid completely"

The listing half is free: `ctx.blobs.list({ page, size })` already returns `BlobInfo { ref, filename, mime,
size, updatedAt }`. Three things are not free:

- **Names.** `filename` is whatever was uploaded and there is no rename in the contract. A chosen name has
  to live in this plugin's own storage — either a new `asset` schema entity (`ref`, `name`, `caption`) or a
  backend-owned doc key. Schema is the better fit: it is queryable and it is where the wiki's other
  relational truth lives.
- **The name must not replace the ref.** Explicit in the request, and right: `blob:<ref>` stays the
  canonical reference in a page body, because a ref is the file's identity and a name is a label someone
  may change. A resolvable alias (`![caption](asset:kraken-photo)`, resolved to a ref at ingest) is
  possible *on top* of that, but it is a second syntax and a second failure mode — decide deliberately.
- **The orphan sweep will eat the library.** `sweepOrphanedFiles` keeps a blob alive only if a `media` row
  or an unapplied draft names its ref, and `blobGraceMinutes` (default 60) buys a new upload nothing more
  than an hour. A file uploaded to the library and not yet placed on a page has neither, so today it is
  deleted an hour later. **The sweep has to count a library entry as a reference** — this is the part that
  turns a UI feature into a backend change, and getting it wrong silently deletes a podcaster's uploads.

Also: a picker UI in `EditorView.tsx` (thumbnail grid, search by name, insert at caret via the existing
`insertAtCaret`), and a way to delete a library entry that is still used somewhere — which needs the
"where is this used" query the `media` table can already answer.

### 1.5 Insert buttons for wiki links and episode citations — *medium*
> "buttons for links to other wiki pages and to quote episodes with or without timestamp. I think most
> users will not know what the episode slug is"

Both are buildable today and the SDK explicitly points at the primitive for the second one.

- **Wiki link.** The editor already receives the `index` projection as a prop — a searchable list of
  titles, inserting `[[slug]]` or `[[slug|label]]` at the caret.
- **Episode citation.** `ctx.episodes` is the access-filtered list of episode slugs and `ctx.episodeLabels`
  maps them to human labels; the SDK says in as many words to "use them in pickers so users see titles, not
  slugs". Add an optional timestamp field.
- **Do not write a fifth timestamp parser.** `markdown.ts#parseTimestamp` already implements the shared
  `?t=` grammar and is one of four implementations that must agree (CLAUDE.md). Reuse it to validate what
  the picker accepts.
- **Verify first:** that `ctx.episodes` is actually populated for a `site`-scope `page` slot. If it is
  empty there, that is a platform gap worth filing rather than working around.
- `frontend/src/components/EditorView.tsx`, `styles.ts`, `locales/{en,de}.json`.

---

## 2. Carried over from earlier work

### 2.2 Wiki-link labels are not translated — *small, needs a decision first*
`translate.ts` masks `[[slug|label]]` whole, so a German page keeps English link labels. Masking only the
target would translate the label — but a translated label is only an improvement if the *target* still
resolves, and a reader cannot tell a mistranslated label from a broken link. Decide the behaviour before
writing it.

### ~~2.3 CLAUDE.md is over the length guidance~~ — done
Cut from 229 to 199 by deleting rather than compressing: the bullets that only restated the
`writing-a-mosaicast-plugin` skill are gone, and "Embeds: decided against" moved to §5, where settled
decisions belong. Two defects surfaced on the way — a numbered list headed "three ways" that had five items
with one orphaned above it, and a `backendOwned` list still naming the `episodes` key `ctx.feeds` replaced
while missing `home`.

---

## 3. Release and hygiene

### 3.1 Open for review — [PR #18](https://github.com/Mosaicast/mosaicast-plugin-wiki/pull/18)
`feat/languages-and-translation`, **12 commits** against `master`: the 0.11.0 and 0.12.0 contract moves,
languages, translation, the hreflang group and the review feedback.

**The count in the earlier version of this entry was wrong.** It said 19, measured against a local `master`
that was itself 19 commits stale — phases 3 and 4 and the front page had already merged upstream. `git
fetch` before quoting a distance from a branch you have not pulled in a while.

### 3.2 The plugin has never been released — *prepared; the tag is the remaining step*
Everything a release needs is now in place: `CHANGELOG.md` with the 0.1.0 entry, `scripts/set-version.sh` to
move the plugin's own version in all three files that carry it, and a CI guard that fails the build when
they disagree — `release.yml` would only have caught that drift *after* someone published a release whose
parts contradicted each other.

`0.1.0` stands as written rather than being bumped: it has never been published, so tagging it is the truth,
and inventing a `0.2.0` would imply a `0.1.0` release that never happened.

**What is left is `git tag v0.1.0` and publishing the GitHub release, on `master` after this merges** —
tagging an unmerged branch would pin a commit that is not on the mainline. The install-by-spec path stays
untested end to end until that release exists.

### 3.3 Dependabot PR #16 is open
`actions/setup-java` 5.7.0 → 6.0.0. Core already took the same bump.

### ~~3.4 README's hero image is from phase 1~~ — done
`hero-wiki-{light,dark}-1280.png`, captured against core 0.6.24: the title row with its language menu, a
lead, a contents list naming the Sources section rendered from structured rows, an episode citation and a
resolved wiki link. The phase-1 images stay in the folder — earlier PRs link to them.

---

## 4. Filed elsewhere, not ours to fix

Two stale claims in the `writing-a-mosaicast-plugin` skill (`mosaicast-skills`), reported 2026-09-02:

- `SKILL.md` still tells you to run `dev/screenshots.sh up`; core renamed it to `dev/instance.sh`, and
  `--plugins` is now required because the default loads none.
- It describes `mosaicast-plugin-sample` as **v2.10.0 on SDK 0.8.0**. The installed sample is **v2.14.0 on
  platformApi 0.12.0**, so it is a usable reference for `tags` / `feeds` / `docs` / `external` / `nav`
  again.

---

## 5. Decided against

**Embeds and a consent block.** No iframe providers, no `consent` block. Uploads are same-origin under
`/api/`, so a page shows an image with no CSP host and no consent decision — and declaring any consent
service would cost the whole site its banner-free state (ARCHITECTURE §12.5) for a feature uploads already
cover. External image URLs still work. Reopen only with a case uploads cannot serve.

**reStructuredText or LaTeX as the page syntax.** See 1.3 — the ask was really about image width, and the
three costs are recorded there.

---

## 6. Done

- **1.1 Language switcher as a dropdown.** The icon is a `<details>` button naming the language you are
  reading; the others are behind it. Below two languages nothing renders at all, as before.
- **1.2 History and Edit as icon buttons on the title line.** Right-aligned, level with the heading, each
  carrying a visually-hidden label because `Icon` is `aria-hidden` by contract. Below 30 rem the controls
  drop under the title rather than squeezing it.
- **2.1 The Sources vocabulary is a setting.** `sourceHeadings` (default `sources,quellen`) is what the
  backend matches, and it records the heading it found in `page.sourcesHeading` so the reader strips
  exactly that section without holding a second copy of the list. Verified live with a Spanish page under
  `## Fuentes`.
- **A draft ordering race, found while seeding those three pages.** A translation saved in the same tick as
  its original was rejected — "there is no page 'the-kraken' to translate" — and its draft deleted, purely
  because the doc store returned it first. Originals are now ingested before translations.
