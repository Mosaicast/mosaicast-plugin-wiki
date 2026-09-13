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

### ~~3.5 Tag v0.2.0 once #19 merges~~ — done
Shipped, and so did **v0.3.0** (tagged `8308245`, 2026-09-08). Its `CHANGELOG.md` heading still said
*unreleased* for five days afterwards, which is the failure mode this entry exists to prevent, one step
later than last time: the bump was not forgotten, the *dating* was. Date the heading in the release commit,
not after the tag.

**Do not skip the bump on a feature PR again.** #19 was reviewed for two rounds still declaring `0.1.0`,
which is the version already tagged and published — merging it would have put different code on `master`
under a version an operator can already pin. Worth noting that `release.yml` would *not* have caught it:
its guard compares the tag against the manifest, and `v0.1.0` against a `0.1.0` manifest agrees. What
stops a duplicate is git refusing to move an existing tag, which is luck rather than a check.

### 3.6 Tag v0.4.0 once the 0.15.0 PR merges
The branch bumps the manifest to **0.4.0** and `platformApi` to **0.15.0** (core 0.7.2 or newer). Date the
`CHANGELOG.md` heading in the release commit, `git tag v0.4.0` **on `master`**, publish the GitHub release,
and the workflow attaches `plugin.tgz` with its digest.

### 3.7 CLAUDE.md is over the length guidance again — *small*
215 lines against the ~200 the file asks for, which is where 2.3 left it. This round added two invariants
and deleted two settled BRIEF corrections plus a Guardrails paragraph the file elsewhere says it does not
repeat, so it is net flat rather than growing. The remaining fat is not obvious: the six live-testing traps,
the npm lockfile ritual and the translation masking rules were each paid for in real debugging. Cut only
with something concrete to point at.

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

**Notifications** (`ctx.notify`, SDK 0.14.0). The host delivers only to users a plugin already holds
`USER`-scope data for — enforced against the same partitions `queryAcrossUsers` reads — and this wiki holds
none: every document it writes is site-scoped. Declaring `notifications` would ship a manifest capability
whose every send resolves to an empty recipient list. Revisit only if the wiki grows per-user state, which
"watch this page for changes" would be the obvious reason for.

---

## 6. Done

- **A saved ingest interval is honoured** (SDK 0.15.0 `onSchedule(Supplier<Duration>, …)`). The period was
  read once in `register()` and held for the life of the process, so a podcaster who saved a new value was
  told it worked and went on waiting the old one until core restarted — and it is the number deciding how
  long a save stays *queued*, since a page reaches the wiki through a draft the next pass applies. Pinned by
  a test that fails against a captured `Duration`.
- **An unsaved page survives a reassigned `ctx`** (SDK 0.15.0 `MosaicastHandle`, plus two fixes it exposed).
  Adopting the handle alone did **not** fix it, which a browser showed and the unit tests would not have:
  the SDK stopped tearing the render down, and the author's body still vanished, because `useSiteDoc`
  blanked to `loading` on every refetch — unmounting every view `WikiPage` gates on it — and the editor's
  load effect was keyed on `ctx` and wrote the stored body back over what had been typed. All three are
  needed; a test pins each. Worth remembering as the shape of the mistake: the platform change was real and
  the plugin-side assumption about what it bought was not.
- **Every config field says what it is**, in English and German. Core's generic admin form is the only
  config UI a plugin gets, and it could previously show an operator `blobGraceMinutes` and nothing else.

- **A page history says who wrote it** (SDK 0.13.0 `ctx.users`). `revision.author` and `page.updatedBy`
  were bare UUIDs rendered raw, because `ctx.user.id` was all the plugin ever had. They resolve to a name
  and the host's generated avatar now, and the wiki stores neither — a name is presentation, the id is
  identity, and a stored copy would outlive the rename meant to shed it and the erasure meant to end it.
  An erased author renders as "a former contributor" and keeps their revision; with no `identity` granted
  the plugin attributes *nothing*, because calling every live author a former one is a lie.

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
