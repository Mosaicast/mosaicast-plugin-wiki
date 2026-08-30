// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.BlobInfo;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.InMemoryPluginBlobs;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The orphan sweep: uploaded files no page points at any more.
 *
 * Nothing else collects them -- the host cannot tell an orphan from a file a draft is about to reference,
 * so only the plugin can. These tests pin both halves: that it removes what nothing uses, and that it
 * does not remove what someone is still writing around.
 */
class WikiBlobSweepTest {

    private static FakeSchemaStore schema() {
        return new FakeSchemaStore("plugin_wiki_")
                .withEntity("page", "slug", "title", "summary", "markdown", "searchText",
                        "tags", "status", "createdAt", "updatedAt", "updatedBy", "revisionNo")
                .withFulltext("page", "searchText")
                .withEntity("revision", "pageSlug", "revisionNo", "title", "markdown", "comment",
                        "author", "createdAt")
                .withEntity("link", "fromSlug", "toSlug", "kind", "label")
                .withEntity("source", "pageSlug", "label", "url", "note", "accessedAt", "position")
                .withEntity("media", "pageSlug", "url", "kind", "provider", "caption", "position",
                        "uploadRef");
    }

    private static BlobInfo upload(InMemoryPluginBlobs blobs, String name) {
        return blobs.put(name, "image/png",
                new ByteArrayInputStream("not really a png".getBytes(StandardCharsets.UTF_8)));
    }

    /** Grace of 0 makes the sweep observable; the default is an hour, which no test can outwait. */
    private static FakePluginContext ctx(FakeSchemaStore schema, InMemoryPluginBlobs blobs, int graceMinutes) {
        return new FakePluginContext(new InMemoryDocStore(),
                new MapPluginConfig().with("blobGraceMinutes", graceMinutes),
                new FakeFeedAccess(Map.of()), schema, blobs);
    }

    @Test
    void removesAFileNoPagePointsAt() {
        var blobs = new InMemoryPluginBlobs();
        var orphan = upload(blobs, "forgotten.png");
        var ctx = ctx(schema(), blobs, 0);

        new WikiPlugin().register(ctx);

        assertEquals(0, blobs.size(), "an unreferenced file is the plugin's to collect");
        assertTrue(blobs.stat(orphan.ref()).isEmpty());
    }

    @Test
    void keepsAFileAPageStillShows() {
        var blobs = new InMemoryPluginBlobs();
        var used = upload(blobs, "diagram.png");
        var ctx = ctx(schema(), blobs, 0);
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "The Kraken",
                "markdown", "![a diagram](blob:" + used.ref() + ")"));

        new WikiPlugin().register(ctx);

        assertEquals(1, blobs.size(), "the page renders this file; collecting it would break the page");
        assertTrue(blobs.stat(used.ref()).isPresent());
    }

    @Test
    void keepsAFileAnUnappliedDraftAlreadyReferences() {
        // The body is written but the tick has not ingested it, so no media row names the ref yet. Judging
        // by the rows alone would delete an image out from under an author mid-edit.
        var blobs = new InMemoryPluginBlobs();
        var ctx = ctx(schema(), blobs, 0);
        var plugin = new WikiPlugin();
        plugin.register(ctx);   // an empty first pass, so the sweep below is the one under test

        // The order a real save takes: upload, then the body naming it, then the tick that applies both.
        var pending = upload(blobs, "pending.png");
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "later", Map.of(
                "title", "Later", "markdown", "![p](blob:" + pending.ref() + ")"));
        var second = upload(blobs, "also-pending.png");
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "unsaved", Map.of(
                "title", "Unsaved", "markdown", "![q](blob:" + second.ref() + ")"));
        plugin.tick();

        assertTrue(blobs.stat(pending.ref()).isPresent());
        assertTrue(blobs.stat(second.ref()).isPresent());
    }

    @Test
    void sparesAFreshUploadUnderTheDefaultGrace() {
        // The default exists for the gap between "uploaded" and "saved": the editor writes the ref into the
        // body immediately, but nothing this side can see it until the author saves and the tick runs.
        var blobs = new InMemoryPluginBlobs();
        var justUploaded = upload(blobs, "still-writing.png");
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema(), blobs);

        new WikiPlugin().register(ctx);

        assertTrue(blobs.stat(justUploaded.ref()).isPresent(),
                "a file uploaded seconds ago is not an orphan yet");
    }

    @Test
    void collectsAFileOnceThePageStopsPointingAtIt() {
        var blobs = new InMemoryPluginBlobs();
        var dropped = upload(blobs, "was-used.png");
        var ctx = ctx(schema(), blobs, 0);
        var plugin = new WikiPlugin();
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "K", "markdown", "![d](blob:" + dropped.ref() + ")"));
        plugin.register(ctx);
        assertEquals(1, blobs.size());

        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "K", "markdown", "The image is gone.", "baseRevisionNo", 1));
        plugin.tick();

        assertEquals(0, blobs.size(), "the edit that removed it is what makes it an orphan");
    }

    @Test
    void doesNothingWhenThePluginDeclaresNoFileStorage() {
        // ctx.blobs() is null without a `blobs` manifest block, and a sweep must not be the thing that
        // discovers that.
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema());

        new WikiPlugin().register(ctx);

        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).isPresent());
    }
}
