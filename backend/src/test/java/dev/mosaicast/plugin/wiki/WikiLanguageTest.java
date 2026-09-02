// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Criteria.Op;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakeLocales;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.SitemapProviderHarness;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The language a page is written in, and the page it translates.
 *
 * <p>Both are author input arriving in a document any podcaster may PUT, and there is no request-time hook
 * to check them at (§7.6) — so every rule here is enforced on the ingest tick or nowhere. The editor's
 * dropdowns are a convenience; these tests are the contract.
 */
class WikiLanguageTest {

    private static FakeSchemaStore schema() {
        return WikiSchemaFixture.schema();
    }

    /** A site that authors in English and German, English being the default. */
    private static FakePluginContext bilingual(FakeSchemaStore schema) {
        return new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema)
                .withLocales(FakeLocales.englishOnly().withUi("de"));
    }

    private static void draft(FakePluginContext ctx, String slug, Map<String, Object> fields) {
        ctx.store().put(Scope.site(), WikiPlugin.DRAFT_PREFIX + slug, fields);
    }

    private static WikiPlugin.PageRow page(FakeSchemaStore schema, String slug) {
        List<WikiPlugin.PageRow> found = schema.select("page",
                Criteria.where("slug", Op.EQ, slug), WikiPlugin.PageRow.class);
        return found.isEmpty() ? null : found.get(0);
    }

    private static WikiPlugin.IngestReceipt receipt(FakePluginContext ctx, String slug) {
        return ctx.store().get(Scope.site(), WikiPlugin.INGEST_PREFIX + slug,
                WikiPlugin.IngestReceipt.class).orElseThrow();
    }

    @Test
    void storesTheLanguageAnAuthorStatedAndTheOriginalItTranslates() {
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        assertEquals("de", page(schema, "der-krake").locale());
        assertEquals("the-kraken", page(schema, "der-krake").translationOf());
        assertNull(page(schema, "the-kraken").translationOf(), "the original translates nothing");
    }

    @Test
    void leavesAPageWithNoStatedLanguageAlone() {
        // Every page written before this field existed is in this state, and a monolingual site never
        // leaves it. Unstated reads as the site default; it is not an error and must not become one.
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid."));

        new WikiPlugin().register(ctx);

        assertNull(page(schema, "the-kraken").locale());
        assertEquals("ok", receipt(ctx, "the-kraken").state());
    }

    @Test
    void refusesALanguageTheSiteDoesNotAuthorContentIn() {
        // The browser's list is a hint; what arrives here is input. A page stored under a language nobody
        // offers is invisible to every reader and to the editor's own switcher.
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "le-kraken", Map.of("title", "Le Kraken", "markdown", "Un calmar.", "locale", "fr"));

        new WikiPlugin().register(ctx);

        assertNull(page(schema, "le-kraken"), "nothing is stored");
        assertEquals("rejected", receipt(ctx, "le-kraken").state());
        assertTrue(receipt(ctx, "le-kraken").detail().contains("fr"));
        assertTrue(ctx.store().get(Scope.site(), WikiPlugin.DRAFT_PREFIX + "le-kraken", Map.class).isEmpty(),
                "a rejection is the author's to fix, not something to retry every tick forever");
    }

    @Test
    void acceptsAContentLanguageTheShellCannotRenderIn() {
        // The two lists come apart on exactly this case: an admin permits authoring in a language the UI
        // does not offer. Validating against the UI list would refuse the language the operator asked for.
        var schema = schema();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema)
                .withLocales(FakeLocales.englishOnly().withContent("nl"));
        draft(ctx, "de-kraken", Map.of("title", "De Kraken", "markdown", "Een inktvis.", "locale", "nl"));

        new WikiPlugin().register(ctx);

        assertEquals("nl", page(schema, "de-kraken").locale());
    }

    @Test
    void refusesAPageThatTranslatesItself() {
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.",
                "locale", "en", "translationOf", "the-kraken"));

        new WikiPlugin().register(ctx);

        assertNull(page(schema, "the-kraken"));
        assertEquals("rejected", receipt(ctx, "the-kraken").state());
    }

    @Test
    void refusesATranslationOfAPageThatDoesNotExist() {
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "no-such-page"));

        new WikiPlugin().register(ctx);

        assertNull(page(schema, "der-krake"));
        assertTrue(receipt(ctx, "der-krake").detail().contains("no-such-page"));
    }

    @Test
    void collapsesATranslationOfATranslationToTheOriginal() {
        // The graph is a star, never a chain: "the other languages of this page" has to be one query.
        // Picking the German page as what the Dutch one translates means the obvious thing.
        var schema = schema();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema)
                .withLocales(FakeLocales.englishOnly().withUi("de", "nl"));
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        draft(ctx, "de-kraken", Map.of("title", "De Kraken", "markdown", "Een inktvis.",
                "locale", "nl", "translationOf", "der-krake"));
        plugin.tick();

        assertEquals("the-kraken", page(schema, "de-kraken").translationOf(),
                "stored against the original, not against the German translation");
    }

    @Test
    void refusesASecondTranslationIntoALanguageTheGroupAlreadyHas() {
        // A language switcher can offer one page per language, so a second German version is a fork it
        // cannot present. The receipt names the page already holding it.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        draft(ctx, "die-krake", Map.of("title", "Die Krake", "markdown", "Noch ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        assertNull(page(schema, "die-krake"));
        assertTrue(receipt(ctx, "die-krake").detail().contains("der-krake"));
    }

    @Test
    void refusesATranslationInTheOriginalsOwnLanguage() {
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);

        draft(ctx, "the-kraken-again", Map.of("title", "Again", "markdown", "A squid.",
                "locale", "en", "translationOf", "the-kraken"));
        plugin.tick();

        assertNull(page(schema, "the-kraken-again"));
        assertTrue(receipt(ctx, "the-kraken-again").detail().contains("the-kraken"));
    }

    @Test
    void refusesToTurnAPageOthersTranslateIntoATranslation() {
        // The other way a chain forms: an original acquires a parent while its own translations still
        // point at it. Cheap to check, and the only place it can be checked.
        var schema = schema();
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of()), schema)
                .withLocales(FakeLocales.englishOnly().withUi("de", "nl"));
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();
        draft(ctx, "de-kraken", Map.of("title", "De Kraken", "markdown", "Een inktvis.", "locale", "nl"));
        plugin.tick();

        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en",
                "translationOf", "de-kraken", "baseRevisionNo", 1));
        plugin.tick();

        assertNull(page(schema, "the-kraken").translationOf(), "the original stays an original");
        assertEquals("rejected", receipt(ctx, "the-kraken").state());
    }

    // --- what the host asks for: og:locale, and the sitemap's translation group -----------------------

    /** An English original with a German translation, both published. */
    private static WikiPlugin bilingualWiki(FakeSchemaStore schema, FakePluginContext ctx) {
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();
        return plugin;
    }

    @Test
    void tellsAScraperTheLanguageThePageIsWrittenIn() {
        // og:locale is the language of *this* page, not of the install and not of the request: a German
        // article stays German for an English visitor.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = bilingualWiki(schema, ctx);

        assertEquals("de", plugin.metaFor("der-krake").orElseThrow().locale());
        assertEquals("en", plugin.metaFor("the-kraken").orElseThrow().locale());
    }

    @Test
    void saysNothingAboutTheLanguageOfAPageThatNeverClaimedOne() {
        // Null means "whatever the host resolved for this request", which is the honest answer for a page
        // whose author stated no language -- and the pre-0.12.0 behaviour.
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid."));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        assertNull(plugin.metaFor("the-kraken").orElseThrow().locale());
    }

    @Test
    void putsBothLanguagesInOneSitemapTranslationGroup() {
        // A wiki translation lives at its own slug, which is exactly the case a list of locale codes
        // cannot express -- and both members must declare the same group, or a crawler gets two answers.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = bilingualWiki(schema, ctx);

        var sitemap = new SitemapProviderHarness("wiki", plugin).collect();

        assertEquals(List.of(), sitemap.problems());
        assertEquals(List.of("de", "en"), sitemap.locales("/p/wiki/the-kraken"));
        assertEquals(Map.of("en", "/p/wiki/the-kraken", "de", "/p/wiki/der-krake"),
                sitemap.alternates("/p/wiki/der-krake"));
        assertEquals(sitemap.alternates("/p/wiki/the-kraken"), sitemap.alternates("/p/wiki/der-krake"));
    }

    @Test
    void declaresNoGroupForAPageThatStandsAlone() {
        // An hreflang set of one says nothing, and empty alternates is what the host assumed anyway.
        var schema = schema();
        var ctx = bilingual(schema);
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        var plugin = new WikiPlugin();
        plugin.register(ctx);

        var sitemap = new SitemapProviderHarness("wiki", plugin).collect();

        assertEquals(List.of(), sitemap.problems());
        assertTrue(sitemap.alternates("/p/wiki/the-kraken").isEmpty());
    }

    @Test
    void neverAdvertisesAnUnpublishedTranslationToACrawler() {
        // The per-row rule in a fourth place. An alternate a crawler follows to a 404 is worse than no
        // alternate: it is a promise of a page that is not there.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = bilingualWiki(schema, ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken", "status", "draft", "baseRevisionNo", 1));
        plugin.tick();

        var sitemap = new SitemapProviderHarness("wiki", plugin).collect();

        assertEquals(List.of(), sitemap.problems());
        assertFalse(sitemap.locations().contains("/p/wiki/der-krake"));
        assertTrue(sitemap.alternates("/p/wiki/the-kraken").isEmpty(),
                "the group loses its second member, so there is no group left to declare");
    }

    @Test
    void leavesAPageWithNoStatedLanguageOutOfItsGroupRatherThanGuessing() {
        // SitemapUrl requires an entry naming `loc`'s own language, and the site default is a guess. The
        // page still appears in the sitemap; it just makes no claim.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid."));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        var sitemap = new SitemapProviderHarness("wiki", plugin).collect();

        assertEquals(List.of(), sitemap.problems());
        assertTrue(sitemap.locations().contains("/p/wiki/the-kraken"));
        assertTrue(sitemap.alternates("/p/wiki/the-kraken").isEmpty());
        assertTrue(sitemap.alternates("/p/wiki/der-krake").isEmpty(),
                "one stated language is a group of one, which says nothing");
    }

    @Test
    void publishesTheLanguageAndTheGroupInTheIndexTheBrowserReads() {
        // The list views and the reader's switcher read the projection, not the schema, so a field missing
        // here is a feature that silently does nothing in the browser.
        var schema = schema();
        var ctx = bilingual(schema);
        var plugin = new WikiPlugin();
        draft(ctx, "the-kraken", Map.of("title", "The Kraken", "markdown", "A squid.", "locale", "en"));
        plugin.register(ctx);
        draft(ctx, "der-krake", Map.of("title", "Der Krake", "markdown", "Ein Tintenfisch.",
                "locale", "de", "translationOf", "the-kraken"));
        plugin.tick();

        @SuppressWarnings("unchecked")
        Map<String, Map<String, Object>> index =
                ctx.store().get(Scope.site(), WikiPlugin.KEY_INDEX, Map.class).orElseThrow();
        assertEquals("de", index.get("der-krake").get("locale"));
        assertEquals("the-kraken", index.get("der-krake").get("translationOf"));
    }
}
