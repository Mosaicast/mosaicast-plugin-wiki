// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Criteria.Op;
import dev.mosaicast.plugin.api.Role;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.FakeTags;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import dev.mosaicast.plugin.testkit.PageRouteProviderHarness;
import dev.mosaicast.plugin.testkit.SearchProviderHarness;
import dev.mosaicast.plugin.testkit.UserDataHandlerHarness;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The three extension points SDK 0.9 added, and the shared tag vocabulary that came with it. */
class WikiExtensionPointsTest {

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

    private static FakePluginContext ctx(FakeSchemaStore schema) {
        return new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema);
    }

    /** Seeds one published page and one unpublished, through the real ingest path. */
    private static WikiPlugin seeded(FakePluginContext ctx) {
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "The Kraken", "markdown", "A very large squid, seen off Norway.",
                "tags", List.of("Lore", "sea"), "author", "u-alice"));
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "half-written", Map.of(
                "title", "Half written", "markdown", "A secret draft about squid.",
                "status", "draft", "author", "u-alice"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);
        return plugin;
    }

    // --- PageRouteProvider (mosaicast-core#89) --------------------------------------------------------

    @Test
    void claimsItsOwnRoutesAndNothingElse() {
        var ctx = ctx(schema());
        var plugin = seeded(ctx);

        var routes = new PageRouteProviderHarness(plugin).check(
                "the-kraken", "the-kraken/history", "the-kraken/edit", "the-kraken/rev/2",
                "_all", "_random", "_new", "_search/kraken", "_tag/lore", "_admin",
                "nowhere", "the-kraken/nonsense", "_nope");

        assertTrue(routes.servesRoot(), "the root is a route; forgetting it 404s the wiki's own landing page");
        for (String real : List.of("the-kraken", "the-kraken/history", "the-kraken/rev/2",
                "_all", "_random", "_new", "_search/kraken", "_tag/lore", "_admin")) {
            assertTrue(routes.serves(real), real + " should be a route");
        }
        for (String missing : List.of("nowhere", "the-kraken/nonsense", "_nope")) {
            assertFalse(routes.serves(missing), missing + " should be a real 404");
        }
        assertTrue(routes.failures().isEmpty(), "a throw leaves the host serving 200, hiding the bug");
    }

    @Test
    void doesNotClaimAPageThatWasDeleted() {
        var ctx = ctx(schema());
        var plugin = seeded(ctx);
        assertTrue(new PageRouteProviderHarness(plugin).check("the-kraken").serves("the-kraken"));

        ctx.store().put(Scope.site(), WikiPlugin.DELETE_PREFIX + "the-kraken", Map.of());
        plugin.tick();

        assertFalse(new PageRouteProviderHarness(plugin).check("the-kraken").serves("the-kraken"),
                "a deleted page's URL is exactly the one a crawler should stop indexing");
    }

    @Test
    void doesNotClaimAnUnpublishedPageAsAPublicRoute() {
        // A draft answering 200 puts it in a crawler's index, which is the opposite of what unpublished
        // means. This decides the status line only -- a podcaster opening the URL still gets the editor.
        var plugin = seeded(ctx(schema()));

        var routes = new PageRouteProviderHarness(plugin).check("half-written", "the-kraken");

        assertFalse(routes.serves("half-written"));
        assertTrue(routes.serves("the-kraken"));
    }

    // --- SearchProvider ------------------------------------------------------------------------------

    @Test
    void findsPublishedPagesAndNeverLeaksADraft() {
        // The one place the host cannot filter for us: core has no model of a wiki page and cannot know
        // that `status` decides who sees it. The harness asks once per role, anonymous included.
        var ctx = ctx(schema());
        var plugin = seeded(ctx);

        var results = new SearchProviderHarness(plugin).search("squid");

        assertEquals(List.of("the-kraken"), results.anonymous().stream().map(h -> h.subpath()).toList());
        assertFalse(results.leakedToAnonymous("half-written"), "a draft must never reach an anonymous visitor");
        for (Role role : Role.values()) {
            assertTrue(results.forRole(role).stream().noneMatch(h -> h.subpath().equals("half-written")),
                    "an unpublished page must not surface for " + role);
        }
    }

    @Test
    void answersAnEmptyOrNonsenseQueryWithoutThrowing() {
        // A stray operator is what a person types, not an error. A provider that throws costs its own
        // section silently -- only a test tells you.
        var plugin = seeded(ctx(schema()));
        var harness = new SearchProviderHarness(plugin);

        assertTrue(harness.search("").anonymous().isEmpty(), "an empty query matches nothing");
        // The assertion is that it returns at all. A provider that throws costs its own search section and
        // says nothing to the visitor, so "did not throw" is the property worth pinning.
        assertDoesNotThrow(() -> harness.search("\"unbalanced OR -"),
                "a stray operator is what a person types, not an error");
    }

    @Test
    void carriesASnippetSoAHitReadsAsSomething() {
        var results = new SearchProviderHarness(seeded(ctx(schema()))).search("squid");

        var hit = results.anonymous().get(0);
        assertEquals("The Kraken", hit.title());
        assertTrue(hit.snippet().contains("squid"), hit.snippet());
    }

    // --- UserDataHandler -----------------------------------------------------------------------------

    @Test
    void cutsTheIdentityLinkButKeepsTheContribution() {
        // Pseudonymise, not erase (ARCHITECTURE §13): the edit happened, and a history with holes in it is
        // worse than one attributed to nobody.
        var schema = schema();
        var ctx = ctx(schema);
        var plugin = seeded(ctx);
        assertEquals(2, schema.count("revision", Criteria.where("author", Op.EQ, "u-alice")),
                "both seeded pages are hers");

        plugin.eraseUser("u-alice");

        assertEquals(0, schema.count("revision", Criteria.where("author", Op.EQ, "u-alice")),
                "the identity link is gone");
        assertEquals(2, schema.count("revision", Criteria.all()), "the revisions themselves stay");
        assertEquals(0, schema.count("page", Criteria.where("updatedBy", Op.EQ, "u-alice")));
    }

    @Test
    void survivesBeingAskedTwice() {
        // A failed erasure is retried, so the second call has to be a no-op rather than an error.
        var schema = schema();
        var plugin = seeded(ctx(schema));

        new UserDataHandlerHarness(plugin).eraseTwice("u-alice");

        assertEquals(2, schema.count("revision", Criteria.all()));
    }

    @Test
    void leavesOtherPeoplesContributionsAlone() {
        var schema = schema();
        var ctx = ctx(schema);
        var plugin = seeded(ctx);
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "deep-sea", Map.of(
                "title", "Deep sea", "markdown", "Dark.", "author", "u-bob"));
        plugin.tick();

        plugin.eraseUser("u-alice");

        assertEquals(1, schema.count("revision", Criteria.where("author", Op.EQ, "u-bob")));
    }

    // --- the front page --------------------------------------------------------------------------

    @Test
    void publishesTheFrontPageWhenOneIsWritten() {
        var ctx = new FakePluginContext(new InMemoryDocStore(),
                new MapPluginConfig().with("homePageSlug", "main-page"),
                new FakeFeedAccess(Map.of()), schema());
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "main-page", Map.of(
                "title", "Welcome", "markdown", "Notes the crew keeps."));

        new WikiPlugin().register(ctx);

        var home = ctx.store().get(Scope.site(), WikiPlugin.KEY_HOME, WikiPlugin.HomePage.class).orElseThrow();
        assertEquals("main-page", home.slug());
        assertEquals("Welcome", home.title());
    }

    @Test
    void publishesNoFrontPageKeyWhenNobodyHasWrittenOne() {
        // The doc store refuses a null value, so "nothing to publish" has to be an absent key rather than
        // a stored null -- otherwise every tick of a new install throws before it reaches the projections.
        var ctx = ctx(schema());

        new WikiPlugin().register(ctx);

        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_HOME, WikiPlugin.HomePage.class).isEmpty());
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).isPresent(),
                "the rest of the tick still runs");
    }

    @Test
    void withdrawsTheFrontPageWhenItIsUnpublished() {
        var ctx = new FakePluginContext(new InMemoryDocStore(),
                new MapPluginConfig().with("homePageSlug", "main-page"),
                new FakeFeedAccess(Map.of()), schema());
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "main-page", Map.of(
                "title", "Welcome", "markdown", "Notes."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_HOME, WikiPlugin.HomePage.class).isPresent());

        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "main-page", Map.of(
                "title", "Welcome", "markdown", "Notes.", "status", "draft", "baseRevisionNo", 1));
        plugin.tick();

        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.KEY_HOME, WikiPlugin.HomePage.class).isEmpty(),
                "an unpublished front page must stop being served");
    }

    // --- the shared tag vocabulary (sdk#44, §6.1.1) ---------------------------------------------------

    @Test
    void publishesItsTagsIntoTheSiteVocabulary() {
        var schema = schema();
        var tags = new FakeTags();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema).withTags(tags);

        seeded(ctx);

        assertEquals(List.of("lore", "sea"), tags.tagsOnSubject("page:the-kraken").stream().sorted().toList());
        assertTrue(tags.all().stream().anyMatch(t -> t.tag().equals("lore")),
                "the word joins the site vocabulary, not a private column");
    }

    @Test
    void storesTheCanonicalKeySoNearDuplicatesConverge() {
        // The host trims, collapses whitespace and casefolds. "Lore" and "lore " are one tag, which is the
        // whole reason a shared vocabulary needs an owner.
        var schema = schema();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema).withTags(new FakeTags());
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "K", "markdown", "x", "tags", List.of("Lore", "lore ", "  Deep   Sea ")));

        new WikiPlugin().register(ctx);

        var page = schema.select("page", Criteria.all(), WikiPlugin.PageRow.class).get(0);
        assertEquals("lore,deep sea", page.tags());
    }

    @Test
    void dropsAnAssignmentWhenAnEditRemovesTheTag() {
        var tags = new FakeTags();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema()).withTags(tags);
        var plugin = seeded(ctx);

        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + "the-kraken", Map.of(
                "title", "The Kraken", "markdown", "Still large.", "tags", List.of("lore"),
                "baseRevisionNo", 1));
        plugin.tick();

        assertEquals(List.of("lore"), tags.tagsOnSubject("page:the-kraken"),
                "a tag removed from the page must stop claiming the page in the tag view");
    }

    @Test
    void releasesItsTagsWhenThePageIsDeleted() {
        var tags = new FakeTags();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema()).withTags(tags);
        var plugin = seeded(ctx);

        ctx.store().put(Scope.site(), WikiPlugin.DELETE_PREFIX + "the-kraken", Map.of());
        plugin.tick();

        assertTrue(tags.tagsOnSubject("page:the-kraken").isEmpty());
    }

    @Test
    void keepsWorkingWithNoTagSurfaceAtAll() {
        // ctx.tags() is null without the manifest block. The local column is still the page's own record.
        var schema = schema();
        var ctx = ctx(schema);

        seeded(ctx);

        assertEquals("lore,sea", schema.select("page",
                Criteria.where("slug", Op.EQ, "the-kraken"), WikiPlugin.PageRow.class).get(0).tags());
    }
}
