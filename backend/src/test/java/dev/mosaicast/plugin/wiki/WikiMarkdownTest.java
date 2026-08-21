// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** The extraction the backend runs over a page body. Its output is what backlinks and Sources are made of. */
class WikiMarkdownTest {

    @Test
    void readsWikiEpisodeAndExternalLinks() {
        List<WikiMarkdown.Link> links = WikiMarkdown.links("""
                See [[the-kraken]] and [[deep-sea|the deep]].
                Discussed in [[episode:s01e02]].
                Background at [Wikipedia](https://en.wikipedia.org/wiki/Kraken).
                """);

        assertEquals(List.of(
                new WikiMarkdown.Link("the-kraken", "wiki", "the-kraken"),
                new WikiMarkdown.Link("deep-sea", "wiki", "the deep"),
                new WikiMarkdown.Link("s01e02", "episode", "s01e02"),
                new WikiMarkdown.Link("https://en.wikipedia.org/wiki/Kraken", "external", "Wikipedia")),
                links);
    }

    @Test
    void treatsATimestampAsPartOfTheRenderedLinkNotOfWhatIsLinked() {
        // [[episode:x@12:04]] and [[episode:x]] are the same edge: one backlink, not two.
        List<WikiMarkdown.Link> links =
                WikiMarkdown.links("[[episode:s01e02@12:04|the bit]] and later [[episode:s01e02]]");

        assertEquals(1, links.size());
        assertEquals("s01e02", links.get(0).toSlug());
        assertEquals("the bit", links.get(0).label());
    }

    @Test
    void collapsesRepeatedLinksSoOneMentionIsOneBacklink() {
        assertEquals(1, WikiMarkdown.links("[[the-kraken]] ... [[the-kraken]] ... [[the-kraken]]").size());
    }

    @Test
    void ignoresRelativeAndAnchorLinks() {
        // Neither is an edge out of this page, and treating them as external would pollute the media audit.
        assertTrue(WikiMarkdown.links("[top](#top) and [rel](../elsewhere)").isEmpty());
    }

    @Test
    void keepsAnUploadAsARefAndAnExternalImageAsAUrl() {
        List<WikiMarkdown.Media> media = WikiMarkdown.media("""
                ![a diagram](blob:8f14e45f-ceea-467a-9c1b-2d0b1e3f4a5c)
                ![a photo](https://cdn.example.com/kraken.png)
                """);

        assertEquals(2, media.size());
        assertEquals("8f14e45f-ceea-467a-9c1b-2d0b1e3f4a5c", media.get(0).uploadRef());
        assertNull(media.get(0).url(), "an upload is addressed by ref; a stored URL would go stale");
        assertEquals("https://cdn.example.com/kraken.png", media.get(1).url());
        assertEquals("cdn.example.com", media.get(1).provider(), "the provider drives the media audit");
    }

    @Test
    void readsTheSourcesSectionInEitherShippedLanguage() {
        String body = """
                Some prose with [an inline link](https://example.com/not-a-source).

                ## Sources
                - [Kraken (Wikipedia)](https://en.wikipedia.org/wiki/Kraken) — accessed 2026-08
                - [A book](https://example.com/book)

                ## Notes
                - [not a source](https://example.com/after)
                """;

        List<WikiMarkdown.Source> sources = WikiMarkdown.sources(body);

        assertEquals(2, sources.size(), "the section ends at the next heading");
        assertEquals("Kraken (Wikipedia)", sources.get(0).label());
        assertEquals("accessed 2026-08", sources.get(0).note());
        assertNull(sources.get(1).note());
        assertEquals(2, WikiMarkdown.sources(body.replace("## Sources", "## Quellen")).size());
    }

    @Test
    void buildsAnExcerptFromTheFirstProseParagraph() {
        String excerpt = WikiMarkdown.excerpt("""
                # The Kraken

                A **very** large [squid](https://example.com), seen off [[deep-sea|the deep]].

                A second paragraph nobody asked for.
                """, 200);

        assertEquals("A very large squid, seen off the deep.", excerpt);
    }

    @Test
    void truncatesAnExcerptOnAWordBoundary() {
        String excerpt = WikiMarkdown.excerpt("word ".repeat(80), 40);

        assertTrue(excerpt.length() <= 41, excerpt);
        assertTrue(excerpt.endsWith("…"));
        assertTrue(excerpt.startsWith("word word"));
    }

    @Test
    void readsATimestampTheWayAPersonWritesOne() {
        // The host's `?t=` grammar (ARCHITECTURE §6.4). This table is the same one core's
        // util/timestamp.ts and web/TimestampParam.java are held to -- one grammar, three
        // implementations, and a link that previews as one moment and plays another is worse than one
        // carrying no timestamp at all.
        assertEquals(754L, WikiMarkdown.seconds("754"));
        assertEquals(724L, WikiMarkdown.seconds("12:04"));
        assertEquals(3723L, WikiMarkdown.seconds("1:02:03"));
        assertEquals(3723L, WikiMarkdown.seconds("1h02m03s"));
        assertEquals(5400L, WikiMarkdown.seconds("90m"));
        assertEquals(3600L, WikiMarkdown.seconds("1H"), "the unit form is case-insensitive");
    }

    @Test
    void dropsATimestampItCannotRead() {
        assertNull(WikiMarkdown.seconds("later on"), "an unreadable one is dropped, never guessed");
        assertNull(WikiMarkdown.seconds(null));
        assertNull(WikiMarkdown.seconds(""));
        assertNull(WikiMarkdown.seconds("h"), "the all-optional unit pattern must not read this as zero");
        assertNull(WikiMarkdown.seconds("12:70"), "minutes and seconds are bounded, as in the host");
        assertNull(WikiMarkdown.seconds("99999"), "past 24h is a typo or a probe, not an episode");
        assertNull(WikiMarkdown.seconds("99999999999999999999"), "and it must not overflow either");
    }
}
