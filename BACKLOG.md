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

## 1. Feedback from 2026-09-02 — all done

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

### ~~3.1 The branch has never been merged~~ — done
[PR #18](https://github.com/Mosaicast/mosaicast-plugin-wiki/pull/18) merged on 3 Sep. The count in the
original entry was wrong — it said 19, measured against a local `master` that was itself 19 commits stale.
`git fetch` before quoting a distance.

### 3.5 Tag v0.2.0 once #19 merges
The branch bumps the manifest to **0.2.0** (added features, no breaking change, `platformApi` unchanged at
0.12.0). `CHANGELOG.md` carries the entry as *unreleased*; date it, `git tag v0.2.0` on `master`, publish
the GitHub release, and the workflow attaches `plugin.tgz` with its digest.

**Do not skip the bump on a feature PR again.** #19 was reviewed for two rounds still declaring `0.1.0`,
which is the version already tagged and published — merging it would have put different code on `master`
under a version an operator can already pin. Worth noting that `release.yml` would *not* have caught it:
its guard compares the tag against the manifest, and `v0.1.0` against a `0.1.0` manifest agrees. What
stops a duplicate is git refusing to move an existing tag, which is luck rather than a check.

### ~~3.2 The plugin has never been released~~ — done
**v0.1.0** is tagged and published with `plugin.tgz` attached, so install-by-spec is exercised end to end
for the first time. `scripts/set-version.sh` moves the plugin's own version in all three files that carry it
and CI fails when they disagree; `CHANGELOG.md` is the record.

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
- **1.3 Image width, without changing renderers.** `![caption](blob:ref){width=320 align=right}` — px or a
  percentage of the column, plus alignment. Nothing the author typed reaches the output: a width is parsed
  to a number and written back out as one, an alignment must be one of three words, and the rest of the
  block is dropped, which is what makes emitting a `style` attribute safe. The suffix sits after the `)`, so
  the backend's image pattern ignores it and an older backend would have too. `excerpt()` learned to swallow
  it, or the braces turned up in share previews and list summaries.
- **1.4 A media library.** Every upload is filed as a client-written `asset:<ref>` doc with a name, and the
  editor can insert from it. The name is a label; the body still says `blob:<ref>`, because a ref is
  identity. **The backend change was the important half**: the orphan sweep now counts a library entry as a
  reference, or a file uploaded and not yet placed on a page was deleted an hour later — pinned by a test
  that fails against the old sweep.
- **1.5 Insert buttons for pages, episodes and files.** Pages come from the `index` projection, episodes
  from `ctx.episodes` and `ctx.episodeLabels`, and an optional timestamp goes through `parseTimestamp` —
  the shared `?t=` grammar, not a fifth implementation of it. An unreadable time says so rather than being
  guessed at.

- **A draft ordering race, found while seeding those three pages.** A translation saved in the same tick as
  its original was rejected — "there is no page 'the-kraken' to translate" — and its draft deleted, purely
  because the doc store returned it first. Originals are now ingested before translations.
