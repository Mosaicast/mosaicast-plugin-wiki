// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Backend tests against the SDK test kit — no core, no Postgres, no browser.
 *
 * {@code FakePluginContext} runs {@code onSchedule} tasks synchronously, so {@code register} alone
 * exercises the tick. {@code FakeSchemaStore} enforces the same declaration the host does, which means a
 * field this plugin queries but the manifest does not declare fails here rather than at load.
 */
class WikiPluginTest {

    private static FakeSchemaStore schema() {
        return new FakeSchemaStore("plugin_wiki_")
                .withEntity("page", "slug", "title", "summary", "markdown", "searchText",
                        "tags", "status", "createdAt", "updatedAt", "updatedBy", "revisionNo")
                .withFulltext("page", "searchText")
                .withEntity("revision", "pageSlug", "revisionNo", "title", "markdown", "comment",
                        "author", "createdAt")
                .withEntity("link", "fromSlug", "toSlug", "kind", "label")
                .withEntity("source", "pageSlug", "label", "url", "note", "accessedAt", "position")
                .withEntity("media", "pageSlug", "url", "kind", "provider", "caption", "position", "uploadRef");
    }


    private static FakePluginContext ctxWith(FakeSchemaStore schema, FakeFeedAccess feeds, MapPluginConfig config) {
        return new FakePluginContext(new InMemoryDocStore(), config, feeds, schema);
    }

    private static FakeFeedAccess noFeeds() {
        return new FakeFeedAccess(Map.of());
    }

    @Test
    void publishesItsBackendOwnedKeysDuringRegister() {
        // The keys are only closed to clients from the moment the manifest declares them, so a value
        // forged before that survives until register() overwrites it. Hence: written at boot, not only
        // on the schedule.
        var ctx = ctxWith(schema(), noFeeds(), new MapPluginConfig());

        new WikiPlugin().register(ctx);

        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).isPresent());
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_EPISODES, Map.class).isPresent());
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_STATS, WikiPlugin.WikiStats.class).isPresent());
    }

    @Test
    void schedulesTheIngestTickAtTheConfiguredInterval() {
        var ctx = ctxWith(schema(), noFeeds(), new MapPluginConfig().with("ingestIntervalSeconds", 5));

        new WikiPlugin().register(ctx);

        assertEquals(1, ctx.scheduledCount());
    }

    @Test
    void projectsEpisodeSnapshotsSoAPageCanRenderACard() {
        // The frontend cannot reach FeedAccess, so the backend copies what a card needs into the doc store.
        var feeds = new FakeFeedAccess(Map.of(Scope.site(), java.util.List.of("the-kraken")))
                .withDisplay("the-kraken", new DisplaySnapshot(
                        "The Kraken", "A deep dive", "https://cdn.example/ep1.mp3",
                        Instant.parse("2026-03-04T10:00:00Z"), Duration.ofMinutes(42),
                        "https://cdn.example/ep1.png", "https://cdn.example/cover.png", "Ned", null));
        var ctx = ctxWith(schema(), feeds, new MapPluginConfig());

        new WikiPlugin().register(ctx);

        var episodes = ctx.store().get(Scope.site(), WikiPlugin.KEY_EPISODES, Map.class).orElseThrow();
        assertTrue(episodes.containsKey("the-kraken"));
    }

    @Test
    void survivesAnEpisodeWithoutADisplaySnapshot() {
        // FakeFeedAccess.display throws for an unknown id, exactly as the host does for an episode that
        // vanished between listing and display. One missing snapshot must not cost the whole projection.
        var feeds = new FakeFeedAccess(Map.of(Scope.site(), java.util.List.of("gone", "kept")))
                .withDisplay("kept", new DisplaySnapshot("Kept", null, null, null, null, null, null, null, null));
        var ctx = ctxWith(schema(), feeds, new MapPluginConfig());

        new WikiPlugin().register(ctx);

        var episodes = ctx.store().get(Scope.site(), WikiPlugin.KEY_EPISODES, Map.class).orElseThrow();
        assertTrue(episodes.containsKey("kept"));
        assertFalse(episodes.containsKey("gone"));
    }

    @Test
    void reportsNoShareMetadataOrSitemapEntriesWhileTheWikiIsEmpty() {
        var ctx = ctxWith(schema(), noFeeds(), new MapPluginConfig());
        var plugin = new WikiPlugin();

        plugin.register(ctx);

        assertNotNull(plugin.metaFor(""));
        assertTrue(plugin.metaFor("anything").isEmpty());
        assertTrue(plugin.urls().isEmpty());
    }
}
