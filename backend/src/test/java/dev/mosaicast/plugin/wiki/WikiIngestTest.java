// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Criteria.Op;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The write path: a document the browser wrote becomes rows the browser can query.
 *
 * <p>{@code FakePluginContext} runs {@code onSchedule} synchronously, so {@code register} is one full
 * ingest pass and a second pass is {@code plugin.tick()}. {@code FakeSchemaStore} enforces the same
 * declaration the host does, so a field the manifest does not declare fails here rather than at load.
 */
class WikiIngestTest {

    private static FakeSchemaStore schema() {
        // Built from plugin.json, never transcribed -- see WikiSchemaFixture for why.
        return WikiSchemaFixture.schema();
    }

    private static FakePluginContext ctx(FakeSchemaStore schema, MapPluginConfig config) {
        return new FakePluginContext(new InMemoryDocStore(), config,
                new FakeFeedAccess(Map.of()), schema);
    }

    private static FakePluginContext ctx(FakeSchemaStore schema) {
        return ctx(schema, new MapPluginConfig());
    }

    /** Writes what the editor would write: a draft document under the page's slug. */
    private static void draft(FakePluginContext ctx, String slug, Map<String, Object> fields) {
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + slug, fields);
    }

    private static List<WikiPlugin.PageRow> pages(FakeSchemaStore schema) {
        return schema.select("page", Criteria.all(), WikiPlugin.PageRow.class);
    }

    @Test
    void turnsADraftIntoAPageAndItsFirstRevision() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of(
                "title", "The Kraken",
                "markdown", "A **very** large squid.",
                "tags", List.of("Lore", "sea")));

        new WikiPlugin().register(ctx);

        var page = pages(schema).get(0);
        assertEquals("the-kraken", page.slug());
        assertEquals("The Kraken", page.title());
        assertEquals(1L, page.revisionNo());
        assertEquals("lore,sea", page.tags(), "tags are normalised so an indexed LIKE can match one");
        assertEquals(1, schema.count("revision", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.class).isEmpty(),
                "an applied draft is consumed, or every tick would re-apply it");
    }

    @Test
    void indexesTitleTagsAndSummaryAlongsideTheBody() {
        // SchemaStore.search takes ONE field, so covering more than the body means concatenating into it.
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of(
                "title", "The Kraken", "summary", "A cephalopod of unusual size",
                "markdown", "Seen off Norway.", "tags", List.of("lore")));

        new WikiPlugin().register(ctx);

        for (String term : List.of("Kraken", "lore", "cephalopod", "Norway")) {
            assertFalse(schema.search("page", "searchText", term, Criteria.all(), WikiPlugin.PageRow.class)
                    .isEmpty(), "should be findable by '" + term + "'");
        }
    }

    @Test
    void derivesASummaryWhenTheEditorGivesNone() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken",
                "markdown", "# The Kraken\n\nA very large squid.\n\nMore later."));

        new WikiPlugin().register(ctx);

        assertEquals("A very large squid.", pages(schema).get(0).summary());
    }

    @Test
    void appendsARevisionPerSaveAndKeepsTheOldBody() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "First."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "Second.",
                "baseRevisionNo", 1, "comment", "expanded"));
        plugin.tick();

        assertEquals(1, pages(schema).size(), "a second save updates the page rather than adding one");
        assertEquals(2L, pages(schema).get(0).revisionNo());
        assertEquals("Second.", pages(schema).get(0).markdown());
        assertEquals(2, schema.count("revision", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
    }

    @Test
    void refusesASaveStartedFromAnOlderRevisionAndKeepsTheWriting() {
        // Two people edited the same page. The second must not silently win -- and the draft is KEPT, or
        // resolving the conflict would mean retyping the losing version.
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "First."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "Second.", "baseRevisionNo", 1));
        plugin.tick();

        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "Stale.", "baseRevisionNo", 1));
        plugin.tick();

        assertEquals("Second.", pages(schema).get(0).markdown(), "the stale save must not land");
        var receipt = ctx.store()
                .get(Scope.site(), WikiPlugin.INGEST_PREFIX + "the-kraken", WikiPlugin.IngestReceipt.class)
                .orElseThrow();
        assertEquals("conflict", receipt.state());
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.class).isPresent(),
                "the losing draft stays so the editor can resolve it");
    }

    @Test
    void rejectsASlugThatCouldNotBeAUrlSegment() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "_admin", Map.of("title", "Sneaky", "markdown", "x"));

        new WikiPlugin().register(ctx);

        assertTrue(pages(schema).isEmpty(), "a slug may not shadow one of the wiki's own verbs");
        assertEquals("rejected", ctx.store()
                .get(Scope.site(), WikiPlugin.INGEST_PREFIX + "_admin", WikiPlugin.IngestReceipt.class)
                .orElseThrow().state());
    }

    @Test
    void storesTheLinksMediaAndSourcesTheBodyDeclares() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", """
                Related: [[deep-sea]]. Heard in [[episode:s01e02@12:04|the bit]].
                ![a photo](https://cdn.example.com/kraken.png)

                ## Sources
                - [Wikipedia](https://en.wikipedia.org/wiki/Kraken) — accessed 2026-08
                """));

        new WikiPlugin().register(ctx);

        assertEquals(1, schema.count("link", Criteria.where("fromSlug", Op.EQ, "the-kraken")
                .and("kind", Op.EQ, "wiki")));
        assertEquals(1, schema.count("link", Criteria.where("toSlug", Op.EQ, "s01e02")
                .and("kind", Op.EQ, "episode")));
        assertEquals(1, schema.count("media", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
        assertEquals(1, schema.count("source", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
    }

    @Test
    void replacesDerivedRowsOnEverySaveRatherThanAccumulatingThem() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "[[deep-sea]] [[abyss]]"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "[[deep-sea]]", "baseRevisionNo", 1));
        plugin.tick();

        assertEquals(1, schema.count("link", Criteria.where("fromSlug", Op.EQ, "the-kraken")),
                "a link removed from the body must not survive as a stale edge");
    }

    @Test
    void removesAPageAndEverythingKeyedToItWhenTombstoned() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "[[deep-sea]]\n\n## Sources\n- [w](https://e.com)"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        ctx.store().put(Scope.site(), WikiPlugin.DELETE_PREFIX + "the-kraken", Map.of());
        plugin.tick();

        assertTrue(pages(schema).isEmpty());
        assertEquals(0, schema.count("revision", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
        assertEquals(0, schema.count("link", Criteria.where("fromSlug", Op.EQ, "the-kraken")));
        assertEquals(0, schema.count("source", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.DELETE_PREFIX + "the-kraken", Map.class).isEmpty(),
                "the tombstone is consumed once applied");
    }

    @Test
    void keepsLinksPointingAtARemovedPageSoTheDashboardCanReportThem() {
        // Deleting a page does not make the pages that cite it stop citing it. Silently dropping those
        // edges would hide the breakage instead of surfacing it.
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "deep-sea", Map.of("title", "Deep sea", "markdown", "See [[the-kraken]]."));
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "Large."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        ctx.store().put(Scope.site(), WikiPlugin.DELETE_PREFIX + "the-kraken", Map.of());
        plugin.tick();

        assertEquals(1, schema.count("link", Criteria.where("toSlug", Op.EQ, "the-kraken")));
        var stats = ctx.store().get(Scope.site(), WikiPlugin.KEY_STATS, WikiPlugin.WikiStats.class).orElseThrow();
        assertEquals(1, stats.brokenLinks());
    }

    @Test
    void prunesRevisionsPastTheConfiguredNumber() {
        var schema = schema();
        var ctx = ctx(schema, new MapPluginConfig().with("revisionsKept", 2));
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "v1"));
        plugin.register(ctx);
        for (int revision = 1; revision <= 3; revision++) {
            draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "v" + (revision + 1),
                    "baseRevisionNo", revision));
            plugin.tick();
        }

        assertEquals(4L, pages(schema).get(0).revisionNo());
        assertEquals(2, schema.count("revision", Criteria.where("pageSlug", Op.EQ, "the-kraken")));
    }

    @Test
    void publishesAnIndexOfPublishedPagesOnly() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "Large."));
        draft(ctx, "half-written", Map.of("title", "Half written", "markdown", "...", "status", "draft"));

        new WikiPlugin().register(ctx);

        @SuppressWarnings("unchecked")
        Map<String, Object> index = ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).orElseThrow();
        assertTrue(index.containsKey("the-kraken"));
        assertFalse(index.containsKey("half-written"), "an unpublished page is not listed");
    }

    @Test
    void countsOrphansPendingDraftsAndBrokenLinks() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "K", "markdown", "See [[nowhere]]."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);
        draft(ctx, "_bad", Map.of("title", "x", "markdown", "x"));   // stays pending: rejected, not applied

        plugin.tick();

        var stats = ctx.store().get(Scope.site(), WikiPlugin.KEY_STATS, WikiPlugin.WikiStats.class).orElseThrow();
        assertEquals(1, stats.pages());
        assertEquals(1, stats.orphans(), "nothing links to the only page");
        assertEquals(1, stats.brokenLinks(), "[[nowhere]] has no page");
    }

    @Test
    void describesAPageForASharedLinkAndListsItInTheSitemap() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken",
                "markdown", "A very large squid.\n\n![p](https://cdn.example.com/k.png)"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        var meta = plugin.metaFor("the-kraken").orElseThrow();
        assertEquals("The Kraken", meta.title());
        assertEquals("A very large squid.", meta.description());
        assertEquals("https://cdn.example.com/k.png", meta.imageUrl());
        // The same page, addressed through one of its own sub-views.
        assertEquals("The Kraken", plugin.metaFor("the-kraken/history").orElseThrow().title());
        assertTrue(plugin.metaFor("_search/kraken").isEmpty(), "a wiki verb describes no page");
        assertTrue(plugin.metaFor("does-not-exist").isEmpty(), "core falls back to the site's own OG tags");

        var urls = plugin.urls();
        assertEquals(1, urls.size());
        assertEquals("/p/wiki/the-kraken", urls.get(0).loc());
        assertNotNull(urls.get(0).lastModified());
    }

    @Test
    void keepsAnUnpublishedPageOutOfTheSitemapAndOutOfSharePreviews() {
        var schema = schema();
        var ctx = ctx(schema);
        draft(ctx, "half-written", Map.of("title", "Half", "markdown", "...", "status", "draft"));
        var plugin = new WikiPlugin();

        plugin.register(ctx);

        assertTrue(plugin.urls().isEmpty());
        assertTrue(plugin.metaFor("half-written").isEmpty());
    }

    @Test
    void survivesADraftThatIsNotAPageAtAll() {
        // A malformed document must cost its own save, not the tick that refreshes everyone's front page.
        var schema = schema();
        var ctx = ctx(schema);
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "broken", "not an object");

        new WikiPlugin().register(ctx);

        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).isPresent(),
                "the projections still refresh");
    }
}
