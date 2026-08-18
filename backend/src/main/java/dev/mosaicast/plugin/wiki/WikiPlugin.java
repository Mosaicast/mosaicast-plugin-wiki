// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.OgMeta;
import dev.mosaicast.plugin.api.PluginBackend;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.ShareMetadataProvider;
import dev.mosaicast.plugin.api.SitemapProvider;
import dev.mosaicast.plugin.api.SitemapUrl;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.pf4j.Extension;

/**
 * The wiki's backend: the only writer of relational truth for this plugin (ARCHITECTURE §7.6).
 *
 * <p>A wiki is relational — full-text search, revisions, backlinks — so the manifest declares a schema and
 * the platform provisions {@code plugin_wiki_*} for it. But there are <strong>no schema writes over
 * HTTP</strong>: a v1 plugin authors no routes, so no plugin code runs at request time and there is nowhere
 * to enforce slug uniqueness or append a revision atomically. The browser therefore writes a document
 * ({@code draft:<slug>}) and this class ingests it on its schedule. Every save is eventually consistent by
 * construction, and the editor UI says so rather than pretending otherwise.
 *
 * <p>The keys this class authors — {@code index}, {@code episodes}, {@code wikistats} and
 * {@code ingest:<slug>} — are declared in {@code plugin.json} under {@code data.backendOwned}, so a client
 * may read them but cannot forge them. They are written in {@link #register(PluginContext)} as well as on
 * the schedule: declaring a key does not remove a value forged before the declaration existed, so the first
 * boot has to overwrite it.
 *
 * <p>All three extension points live on this one class. Core instantiates plugin extensions through PF4J's
 * {@code SingletonExtensionFactory}, so {@link #metaFor(String)} and {@link #urls()} run on the same object
 * {@link #register(PluginContext)} did — a plain instance field is correct here, and the {@code static}
 * context the older sample carried is obsolete.
 */
@Extension
public class WikiPlugin implements PluginBackend, ShareMetadataProvider, SitemapProvider {

    /** Doc key holding {@code slug -> summary} for every page, so the UI can list and resolve links at once. */
    static final String KEY_INDEX = "index";

    /** Doc key holding the projected episode snapshots a wiki page's {@code [[episode:…]]} card renders from. */
    static final String KEY_EPISODES = "episodes";

    /** Doc key holding the counters the podcaster dashboard reads. */
    static final String KEY_STATS = "wikistats";

    private static final int DEFAULT_INGEST_SECONDS = 30;

    private PluginContext ctx;

    @Override
    public void register(PluginContext ctx) {
        this.ctx = ctx;

        // Publish once at boot: a backend-owned key is only closed to clients from the moment the manifest
        // declares it, so anything forged earlier survives until this overwrites it.
        republish();

        int seconds = ctx.config().get("ingestIntervalSeconds", Integer.class, DEFAULT_INGEST_SECONDS);
        ctx.onSchedule(Duration.ofSeconds(Math.max(1, seconds)), this::tick);
        ctx.logger().info("wiki registered; ingest every {}s, schema={}",
                seconds, ctx.schema() == null ? "absent" : ctx.schema().namespace());
    }

    /** One scheduled pass. Ingestion of drafts lands in phase 2; the projections are already live. */
    void tick() {
        republish();
    }

    private void republish() {
        ctx.store().put(Scope.site(), KEY_INDEX, buildIndex());
        ctx.store().put(Scope.site(), KEY_EPISODES, buildEpisodes());
        ctx.store().put(Scope.site(), KEY_STATS, buildStats());
    }

    /**
     * The page index the frontend reads to render a list, and to tell a live wiki link from a red one
     * without a round trip per link.
     *
     * @return slug -> summary, empty until pages exist
     */
    private Map<String, PageSummary> buildIndex() {
        Map<String, PageSummary> index = new LinkedHashMap<>();
        if (ctx.schema() == null) {
            return index;
        }
        // Phase 2 fills this from the `page` entity; an empty index is the correct answer for an empty wiki.
        return index;
    }

    /**
     * Episode snapshots projected into the doc store.
     *
     * <p>The frontend cannot reach {@code FeedAccess}, and a snapshot is not authoritative anyway — the host
     * overwrites it on every feed refetch — so the wiki keeps a copy for rendering only, refreshed each tick.
     *
     * @return slug -> the fields an episode card needs
     */
    private Map<String, EpisodeCard> buildEpisodes() {
        Map<String, EpisodeCard> cards = new LinkedHashMap<>();
        for (String slug : ctx.feeds().episodesIn(Scope.site())) {
            try {
                DisplaySnapshot snapshot = ctx.feeds().display(slug);
                cards.put(slug, new EpisodeCard(
                        snapshot.title(),
                        snapshot.artwork(),
                        snapshot.publishedAt() == null ? null : snapshot.publishedAt().toString(),
                        snapshot.duration() == null ? null : snapshot.duration().toSeconds()));
            } catch (RuntimeException e) {
                // An episode that vanished between listing and display must not cost us the whole projection.
                ctx.logger().debug("no display snapshot for {}: {}", slug, e.toString());
            }
        }
        return cards;
    }

    private WikiStats buildStats() {
        long pages = ctx.schema() == null ? 0 : ctx.schema().count("page", dev.mosaicast.plugin.api.Criteria.all());
        return new WikiStats(pages, 0, 0, 0);
    }

    @Override
    public Optional<OgMeta> metaFor(String subpath) {
        return Optional.empty();   // phase 2, once pages exist to describe
    }

    @Override
    public List<SitemapUrl> urls() {
        return List.of();          // phase 2, once pages exist to list
    }

    /** One page as the frontend's index needs it. */
    record PageSummary(String title, String summary, String tags, String updatedAt) {}

    /** One episode as a wiki page's {@code [[episode:…]]} card renders it. */
    record EpisodeCard(String title, String artwork, String publishedAt, Long durationSeconds) {}

    /** The counters the podcaster dashboard shows. */
    record WikiStats(long pages, long orphans, long brokenLinks, long pendingDrafts) {}
}
