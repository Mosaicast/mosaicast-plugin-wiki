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

### ~~3.6 Tag v0.4.0 once the 0.15.0 PR merges~~ — done
Tagged 2026-09-17.

### 3.8 Tag v0.6.0 once #34 merges
The release commit (CHANGELOG dated 2026-10-07) rides in #34. After the merge: `git tag v0.6.0` **on
`master`**, push the tag, publish the GitHub release; the workflow attaches `plugin.tgz` with its digest.
Manifest **0.6.0**, `platformApi` **0.19.1** (core 0.7.8 or newer).

### 3.9 Two PRs merged under a version that was already released
**v0.5.0 was tagged and released on 2026-10-02** at #30's merge (platformApi 0.17.0). #31 (platformApi 0.19.0,
key floors) and #32 (the GDPR handler) were then written and merged *still declaring 0.5.0*, with a
CHANGELOG heading that said "0.5.0 — unreleased", so for a while `master` held different code under a version
an operator could already pin. The release's own CHANGELOG said "unreleased" too: 3.5's dating failure again.
Fixed by bumping to 0.6.0 and splitting the CHANGELOG, with `[0.5.0]` restored to exactly what the tag shipped.

**Run `git tag --contains` (or `git tag | sort -V | tail -1`) before writing "lands in x.y.z".** Neither
guard catches this: `release.yml` compares a new tag against the manifest, and CI compares the manifest's
three copies against each other. A check that fails when the manifest's version is already a tag on an
ancestor of `HEAD` would.

### 3.7 CLAUDE.md is over the length guidance again — *small*
223 lines now (it was 215) against the ~200 the file asks for, which is where 2.3 left it. This round added two invariants
and deleted two settled BRIEF corrections plus a Guardrails paragraph the file elsewhere says it does not
repeat, so it is net flat rather than growing. The remaining fat is not obvious: the six live-testing traps,
the npm lockfile ritual and the translation masking rules were each paid for in real debugging. Cut only
with something concrete to point at.

### ~~3.2 The plugin has never been released~~ — done
**v0.1.0** is tagged and published with `plugin.tgz` attached, so install-by-spec is exercised end to end
for the first time. `scripts/set-version.sh` moves the plugin's own version in all three files that carry it
and CI fails when they disagree; `CHANGELOG.md` is the record.

### ~~3.3 Dependabot PR #16 is open~~ — done
Superseded: `actions/setup-java` went to 6.0.1 in #23.

### ~~3.4 README's hero image is from phase 1~~ — done
`hero-wiki-{light,dark}-1280.png`, captured against core 0.6.24: the title row with its language menu, a
lead, a contents list naming the Sources section rendered from structured rows, an episode citation and a
resolved wiki link. The phase-1 images stay in the folder — earlier PRs link to them.

---

## 4. Filed elsewhere, not ours to fix

~~Two stale claims in the `writing-a-mosaicast-plugin` skill~~ — **fixed upstream** by skill 0.10.1
(2026-09-27): it documents `dev/instance.sh --name <plugin> up --plugin-dir …` and names the sample's current
tag. `CLAUDE.md`'s live-testing section follows it.

---

**The schema surface has no per-row access.** `ctx.schema` reads, like the raw `/api/plugins/wiki/schema/*`
API, return every row to anyone above `data.readableBy`: a page whose `status` is not `published` (only a
hand-written draft can have one; the editor always publishes) and every revision. The reader filters, as
"Access is per row" in CLAUDE.md says, but the HTTP surface does not. `storage.schemaReadableBy` (SDK 0.19.0)
cannot help, because the anonymous reader needs the surface. Not filed yet: it needs a host-side row filter,
which is a design question for core.

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

- **Storage sizes in core's units** (#29). The SDK's `i18n.bytes` was decimal by design and core labels MiB;
  raised with the SDK, which moved to binary in 0.19.1. The wiki only bumped the dependency.
- **The open issues from the 0.7.2 test passes** (#24–#28). #24, the stored CSS injection, was already fixed
  in 0.5.0 and was confirmed again against core 0.8.0: an anonymous reader gets `<p>Hello <span>overlay</span></p>`
  for a body carrying `<style>` and `style=`. #25 adds *Create the first page* and a *New page* button in the
  bar; #26 makes a deletion report as one and names the real ingest wait; #27 makes the image upload a
  focusable button; #28 gives the empty wiki an h1. #29 is listed in §4.
- **A person's data export, and an erasure that reaches the queue** (core 0.8.0). See CHANGELOG 0.6.0.
- **Per-key read floors** (SDK 0.19.0 `data.keyFloors`): queued drafts, deletions, receipts and library entries
  are no longer readable by anonymous visitors.
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
