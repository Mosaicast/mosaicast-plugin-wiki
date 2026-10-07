// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import dev.mosaicast.plugin.api.BlobInfo;
import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Criteria.Direction;
import dev.mosaicast.plugin.api.Criteria.Op;
import dev.mosaicast.plugin.api.DocEntry;
import dev.mosaicast.plugin.api.ExportFile;
import dev.mosaicast.plugin.api.Locales;
import dev.mosaicast.plugin.api.OgMeta;
import dev.mosaicast.plugin.api.PageRouteProvider;
import dev.mosaicast.plugin.api.PluginBackend;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Role;
import dev.mosaicast.plugin.api.SchemaStore;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.SearchHit;
import dev.mosaicast.plugin.api.SearchProvider;
import dev.mosaicast.plugin.api.ShareMetadataProvider;
import dev.mosaicast.plugin.api.SitemapProvider;
import dev.mosaicast.plugin.api.SitemapUrl;
import dev.mosaicast.plugin.api.UserDataHandler;
import dev.mosaicast.plugin.api.UserExport;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.HashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.pf4j.Extension;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The wiki's backend: the only writer of relational truth for this plugin (ARCHITECTURE §7.6).
 *
 * <p>A wiki is relational, so the manifest declares a schema and the platform provisions
 * {@code plugin_wiki_*} for it. But there are <strong>no schema writes over HTTP</strong>: a v1 plugin
 * authors no routes, so no plugin code runs at request time and there is nowhere to enforce slug
 * uniqueness or append a revision atomically. The browser therefore writes a document
 * ({@code draft:<slug>}) and this class ingests it on its schedule. Every save is eventually consistent by
 * construction, which is why each one gets an {@code ingest:<slug>} receipt the editor can poll: the
 * alternative is a UI that claims a save landed when it has not.
 *
 * <p>The keys this class authors are declared in {@code plugin.json} under {@code data.backendOwned}, so a
 * client may read them but cannot forge them. They are written in {@link #register(PluginContext)} as well
 * as on the schedule: declaring a key does not remove a value forged before the declaration existed.
 *
 * <p><strong>Every extension point lives on this one class</strong>, and that is not tidiness. Core
 * instantiates plugin extensions through PF4J's {@code SingletonExtensionFactory}, which caches by class —
 * so a second {@code @Extension} class would be its own singleton, with no {@link PluginContext} and no way
 * to reach the schema store. Implementing them here is what makes them run on the object
 * {@link #register(PluginContext)} ran on.
 */
@Extension
public class WikiPlugin implements PluginBackend, ShareMetadataProvider, SitemapProvider,
        PageRouteProvider, SearchProvider, UserDataHandler {

    /** Doc key holding {@code slug -> summary} for every page, so the UI can list and resolve links at once. */
    static final String KEY_INDEX = "index";

    /**
     * Doc key holding the wiki's own front page, when a podcaster has written one.
     *
     * <p>Published rather than queried so the home view costs one read. The front page is an ordinary wiki
     * page addressed by {@code homePageSlug}, which is the point: it gets the editor, revisions, history
     * and search for nothing, instead of being a second kind of content with its own everything.
     */
    static final String KEY_HOME = "home";

    /** Doc key holding the counters the podcaster dashboard reads. */
    static final String KEY_STATS = "wikistats";

    /** Client-written prefixes. Deliberately NOT backend-owned, or the editor would 403 against itself. */
    static final String DRAFT_PREFIX = "draft:";
    static final String DELETE_PREFIX = "delete:";

    /** Backend-written receipt, one per attempted save. */
    static final String INGEST_PREFIX = "ingest:";

    /** Published pages are readable and listed; a draft is neither, but keeps its history. */
    static final String STATUS_PUBLISHED = "published";

    /**
     * What a slug may be. Narrower than the doc store's key pattern on purpose: a slug becomes a URL
     * segment, so it stays lowercase and hyphenated, and it may not start with the underscore the wiki's
     * own verbs ({@code _search}, {@code _admin}) use.
     */
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9][a-z0-9-]{0,119}$");

    /** A file reference inside a page body, as the editor writes it. */
    private static final Pattern BLOB_REF = Pattern.compile("blob:([A-Za-z0-9-]{6,})");

    private static final int DEFAULT_INGEST_SECONDS = 30;
    private static final int DEFAULT_REVISIONS_KEPT = 50;
    private static final int DEFAULT_BLOB_GRACE_MINUTES = 60;
    private static final int SUMMARY_CHARS = 200;

    /** How much of a page a search result shows when it has no summary of its own. */
    private static final int SNIPPET_CHARS = 160;

    /** The page the wiki's front page reads from, unless an operator points it elsewhere. */
    private static final String DEFAULT_HOME_SLUG = "main-page";

    /** The shipped Sources vocabulary, as the config field's default spells it. */
    private static final String DEFAULT_SOURCE_HEADINGS = "sources,quellen";

    /** The namespace this plugin tags under. Opaque to the host, and nobody else can name it. */
    private static final String TAG_SUBJECT_PREFIX = "page:";

    /** The client-written media-library keys, {@code asset:<ref>}. Never reserved: the editor writes them. */
    static final String ASSET_PREFIX = "asset:";

    /** How many files one sweep looks at. A wiki's library is small; this bounds a pathological one. */
    private static final int BLOB_PAGE = 200;

    /**
     * How much revision text one person's export carries, in UTF-8 bytes before JSON escaping.
     *
     * <p>A quarter of the host's cap, because escaping can double a body (every newline and quote) and the
     * metadata and the other files need room too. Past it the newest bodies are kept and older revisions
     * export without theirs — still listed, so nothing the person wrote goes unmentioned.
     */
    static final long EXPORT_BODY_BUDGET = UserExport.MAX_BYTES / 4;

    /** The export writes JSON through the Jackson the SDK exposes; the contract never serialises for us. */
    private static final ObjectMapper JSON = JsonMapper.builder().build();

    private PluginContext ctx;

    @Override
    public void register(PluginContext ctx) {
        this.ctx = ctx;

        // Publish once at boot: a backend-owned key is only closed to clients from the moment the manifest
        // declares it, so anything forged earlier survives until this overwrites it.
        tick();

        // The *supplier* overload, not the Duration one, and that is the whole point: the Duration form
        // captures the period during register() and holds it for the life of the process, so a podcaster
        // who saved a new interval was told it worked and went on waiting the old one until core
        // restarted. Every other setting here is already read inside the tick; this was the one frozen
        // number, and it is the number that decides how long "queued" lasts for a save that is
        // eventually consistent by construction.
        ctx.onSchedule(() -> Duration.ofSeconds(ingestIntervalSeconds()), this::tick);
        ctx.logger().info("wiki registered; ingest every {}s at boot, schema={}",
                ingestIntervalSeconds(), ctx.schema() == null ? "absent" : ctx.schema().namespace());
    }

    /**
     * The ingest period an operator has asked for, re-read before every tick.
     *
     * <p>Runs on a scheduler thread, so it does what a supplier in that position may do and no more: one
     * config read, no store access, no blocking. A floor of one second because registration is the strict
     * moment — a non-positive period there is rejected outright rather than falling back — and the host
     * clamps to a floor of its own on top, which makes this number a request like the manifest's others.
     *
     * @return the period in seconds, at least 1
     */
    private int ingestIntervalSeconds() {
        return Math.max(1, ctx.config().get("ingestIntervalSeconds", Integer.class, DEFAULT_INGEST_SECONDS));
    }

    /**
     * One scheduled pass: apply what the browser wrote, then refresh what the browser reads.
     *
     * <p>{@code synchronized} with {@link #eraseUser(String)}: a pass that read a deleted person's queued
     * draft before the erasure scrubbed it would otherwise write their id into a new revision after the
     * erasure cleared the old ones.
     */
    synchronized void tick() {
        try {
            ingestDrafts();
            applyDeletions();
            pruneRevisions();
            sweepOrphanedFiles();
        } catch (RuntimeException e) {
            // A failure here must not stop the projections from refreshing, or one bad draft freezes the
            // whole wiki's front page.
            ctx.logger().warn("wiki ingest pass failed", e);
        }
        ctx.store().put(Scope.site(), KEY_INDEX, buildIndex());
        // No front page written (or it was unpublished): remove the key rather than storing a null. The
        // doc store refuses a null value outright, so publishing "nothing" this way would throw on every
        // tick of a wiki nobody has written a front page for -- which is every new install.
        HomePage home = buildHome();
        if (home == null) {
            ctx.store().delete(Scope.site(), KEY_HOME);
        } else {
            ctx.store().put(Scope.site(), KEY_HOME, home);
        }
        ctx.store().put(Scope.site(), KEY_STATS, buildStats());
    }

    // --- the write path -------------------------------------------------------------------------------

    /**
     * Applies every pending draft, originals before translations.
     *
     * <p><strong>The order is not cosmetic.</strong> A translation names the page it translates, and a
     * draft naming a page that does not exist is rejected — with the draft deleted, because a rejection is
     * the author's to fix rather than something to retry forever. Save an original and its translation
     * between two ticks and the doc store hands them back in whatever order it likes: half the time the
     * translation is applied first, against a wiki that has not got the original yet, and a podcaster loses
     * writing to an accident of iteration order. Sorting costs one pass and removes the race entirely.
     *
     * <p>One pass is enough because the graph is a star: a translation only ever points at an original, so
     * there is no chain to resolve in dependency order.
     */
    private void ingestDrafts() {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        record Pending(String key, String slug, Draft draft) {}
        List<Pending> pending = new ArrayList<>();
        for (DocEntry entry : ctx.store().query(Scope.site(), DRAFT_PREFIX)) {
            Draft draft = ctx.store().get(Scope.site(), entry.key(), Draft.class).orElse(null);
            if (draft != null) {
                pending.add(new Pending(entry.key(), entry.key().substring(DRAFT_PREFIX.length()), draft));
            }
        }
        pending.sort(Comparator.comparingInt(p -> blankToNull(p.draft().translationOf()) == null ? 0 : 1));

        for (Pending item : pending) {
            try {
                ingestOne(schema, item.slug(), item.draft(), item.key());
            } catch (RuntimeException e) {
                // Report the failure to the editor rather than retrying it silently forever.
                ctx.logger().warn("wiki: draft '{}' could not be ingested", item.slug(), e);
                receipt(item.slug(), "failed", e.getMessage(), null);
                ctx.store().delete(Scope.site(), item.key());
            }
        }
    }

    private void ingestOne(SchemaStore schema, String slug, Draft draft, String draftKey) {
        if (!SLUG.matcher(slug).matches()) {
            receipt(slug, "rejected", "not a usable slug", null);
            ctx.store().delete(Scope.site(), draftKey);
            return;
        }

        String locale;
        String translationOf;
        try {
            locale = contentLocaleOf(draft);
            translationOf = translationRootFor(schema, slug, locale, draft.translationOf());
        } catch (DraftRejected e) {
            // A rejection is the author's to fix, not something to retry every 30s forever. The draft goes
            // so the receipt is the last word on it -- unlike a conflict, which keeps the writing.
            receipt(slug, "rejected", e.getMessage(), null);
            ctx.store().delete(Scope.site(), draftKey);
            return;
        }

        PageRow existing = findPage(schema, slug);
        long nextRevision = existing == null ? 1 : revisionOf(existing) + 1;

        // Lost-update detection. The draft carries the revision it was started from; if the page has moved
        // on since, two people edited the same page and the second one must not silently win. The draft is
        // KEPT so the editor can still see and resolve it -- discarding it would throw away the writing.
        if (existing != null && draft.baseRevisionNo() != null
                && draft.baseRevisionNo() != revisionOf(existing)) {
            receipt(slug, "conflict",
                    "edited from revision " + draft.baseRevisionNo() + ", now at " + revisionOf(existing),
                    revisionOf(existing));
            return;
        }

        String title = blankToNull(draft.title()) == null ? slug : draft.title().strip();
        String markdown = draft.markdown() == null ? "" : draft.markdown();
        String tags = normaliseTags(draft.tags());
        String summary = blankToNull(draft.summary()) == null
                ? WikiMarkdown.excerpt(markdown, SUMMARY_CHARS)
                : draft.summary().strip();
        String status = STATUS_PUBLISHED.equals(draft.status()) || draft.status() == null
                ? STATUS_PUBLISHED
                : draft.status();
        // Parsed once here rather than again inside replaceDerivedRows: the heading it matched belongs on
        // the page row, so the reader can strip exactly this section without carrying the vocabulary too.
        WikiMarkdown.Sources parsedSources = WikiMarkdown.sources(markdown, sourceHeadings());
        Instant now = Instant.now();

        Map<String, Object> values = new HashMap<>();
        values.put("title", title);
        values.put("summary", summary);
        values.put("markdown", markdown);
        // One fulltext field, maintained here: SchemaStore.search takes a single field, so covering title,
        // tags and summary as well as the body means concatenating them into the indexed one.
        values.put("searchText", String.join("\n", title, tags, summary, markdown));
        values.put("tags", tags);
        values.put("status", status);
        values.put("locale", locale);
        values.put("translationOf", translationOf);
        values.put("sourcesHeading", parsedSources == null ? null : parsedSources.heading());
        values.put("updatedAt", now);
        values.put("updatedBy", blankToNull(draft.author()));
        values.put("revisionNo", nextRevision);

        if (existing == null) {
            values.put("slug", slug);
            values.put("createdAt", now);
            schema.insert("page", values);
        } else {
            schema.update("page", existing.id(), values);
        }

        schema.insert("revision", Map.of(
                "pageSlug", slug,
                "revisionNo", nextRevision,
                "title", title,
                "markdown", markdown,
                "comment", draft.comment() == null ? "" : draft.comment(),
                "author", draft.author() == null ? "" : draft.author(),
                "createdAt", now));

        replaceDerivedRows(schema, slug, markdown, parsedSources);
        publishTags(slug, draft.tags());

        receipt(slug, "ok", null, nextRevision);
        ctx.store().delete(Scope.site(), draftKey);
    }

    /**
     * The language a draft says it is written in, checked against the languages this site authors in.
     *
     * <p><strong>The browser's list is a hint; what arrives here is input.</strong> The editor builds its
     * dropdown from {@code ctx.locale.content()}, but a draft is a document any podcaster may PUT, and
     * {@link Locales#isContentLocale(String)} is the only place that can say no. A page stored under a
     * language nobody offers is invisible to every reader and to the editor's own language switcher —
     * a page that quietly does not exist.
     *
     * <p>Blank is a legitimate answer and means <em>unstated</em>: every page written before this field
     * existed is in that state, and a monolingual site never leaves it. Unstated reads as the site default,
     * which is why it is not an error.
     *
     * @param draft the draft being ingested
     * @return the lower-cased locale code, or {@code null} when the author stated none
     * @throws DraftRejected when the code names a language this site does not author content in
     */
    private String contentLocaleOf(Draft draft) {
        String locale = blankToNull(draft.locale());
        if (locale == null) {
            return null;
        }
        locale = locale.strip().toLowerCase(Locale.ROOT);
        if (!ctx.locales().isContentLocale(locale)) {
            throw new DraftRejected("'" + locale + "' is not a language this site authors content in");
        }
        return locale;
    }

    /**
     * Resolves what a draft claims to translate into the root of its translation group.
     *
     * <p><strong>The graph is a star, never a chain.</strong> Every translation points straight at the
     * original, so "the other languages of this page" is one query and can neither cycle nor need a walk.
     * A draft naming another translation is collapsed one hop to that translation's own root rather than
     * refused — an author picking the German page as the thing the French one translates means the obvious
     * thing, and there is no reading of it that produces a chain.
     *
     * <p>Everything else here is an invariant with nowhere else to live: no plugin code runs at request
     * time (§7.6), so the editor's dropdown is a convenience and this is the enforcement. In particular
     * <strong>one language per group</strong> — a second German translation is a fork the reader cannot
     * present, since a language switcher can only offer one page per language.
     *
     * @param schema        the store, already known non-null
     * @param slug          the page being saved
     * @param locale        its validated language, or {@code null} when unstated
     * @param requested     what the draft claims to translate; blank means "an original"
     * @return the root page's slug, or {@code null} when this page is itself an original
     * @throws DraftRejected when the claim cannot hold
     */
    private String translationRootFor(SchemaStore schema, String slug, String locale, String requested) {
        String root = blankToNull(requested);
        if (root == null) {
            return null;
        }
        root = root.strip().toLowerCase(Locale.ROOT);
        if (root.equals(slug)) {
            throw new DraftRejected("a page cannot be a translation of itself");
        }
        PageRow target = findPage(schema, root);
        if (target == null) {
            throw new DraftRejected("there is no page '" + root + "' to translate");
        }
        // Collapse to the root, so what gets stored is always an original's slug.
        String targetsRoot = blankToNull(target.translationOf());
        if (targetsRoot != null) {
            root = targetsRoot;
            if (root.equals(slug)) {
                throw new DraftRejected("'" + target.slug() + "' is already a translation of this page");
            }
            if (findPage(schema, root) == null) {
                throw new DraftRejected("there is no page '" + root + "' to translate");
            }
        }
        // A page other pages translate cannot itself become a translation -- that is how a chain forms.
        long dependents = schema.count("page", Criteria.where("translationOf", Op.EQ, slug));
        if (dependents > 0) {
            throw new DraftRejected(
                    dependents + " page(s) already translate this one, so it cannot become a translation");
        }
        if (locale != null) {
            String holder = sameLanguageIn(schema, root, slug, locale);
            if (holder != null) {
                throw new DraftRejected("'" + holder + "' is already the " + locale + " version of '" + root + "'");
            }
        }
        return root;
    }

    /**
     * Which page in a translation group already claims a language, if any.
     *
     * @param schema the store
     * @param root   the group's original
     * @param self   the page being saved, which never collides with itself
     * @param locale the language being claimed
     * @return the slug already holding it, or {@code null}
     */
    private String sameLanguageIn(SchemaStore schema, String root, String self, String locale) {
        PageRow original = findPage(schema, root);
        if (original != null && !original.slug().equals(self) && locale.equals(original.locale())) {
            return original.slug();
        }
        for (PageRow sibling : schema.select("page",
                Criteria.where("translationOf", Op.EQ, root), PageRow.class)) {
            if (!sibling.slug().equals(self) && locale.equals(sibling.locale())) {
                return sibling.slug();
            }
        }
        return null;
    }

    /** A draft the author has to fix: reported through its receipt, never retried. */
    private static final class DraftRejected extends RuntimeException {
        DraftRejected(String message) {
            super(message);
        }
    }

    /**
     * The headings this site opens a Sources section with.
     *
     * <p>A config field rather than a table keyed off {@code page.locale}, because a per-language table
     * only helps the languages somebody thought to add — which is the same failure one step later. A
     * comma-separated list an operator edits covers a wiki written in a language nobody anticipated, and
     * it is the only place the vocabulary lives now that the reader is told which heading matched.
     *
     * @return the configured headings, lower-cased and blank-free; the shipped pair when unset
     */
    private List<String> sourceHeadings() {
        String configured = ctx.config().get("sourceHeadings", String.class, DEFAULT_SOURCE_HEADINGS);
        List<String> headings = new ArrayList<>();
        for (String heading : (configured == null ? DEFAULT_SOURCE_HEADINGS : configured).split(",")) {
            String trimmed = heading.strip().toLowerCase(Locale.ROOT);
            if (!trimmed.isEmpty() && !headings.contains(trimmed)) {
                headings.add(trimmed);
            }
        }
        return headings;
    }

    /**
     * Puts this page's tags into the site's shared vocabulary (ARCHITECTURE §6.1.1).
     *
     * <p>Before 0.9 the wiki had a private tag column and nothing else on the site could see it, so a page
     * tagged {@code lore} and an episode tagged {@code lore} were unrelated strings. Now the host owns the
     * vocabulary: it canonicalises what it is sent (trim, collapse whitespace, casefold) and keeps a
     * display label from first use, which is why near-duplicates converge instead of multiplying.
     *
     * <p>The subject key is this plugin's to invent and nobody else can name it. The {@code page.tags}
     * column stays as a local cache for listing and filtering without a round trip — it now holds the
     * host's canonical keys rather than whatever an author typed.
     *
     * <p>Untagging is per assignment and per subject. A plugin cannot remove another writer's assignment
     * or take a word out of the vocabulary, and should not want to: the vocabulary is shared, and an entry
     * outlives its last assignment.
     */
    private void publishTags(String slug, List<String> tags) {
        var vocabulary = ctx.tags();
        if (vocabulary == null) {
            return;   // the manifest declares no `tags` block; the local column is all there is
        }
        String subject = TAG_SUBJECT_PREFIX + slug;
        try {
            Set<String> wanted = new HashSet<>();
            for (String tag : tags == null ? List.<String>of() : tags) {
                if (tag != null && !tag.isBlank()) {
                    vocabulary.tagSubject(subject, tag.strip());
                    wanted.add(canonical(tag));
                }
            }
            // An edit that drops a tag has to drop the assignment too, or the tag view keeps listing a page
            // that no longer claims it.
            for (String existing : vocabulary.tagsOnSubject(subject)) {
                if (!wanted.contains(existing)) {
                    vocabulary.untagSubject(subject, existing);
                }
            }
        } catch (RuntimeException e) {
            // A vocabulary that refuses must not cost the page its save -- the local column still works.
            ctx.logger().warn("wiki: could not publish tags for '{}': {}", slug, e.toString());
        }
    }

    /**
     * Rewrites the rows derived from a body: its links, media and sources.
     *
     * <p>Delete-then-insert rather than a diff. The rows have no identity of their own -- they are a
     * projection of the markdown -- so reconciling them individually would be more code for the same
     * result, and the counts here are per page, not per wiki.
     */
    private void replaceDerivedRows(SchemaStore schema, String slug, String markdown,
                                    WikiMarkdown.Sources parsedSources) {
        schema.delete("link", Criteria.where("fromSlug", Op.EQ, slug));
        schema.delete("media", Criteria.where("pageSlug", Op.EQ, slug));
        schema.delete("source", Criteria.where("pageSlug", Op.EQ, slug));

        for (WikiMarkdown.Link link : WikiMarkdown.links(markdown)) {
            schema.insert("link", Map.of(
                    "fromSlug", slug,
                    "toSlug", link.toSlug(),
                    "kind", link.kind(),
                    "label", link.label()));
        }
        int position = 0;
        for (WikiMarkdown.Media item : WikiMarkdown.media(markdown)) {
            Map<String, Object> row = new HashMap<>();
            row.put("pageSlug", slug);
            row.put("url", item.url());
            row.put("uploadRef", item.uploadRef());
            row.put("kind", item.kind());
            row.put("provider", item.provider());
            row.put("caption", item.caption());
            row.put("position", (long) position++);
            schema.insert("media", row);
        }
        position = 0;
        for (WikiMarkdown.Source source : parsedSources == null ? List.<WikiMarkdown.Source>of() : parsedSources.items()) {
            Map<String, Object> row = new HashMap<>();
            row.put("pageSlug", slug);
            row.put("label", source.label());
            row.put("url", source.url());
            row.put("note", source.note());
            row.put("position", (long) position++);
            schema.insert("source", row);
        }
    }

    /**
     * Applies tombstones. A page is removed by writing {@code delete:<slug>}, because the doc surface is
     * the only thing the browser can write and a deletion has to cascade across four entities.
     */
    private void applyDeletions() {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        for (DocEntry entry : ctx.store().query(Scope.site(), DELETE_PREFIX)) {
            String slug = entry.key().substring(DELETE_PREFIX.length());
            schema.delete("page", Criteria.where("slug", Op.EQ, slug));
            schema.delete("revision", Criteria.where("pageSlug", Op.EQ, slug));
            schema.delete("link", Criteria.where("fromSlug", Op.EQ, slug));
            schema.delete("media", Criteria.where("pageSlug", Op.EQ, slug));
            schema.delete("source", Criteria.where("pageSlug", Op.EQ, slug));
            // Links *to* the removed page are left alone on purpose: they become red links, which is the
            // honest state -- something still points here, and the dashboard should be able to say so.
            publishTags(slug, List.of());   // the page is gone; its claims on the vocabulary go with it
            ctx.store().delete(Scope.site(), entry.key());
            ctx.store().delete(Scope.site(), DRAFT_PREFIX + slug);
            receipt(slug, "deleted", null, null);
            ctx.logger().info("wiki: removed page '{}'", slug);
        }
    }

    /** Drops the oldest revisions of any page that has more than the configured number. */
    private void pruneRevisions() {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        int keep = Math.max(1, ctx.config().get("revisionsKept", Integer.class, DEFAULT_REVISIONS_KEPT));
        for (PageRow page : schema.select("page", Criteria.all(), PageRow.class)) {
            long total = schema.count("revision", Criteria.where("pageSlug", Op.EQ, page.slug()));
            if (total <= keep) {
                continue;
            }
            long cutoff = revisionOf(page) - keep;
            schema.delete("revision", Criteria.where("pageSlug", Op.EQ, page.slug())
                    .and("revisionNo", Op.LTE, cutoff));
        }
    }

    /**
     * Deletes uploaded files no page points at any more.
     *
     * <p><strong>Nothing else collects them.</strong> A file outlives the row that named it, and only this
     * plugin knows which refs are still in use -- the host cannot tell an orphan from a file a draft is
     * about to reference. So the wiki sweeps its own.
     *
     * <p>The grace period is the whole subtlety. An author uploads an image and the editor writes the ref
     * into the body, but the draft is not saved until they say so, and it is not ingested until the next
     * tick -- so for a while a perfectly live file is referenced by nothing this side can see. Sweeping on
     * age alone would delete the image out from under someone still writing the paragraph around it.
     */
    private void sweepOrphanedFiles() {
        var blobs = ctx.blobs();
        SchemaStore schema = ctx.schema();
        if (blobs == null || schema == null) {
            return;
        }
        // Zero is allowed and means "sweep an unreferenced file as soon as it is seen". That is a real
        // choice for an install whose authors never leave an upload unsaved, and it is the only way to
        // observe this behaviour without waiting an hour -- but it is not the default, because the
        // default has to protect the author still writing the paragraph around the image.
        int graceMinutes = Math.max(0,
                ctx.config().get("blobGraceMinutes", Integer.class, DEFAULT_BLOB_GRACE_MINUTES));
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(graceMinutes));

        Set<String> referenced = new HashSet<>();
        for (MediaRow row : schema.select("media", Criteria.where("uploadRef", Op.IS_NOT_NULL, null), MediaRow.class)) {
            if (blankToNull(row.uploadRef()) != null) {
                referenced.add(row.uploadRef());
            }
        }
        // A ref sitting in an unapplied draft is live too -- the body is written, just not ingested yet.
        for (DocEntry draft : ctx.store().query(Scope.site(), DRAFT_PREFIX)) {
            referenced.addAll(refsIn(draft.value() == null ? null : draft.value().toString()));
        }
        // And a file in the media library, which is the whole point of a library: it is uploaded once,
        // named, and placed on a page later -- possibly much later. Without this it has no `media` row and
        // no draft naming it, so the sweep would delete a podcaster's uploads an hour after they arrived.
        for (DocEntry asset : ctx.store().query(Scope.site(), ASSET_PREFIX)) {
            referenced.add(asset.key().substring(ASSET_PREFIX.length()));
        }

        int removed = 0;
        for (BlobInfo file : blobs.list(0, BLOB_PAGE)) {
            if (referenced.contains(file.ref())) {
                continue;
            }
            if (file.updatedAt() != null && file.updatedAt().isAfter(cutoff)) {
                continue;   // too new to judge: someone may still be writing the page around it
            }
            if (blobs.delete(file.ref())) {
                removed++;
            }
        }
        if (removed > 0) {
            ctx.logger().info("wiki: removed {} uploaded file(s) no page references", removed);
        }
    }

    /** Every {@code blob:<ref>} a body mentions, however the body reached us. */
    private static Set<String> refsIn(String text) {
        Set<String> refs = new HashSet<>();
        if (text == null) {
            return refs;
        }
        Matcher matcher = BLOB_REF.matcher(text);
        while (matcher.find()) {
            refs.add(matcher.group(1));
        }
        return refs;
    }

    private void receipt(String slug, String state, String detail, Long revisionNo) {
        ctx.store().put(Scope.site(), INGEST_PREFIX + slug,
                new IngestReceipt(state, detail, revisionNo, Instant.now().toString()));
    }

    // --- the projections the browser reads ------------------------------------------------------------

    /**
     * The page index: enough to render a list, and to tell a live wiki link from a red one without a
     * round trip per link.
     *
     * @return slug -> summary, empty until pages exist
     */
    private Map<String, PageSummary> buildIndex() {
        Map<String, PageSummary> index = new LinkedHashMap<>();
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return index;
        }
        for (PageRow page : schema.select("page",
                Criteria.where("status", Op.EQ, STATUS_PUBLISHED).orderBy("updatedAt", Direction.DESC),
                PageRow.class)) {
            index.put(page.slug(), new PageSummary(page.title(), page.summary(), page.tags(),
                    page.updatedAt() == null ? null : page.updatedAt().toString(),
                    page.locale(), page.translationOf()));
        }
        return index;
    }

    /**
     * The front page, if the configured slug names a published page.
     *
     * <p>Returns {@code null} when the podcaster has not written one, or has unpublished it — the home view
     * then shows only what it can generate, which is the state a new install is in and has to look
     * deliberate rather than broken.
     */
    private HomePage buildHome() {
        SchemaStore schema = ctx.schema();
        String slug = ctx.config().get("homePageSlug", String.class, DEFAULT_HOME_SLUG);
        if (schema == null || slug == null || slug.isBlank()) {
            return null;
        }
        PageRow page = findPage(schema, slug.strip());
        if (page == null || !STATUS_PUBLISHED.equals(page.status())) {
            return null;
        }
        return new HomePage(page.slug(), page.title(), page.markdown(),
                page.updatedAt() == null ? null : page.updatedAt().toString());
    }

    private WikiStats buildStats() {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return new WikiStats(0, 0, 0, 0);
        }
        long pages = schema.count("page", Criteria.all());
        List<PageRow> all = schema.select("page", Criteria.all(), PageRow.class);
        List<WikiLinkRow> wikiLinks = schema.select("link",
                Criteria.where("kind", Op.EQ, "wiki"), WikiLinkRow.class);

        long orphans = all.stream()
                .filter(page -> wikiLinks.stream().noneMatch(link -> link.toSlug().equals(page.slug())))
                .count();
        long broken = wikiLinks.stream()
                .map(WikiLinkRow::toSlug)
                .distinct()
                .filter(target -> all.stream().noneMatch(page -> page.slug().equals(target)))
                .count();
        long pending = ctx.store().query(Scope.site(), DRAFT_PREFIX).size();
        return new WikiStats(pages, orphans, broken, pending);
    }

    // --- the host's extension points ------------------------------------------------------------------

    @Override
    public Optional<OgMeta> metaFor(String subpath) {
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null || subpath == null) {
            return Optional.empty();
        }
        String slug = subpathToSlug(subpath);
        if (slug == null) {
            return Optional.empty();   // the wiki's own views have no page of their own to describe
        }
        PageRow page = findPage(schema, slug);
        if (page == null || !STATUS_PUBLISHED.equals(page.status())) {
            return Optional.empty();   // core falls back to the site's own OG tags
        }
        String description = blankToNull(page.summary()) == null
                ? WikiMarkdown.excerpt(page.markdown(), SUMMARY_CHARS)
                : page.summary();
        // `og:locale` is the language of *this* page, not of the install (§6.4, contract 0.12.0). A German
        // article stays German for an English visitor, so announcing it in the request's locale would be
        // the install-wide bug one level down. Null when the author stated no language: "whatever the host
        // resolved" is the honest answer for a page that never claimed one.
        return Optional.of(new OgMeta(page.title(), description, firstImage(schema, slug), page.locale()));
    }

    /**
     * Every published page, each carrying the other languages it exists in.
     *
     * <p><strong>The map of paths is what this plugin needed and a list of locale codes could not give
     * it.</strong> A wiki translation lives at its own slug — {@code /p/wiki/the-kraken} and
     * {@code /p/wiki/der-krake} are one article in two languages — so "this page also exists in German",
     * with the host appending {@code ?lang=de} to a single path, would have described a wiki nobody has.
     * Every member of a group therefore declares the <em>same</em> map, which is also what stops two
     * entries handing a crawler two answers to one question.
     *
     * <p><strong>An alternate is a claim about content, so three things have to be true before one is
     * made:</strong> the page states a language (an unstated one means "the site default", which is a guess
     * and not a claim), the group has more than one member (a group of one is an hreflang set that says
     * nothing), and every member is <em>published</em> — the same per-row rule the reader and
     * {@code SearchProvider} follow, in a fourth place, because an unpublished translation announced to a
     * crawler is a promise of a page it will be served a 404 for.
     *
     * @return the entries, each with its translation group where there is one
     */
    @Override
    public List<SitemapUrl> urls() {
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null) {
            return List.of();
        }
        List<PageRow> published = schema.select("page",
                Criteria.where("status", Op.EQ, STATUS_PUBLISHED), PageRow.class);

        // slug -> its group's alternates, built once per group so every member declares the same map.
        Map<String, Map<String, String>> groups = translationGroups(published);

        List<SitemapUrl> urls = new ArrayList<>();
        for (PageRow page : published) {
            urls.add(new SitemapUrl("/p/wiki/" + page.slug(), page.updatedAt(),
                    groups.getOrDefault(page.slug(), Map.of())));
        }
        return urls;
    }

    /**
     * Builds one alternates map per translation group and hands it to every member.
     *
     * @param published every published page
     * @return slug -> the group's locale-to-path map, absent for a page with no group worth declaring
     */
    private static Map<String, Map<String, String>> translationGroups(List<PageRow> published) {
        Map<String, Map<String, String>> byRoot = new LinkedHashMap<>();
        Map<String, List<String>> membersByRoot = new LinkedHashMap<>();

        for (PageRow page : published) {
            String root = blankToNull(page.translationOf()) == null ? page.slug() : page.translationOf();
            String locale = blankToNull(page.locale());
            membersByRoot.computeIfAbsent(root, key -> new ArrayList<>()).add(page.slug());
            if (locale == null) {
                continue;   // no stated language, so nothing honest to say about this member
            }
            // Sorted by locale code: the same rows must produce the same sitemap, and insertion order here
            // is whatever order the query happened to return.
            Map<String, String> alternates = byRoot.computeIfAbsent(root, key -> new TreeMap<>());
            // The ingest tick refuses two pages in one language per group, so a collision here would mean
            // rows written before that rule existed. Keep the first and say nothing about the second
            // rather than throw: SitemapUrl rejects a duplicate locale, and a throw here costs the whole
            // site's plugin sitemap over one bad row.
            alternates.putIfAbsent(locale, "/p/wiki/" + page.slug());
        }

        Map<String, Map<String, String>> bySlug = new LinkedHashMap<>();
        byRoot.forEach((root, alternates) -> {
            if (alternates.size() < 2) {
                return;   // a group of one is an hreflang set that says nothing
            }
            Map<String, String> shared = Collections.unmodifiableMap(new LinkedHashMap<>(alternates));
            for (String member : membersByRoot.getOrDefault(root, List.of())) {
                // Only a member the map actually names: SitemapUrl requires an entry pointing at `loc`,
                // and a page whose language is unstated has none.
                if (shared.containsValue("/p/wiki/" + member)) {
                    bySlug.put(member, shared);
                }
            }
        });
        return bySlug;
    }

    /**
     * The page a {@code /p/wiki/...} subpath is about.
     *
     * <p>{@code the-kraken}, {@code the-kraken/history} and {@code the-kraken/edit} all describe the same
     * page for sharing purposes; the wiki's own verbs describe none.
     */
    private static String subpathToSlug(String subpath) {
        String first = subpath.startsWith("/") ? subpath.substring(1) : subpath;
        int slash = first.indexOf('/');
        if (slash >= 0) {
            first = first.substring(0, slash);
        }
        return SLUG.matcher(first).matches() ? first : null;
    }

    /** The page's first image, for a share preview. An upload is addressed by ref, never by stored URL. */
    private String firstImage(SchemaStore schema, String slug) {
        List<MediaRow> media = schema.select("media",
                Criteria.where("pageSlug", Op.EQ, slug).orderBy("position", Direction.ASC).limit(1),
                MediaRow.class);
        if (media.isEmpty()) {
            return null;
        }
        MediaRow first = media.get(0);
        if (blankToNull(first.uploadRef()) != null && ctx.blobs() != null) {
            return ctx.blobs().urlFor(first.uploadRef());
        }
        return blankToNull(first.url());
    }


    // --- the 0.9 extension points ---------------------------------------------------------------------

    /** The wiki's own verbs. A slug can never collide with one: a slug may not start with an underscore. */
    private static final Set<String> VERBS =
            Set.of("_all", "_random", "_new", "_search", "_tag", "_admin");

    /** The sub-views a page subpath may carry, mirroring the frontend's routes. */
    private static final Set<String> PAGE_SUFFIXES = Set.of("history", "edit", "rev");

    /**
     * Whether a subpath under {@code /p/wiki/} is a real route, so the host can answer a proper 404 for
     * everything else (ARCHITECTURE §6.6).
     *
     * <p>This is the plugin half of a problem this repo filed as mosaicast-core#89. Core knows the wiki
     * declared a {@code page} slot; it cannot know that {@code /p/wiki/nowhere} is not a page, so every
     * subpath answered 200 and a crawler indexed the wiki's typos and its deleted pages while
     * {@code sitemap.xml} listed only the real ones.
     *
     * <p><strong>Anything this forgets to claim disappears from search results</strong>, and the failure is
     * invisible from a visitor's side because the shell still renders. So the verbs are enumerated rather
     * than caught by a default, and the test walks the same list.
     *
     * <p>Deliberately not {@link #metaFor(String)} reused: that says how to <em>describe</em> a page, and
     * the wiki has views with nothing to describe on purpose ({@code _search}, {@code _admin}). Reading
     * "no OpenGraph" as "no page" would 404 working routes.
     */
    @Override
    public boolean hasRoute(String subpath) {
        String path = subpath == null ? "" : subpath;
        while (path.startsWith("/")) {
            path = path.substring(1);
        }
        // The root is a route. A provider written as a lookup over slugs answers false here and 404s the
        // wiki's own landing page.
        if (path.isEmpty()) {
            return true;
        }

        String[] segments = path.split("/");
        String first = segments[0];
        if (first.startsWith("_")) {
            return VERBS.contains(first);
        }
        if (segments.length > 1 && !PAGE_SUFFIXES.contains(segments[1])) {
            return false;
        }
        // Only a *published* page is a public route. A draft answering 200 would put it in a crawler's
        // index, which is the opposite of what an unpublished page is for. A podcaster opening one still
        // gets the editable page -- this decides the status line, not the body.
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null) {
            return false;
        }
        PageRow page = findPage(schema, first);
        return page != null && STATUS_PUBLISHED.equals(page.status());
    }

    /**
     * Wiki pages in the site's own search (ARCHITECTURE §6.7), instead of the second search box this
     * plugin would otherwise have grown.
     *
     * <p><strong>Access is this plugin's job here, and only here.</strong> Everywhere else the host resolves
     * who may see what; it cannot, because it has no model of a wiki page and no way to know that
     * {@code status} decides visibility. A provider that returned a draft to an anonymous visitor would be
     * a leak nothing else catches — so the status filter is unconditional rather than role-dependent, which
     * is the version that cannot be got wrong by adding a role later.
     *
     * @param query what the visitor typed, verbatim; the host's full-text search takes operators and never
     *              throws on a stray one
     * @param role  the caller's role, or {@code null} for an anonymous visitor
     * @param limit the most hits to return
     */
    @Override
    public List<SearchHit> search(String query, Role role, int limit) {
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null || query == null || query.isBlank() || limit <= 0) {
            return List.of();
        }
        List<SearchHit> hits = new ArrayList<>();
        List<PageRow> found = schema.search("page", "searchText", query,
                Criteria.where("status", Op.EQ, STATUS_PUBLISHED).limit(limit), PageRow.class);
        for (PageRow page : found) {
            String snippet = blankToNull(page.summary()) == null
                    ? WikiMarkdown.excerpt(page.markdown(), SNIPPET_CHARS)
                    : page.summary();
            // The host resolves the subpath under /p/wiki/ and drops any attempt to climb out of it, the
            // same confinement ctx.route.navigate has.
            hits.add(new SearchHit(page.slug(), page.title(), snippet, 1.0));
        }
        return hits;
    }

    /**
     * Cuts a deleted account's identity out of the wiki's own tables (ARCHITECTURE §12.8).
     *
     * <p>Core drops what it stored — identities, tokens, progress, the {@code USER}-scope documents — but it
     * provisioned these tables without ever learning which column is a person, so it has to ask.
     *
     * <p><strong>Pseudonymise, not erase.</strong> A revision is a public contribution (§13): the edit
     * happened, and a history with holes in it is worse than one attributed to nobody. So the rows stay and
     * the identity link is cut. Deleting them would also leave a current page body with no revision that
     * produced it.
     *
     * <p>Idempotent by construction — the second call matches nothing, which is what a retried erasure
     * needs.
     */
    @Override
    public synchronized void eraseUser(String userId) {
        if (ctx == null || userId == null || userId.isBlank()) {
            return;
        }
        // The doc store first: a queued draft carries its author, and the next pass would write that id into
        // a fresh revision -- re-creating the very link this call cuts. Drafts, deletion requests and library
        // entries keep their content; only the field naming the person goes.
        scrubPerson(DRAFT_PREFIX, "author", userId);
        scrubPerson(DELETE_PREFIX, "requestedBy", userId);
        scrubPerson(ASSET_PREFIX, "addedBy", userId);
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        Map<String, Object> cleared = new HashMap<>();
        cleared.put("author", null);
        for (RevisionAuthor revision : schema.select("revision",
                Criteria.where("author", Op.EQ, userId), RevisionAuthor.class)) {
            schema.update("revision", revision.id(), cleared);
        }
        Map<String, Object> clearedPage = new HashMap<>();
        clearedPage.put("updatedBy", null);
        for (PageRow page : schema.select("page",
                Criteria.where("updatedBy", Op.EQ, userId), PageRow.class)) {
            schema.update("page", page.id(), clearedPage);
        }
        ctx.logger().info("wiki: cleared the identity link on contributions by a deleted account");
    }

    /** Nulls {@code field} in every site document under {@code prefix} whose value is this person's id. */
    @SuppressWarnings("unchecked")
    private void scrubPerson(String prefix, String field, String userId) {
        for (DocEntry entry : ctx.store().query(Scope.site(), prefix)) {
            Map<String, Object> doc = ctx.store().get(Scope.site(), entry.key(), Map.class).orElse(null);
            if (doc != null && userId.equals(doc.get(field))) {
                Map<String, Object> scrubbed = new LinkedHashMap<>(doc);
                scrubbed.put(field, null);
                ctx.store().put(Scope.site(), entry.key(), scrubbed);
            }
        }
    }

    /**
     * A person's part of their data export (GDPR Art. 15 and 20): what they wrote here, in a file another
     * tool can read back.
     *
     * <p>A revision's {@code author} is a site-scoped UUID, and that is still this person — {@code ctx.users}
     * turns it into their name. So {@code revisions.json} lists every retained revision they authored with
     * its text, newest first; {@code uploads.json} the media-library entries they filed (the entries, not the
     * files, which stay reachable at their public address); {@code queued.json} a save or deletion still
     * waiting for the next pass. A file is left out when it would be empty, and nothing at all is
     * {@link Optional#empty()} — the host then records "no data", which is the truth for a reader who never
     * edited.
     *
     * <p>Revisions past {@code revisionsKept} were pruned before anyone asked, so they are not here: the
     * export describes what the wiki holds, not what it once did.
     */
    @Override
    public Optional<UserExport> exportFiles(String userId) {
        if (ctx == null || userId == null || userId.isBlank()) {
            return Optional.empty();
        }
        List<ExportFile> files = new ArrayList<>();
        SchemaStore schema = ctx.schema();
        if (schema != null) {
            exportRevisions(schema, userId).ifPresent(files::add);
        }
        exportUploads(userId).ifPresent(files::add);
        exportQueued(userId).ifPresent(files::add);
        return files.isEmpty() ? Optional.empty() : Optional.of(new UserExport(files));
    }

    private Optional<ExportFile> exportRevisions(SchemaStore schema, String userId) {
        List<RevisionRow> revisions = new ArrayList<>(schema.select("revision",
                Criteria.where("author", Op.EQ, userId), RevisionRow.class));
        List<String> lastEditorOf = schema.select("page", Criteria.where("updatedBy", Op.EQ, userId), PageRow.class)
                .stream().map(PageRow::slug).sorted().toList();
        if (revisions.isEmpty() && lastEditorOf.isEmpty()) {
            return Optional.empty();
        }
        revisions.sort(Comparator.comparing(RevisionRow::createdAt, Comparator.nullsFirst(Comparator.naturalOrder()))
                .reversed());

        List<Map<String, Object>> entries = new ArrayList<>();
        long budget = EXPORT_BODY_BUDGET;
        int omitted = 0;
        for (RevisionRow revision : revisions) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("page", revision.pageSlug());
            entry.put("revisionNo", revision.revisionNo());
            entry.put("createdAt", revision.createdAt() == null ? null : revision.createdAt().toString());
            entry.put("title", revision.title());
            entry.put("comment", blankToNull(revision.comment()));
            String markdown = revision.markdown() == null ? "" : revision.markdown();
            long size = markdown.getBytes(StandardCharsets.UTF_8).length;
            if (size <= budget) {
                entry.put("markdown", markdown);
                budget -= size;
            } else {
                entry.put("markdownOmitted", true);
                omitted++;
            }
            entries.add(entry);
        }

        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("format", "mosaicast-wiki-revisions/1");
        doc.put("revisions", entries);
        doc.put("lastEditorOf", lastEditorOf);
        if (omitted > 0) {
            doc.put("markdownOmitted", omitted);
        }
        return Optional.of(jsonFile("revisions.json", doc));
    }

    @SuppressWarnings("unchecked")
    private Optional<ExportFile> exportUploads(String userId) {
        List<Map<String, Object>> uploads = new ArrayList<>();
        for (DocEntry entry : ctx.store().query(Scope.site(), ASSET_PREFIX)) {
            Map<String, Object> asset = ctx.store().get(Scope.site(), entry.key(), Map.class).orElse(null);
            if (asset != null && userId.equals(asset.get("addedBy"))) {
                Map<String, Object> upload = new LinkedHashMap<>();
                upload.put("ref", entry.key().substring(ASSET_PREFIX.length()));
                upload.put("name", asset.get("name"));
                upload.put("mime", asset.get("mime"));
                upload.put("addedAt", asset.get("at"));
                uploads.add(upload);
            }
        }
        if (uploads.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("format", "mosaicast-wiki-uploads/1");
        doc.put("uploads", uploads);
        return Optional.of(jsonFile("uploads.json", doc));
    }

    @SuppressWarnings("unchecked")
    private Optional<ExportFile> exportQueued(String userId) {
        List<Map<String, Object>> drafts = new ArrayList<>();
        for (DocEntry entry : ctx.store().query(Scope.site(), DRAFT_PREFIX)) {
            Map<String, Object> draft = ctx.store().get(Scope.site(), entry.key(), Map.class).orElse(null);
            if (draft != null && userId.equals(draft.get("author"))) {
                Map<String, Object> queued = new LinkedHashMap<>();
                queued.put("page", entry.key().substring(DRAFT_PREFIX.length()));
                queued.put("title", draft.get("title"));
                queued.put("comment", draft.get("comment"));
                queued.put("markdown", draft.get("markdown"));
                drafts.add(queued);
            }
        }
        List<String> deletions = new ArrayList<>();
        for (DocEntry entry : ctx.store().query(Scope.site(), DELETE_PREFIX)) {
            Map<String, Object> request = ctx.store().get(Scope.site(), entry.key(), Map.class).orElse(null);
            if (request != null && userId.equals(request.get("requestedBy"))) {
                deletions.add(entry.key().substring(DELETE_PREFIX.length()));
            }
        }
        if (drafts.isEmpty() && deletions.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("format", "mosaicast-wiki-queued/1");
        doc.put("drafts", drafts);
        doc.put("deletions", deletions);
        return Optional.of(jsonFile("queued.json", doc));
    }

    private static ExportFile jsonFile(String path, Object doc) {
        return new ExportFile(path, "application/json",
                JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(doc));
    }

    /** Only the parts of a {@code revision} row the erasure touches. */
    record RevisionAuthor(long id, String pageSlug, String author) {}

    /** A {@code revision} row as a person's export reports it. */
    record RevisionRow(long id, String pageSlug, Long revisionNo, String title, String markdown, String comment,
                       String author, Instant createdAt) {}

    // --- helpers --------------------------------------------------------------------------------------

    private static PageRow findPage(SchemaStore schema, String slug) {
        List<PageRow> found = schema.select("page",
                Criteria.where("slug", Op.EQ, slug).limit(1), PageRow.class);
        return found.isEmpty() ? null : found.get(0);
    }

    private static long revisionOf(PageRow page) {
        return page.revisionNo() == null ? 0 : page.revisionNo();
    }

    /**
     * The host's canonicalisation, mirrored so the local cache holds the same keys the vocabulary does.
     *
     * <p>Same rule as {@code §6.1.1}: trim, collapse internal whitespace, casefold. Mirrored rather than
     * read back one call at a time — and if the two ever disagree, the host's answer is the real one.
     */
    private static String canonical(String tag) {
        return tag.strip().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
    }

    /** Tags as one indexed string, canonical and comma-separated, so {@code LIKE} can match one. */
    private static String normaliseTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return "";
        }
        return tags.stream()
                .filter(tag -> tag != null && !tag.isBlank())
                .map(WikiPlugin::canonical)
                .distinct()
                .reduce((a, b) -> a + "," + b)
                .orElse("");
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    // --- shapes ---------------------------------------------------------------------------------------

    /** What the editor writes to {@code draft:<slug>}. Every field is optional except the body. */
    record Draft(String title, String summary, String markdown, List<String> tags, String status,
                 String comment, String author, Long baseRevisionNo, String locale, String translationOf) {}

    /** The receipt the editor polls after saving, at {@code ingest:<slug>}. */
    record IngestReceipt(String state, String detail, Long revisionNo, String at) {}

    /** A row of the {@code page} entity; component names match the manifest's field names. */
    record PageRow(long id, String slug, String title, String summary, String markdown, String searchText,
                   String tags, String status, String sourcesHeading, String locale, String translationOf,
                   Instant createdAt, Instant updatedAt, String updatedBy, Long revisionNo) {}

    /** Only the parts of a {@code link} row the backend reasons about. */
    record WikiLinkRow(long id, String fromSlug, String toSlug, String kind, String label) {}

    /** Only the parts of a {@code media} row the share preview needs. */
    record MediaRow(long id, String pageSlug, String url, String uploadRef, String kind, String provider,
                    String caption, Long position) {}

    /** The wiki's front page, as the home view renders it. */
    record HomePage(String slug, String title, String markdown, String updatedAt) {}

    /** One page as the frontend's index needs it. */
    record PageSummary(String title, String summary, String tags, String updatedAt, String locale,
                       String translationOf) {}

    /** The counters the podcaster dashboard shows. */
    record WikiStats(long pages, long orphans, long brokenLinks, long pendingDrafts) {}
}
