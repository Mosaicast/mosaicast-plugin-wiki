// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import dev.mosaicast.plugin.api.BlobInfo;
import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Criteria.Direction;
import dev.mosaicast.plugin.api.Criteria.Op;
import dev.mosaicast.plugin.api.DocEntry;
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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.HashSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.pf4j.Extension;

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

    /** The namespace this plugin tags under. Opaque to the host, and nobody else can name it. */
    private static final String TAG_SUBJECT_PREFIX = "page:";

    /** How many files one sweep looks at. A wiki's library is small; this bounds a pathological one. */
    private static final int BLOB_PAGE = 200;

    private PluginContext ctx;

    @Override
    public void register(PluginContext ctx) {
        this.ctx = ctx;

        // Publish once at boot: a backend-owned key is only closed to clients from the moment the manifest
        // declares it, so anything forged earlier survives until this overwrites it.
        tick();

        int seconds = ctx.config().get("ingestIntervalSeconds", Integer.class, DEFAULT_INGEST_SECONDS);
        ctx.onSchedule(Duration.ofSeconds(Math.max(1, seconds)), this::tick);
        ctx.logger().info("wiki registered; ingest every {}s, schema={}",
                seconds, ctx.schema() == null ? "absent" : ctx.schema().namespace());
    }

    /** One scheduled pass: apply what the browser wrote, then refresh what the browser reads. */
    void tick() {
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
        ctx.store().put(Scope.site(), KEY_STATS, buildStats());
    }

    // --- the write path -------------------------------------------------------------------------------

    private void ingestDrafts() {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        for (DocEntry entry : ctx.store().query(Scope.site(), DRAFT_PREFIX)) {
            String slug = entry.key().substring(DRAFT_PREFIX.length());
            Draft draft = ctx.store().get(Scope.site(), entry.key(), Draft.class).orElse(null);
            if (draft == null) {
                continue;
            }
            try {
                ingestOne(schema, slug, draft, entry.key());
            } catch (RuntimeException e) {
                // Report the failure to the editor rather than retrying it silently forever.
                ctx.logger().warn("wiki: draft '{}' could not be ingested", slug, e);
                receipt(slug, "failed", e.getMessage(), null);
                ctx.store().delete(Scope.site(), entry.key());
            }
        }
    }

    private void ingestOne(SchemaStore schema, String slug, Draft draft, String draftKey) {
        if (!SLUG.matcher(slug).matches()) {
            receipt(slug, "rejected", "not a usable slug", null);
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

        replaceDerivedRows(schema, slug, markdown);
        publishTags(slug, draft.tags());

        receipt(slug, "ok", null, nextRevision);
        ctx.store().delete(Scope.site(), draftKey);
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
    private void replaceDerivedRows(SchemaStore schema, String slug, String markdown) {
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
        for (WikiMarkdown.Source source : WikiMarkdown.sources(markdown)) {
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
                    page.updatedAt() == null ? null : page.updatedAt().toString()));
        }
        return index;
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
        return Optional.of(new OgMeta(page.title(), description, firstImage(schema, slug)));
    }

    @Override
    public List<SitemapUrl> urls() {
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null) {
            return List.of();
        }
        List<SitemapUrl> urls = new ArrayList<>();
        for (PageRow page : schema.select("page",
                Criteria.where("status", Op.EQ, STATUS_PUBLISHED), PageRow.class)) {
            urls.add(new SitemapUrl("/p/wiki/" + page.slug(), page.updatedAt()));
        }
        return urls;
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
    public void eraseUser(String userId) {
        SchemaStore schema = ctx == null ? null : ctx.schema();
        if (schema == null || userId == null || userId.isBlank()) {
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

    /** Only the parts of a {@code revision} row the erasure touches. */
    record RevisionAuthor(long id, String pageSlug, String author) {}

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
                 String comment, String author, Long baseRevisionNo) {}

    /** The receipt the editor polls after saving, at {@code ingest:<slug>}. */
    record IngestReceipt(String state, String detail, Long revisionNo, String at) {}

    /** A row of the {@code page} entity; component names match the manifest's field names. */
    record PageRow(long id, String slug, String title, String summary, String markdown, String searchText,
                   String tags, String status, Instant createdAt, Instant updatedAt, String updatedBy,
                   Long revisionNo) {}

    /** Only the parts of a {@code link} row the backend reasons about. */
    record WikiLinkRow(long id, String fromSlug, String toSlug, String kind, String label) {}

    /** Only the parts of a {@code media} row the share preview needs. */
    record MediaRow(long id, String pageSlug, String url, String uploadRef, String kind, String provider,
                    String caption, Long position) {}

    /** One page as the frontend's index needs it. */
    record PageSummary(String title, String summary, String tags, String updatedAt) {}

    /** The counters the podcaster dashboard shows. */
    record WikiStats(long pages, long orphans, long brokenLinks, long pendingDrafts) {}
}
