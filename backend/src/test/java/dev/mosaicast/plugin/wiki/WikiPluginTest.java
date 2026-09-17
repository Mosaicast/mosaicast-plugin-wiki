// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.time.Duration;
import java.util.List;
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
        // Built from plugin.json, never transcribed -- see WikiSchemaFixture for why.
        return WikiSchemaFixture.schema();
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
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_STATS, WikiPlugin.WikiStats.class).isPresent());
    }

    @Test
    void schedulesTheIngestTickAtTheConfiguredInterval() {
        var ctx = ctxWith(schema(), noFeeds(), new MapPluginConfig().with("ingestIntervalSeconds", 5));

        new WikiPlugin().register(ctx);

        assertEquals(1, ctx.scheduledCount());
        assertEquals(List.of(Duration.ofSeconds(5)), ctx.scheduledPeriods());
    }

    @Test
    void followsAnIntervalSavedAfterRegistration() {
        // The assertion this file was missing, and the reason the plugin used to be wrong: the old code
        // read the interval once in register() and held it for the life of the process, so a podcaster
        // saved a new value, the admin form reported success, and the ingest went on running at the old
        // cadence until core restarted. scheduledPeriods() re-reads the supplier, so a captured Duration
        // keeps reporting 5 here and fails.
        var config = new MapPluginConfig().with("ingestIntervalSeconds", 5);
        var ctx = ctxWith(schema(), noFeeds(), config);
        new WikiPlugin().register(ctx);

        config.with("ingestIntervalSeconds", 60);

        assertEquals(List.of(Duration.ofSeconds(60)), ctx.scheduledPeriods());
    }

    @Test
    void refusesToScheduleAtZeroHoweverTheConfigIsWritten() {
        // Registration is the one strict moment -- the host rejects a non-positive period outright rather
        // than falling back to anything -- so a typo in a form must not be able to produce one. The host
        // clamps to a floor of its own above this; one second is only the floor that keeps registration
        // legal.
        var config = new MapPluginConfig().with("ingestIntervalSeconds", 0);
        var ctx = ctxWith(schema(), noFeeds(), config);
        new WikiPlugin().register(ctx);

        assertEquals(List.of(Duration.ofSeconds(1)), ctx.scheduledPeriods());

        config.with("ingestIntervalSeconds", -30);
        assertEquals(List.of(Duration.ofSeconds(1)), ctx.scheduledPeriods());
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
