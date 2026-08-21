// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pulls the structured parts out of a page's markdown: its links, its media and its sources.
 *
 * <p><strong>Regexes, not a markdown parser, and deliberately.</strong> The backend needs four things out
 * of the body: which wiki pages it points at, which episodes it cites, which images it shows, and what it
 * lists under Sources. A real parser would mean a runtime dependency in the plugin JAR, which means a
 * shaded jar and PF4J classloading to go with it. The browser already parses the markdown properly for
 * rendering; this side only has to find well-known shapes, and anything it misses degrades to "no backlink
 * for that one" rather than to a broken page.
 *
 * <p>The wiki's own syntax, on top of ordinary markdown:
 * <pre>
 *   [[the-kraken]]                     a wiki link, label = the slug
 *   [[the-kraken|the beast]]           a wiki link with a label
 *   [[episode:s01e02]]                 an episode card
 *   [[episode:s01e02@12:04|the bit]]   an episode card starting at a moment
 * </pre>
 */
final class WikiMarkdown {

    /** {@code [[target|label]]}, where target may carry an {@code episode:} prefix and an {@code @time}. */
    private static final Pattern WIKI_TOKEN = Pattern.compile("\\[\\[([^\\]|]+?)(?:\\|([^\\]]*))?]]");

    /** Markdown image: {@code ![alt](url)}. */
    private static final Pattern IMAGE = Pattern.compile("!\\[([^\\]]*)]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)");

    /** Markdown link, excluding images (the {@code !} is consumed by {@link #IMAGE} first). */
    private static final Pattern LINK = Pattern.compile("(?<!!)\\[([^\\]]+)]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)");

    /** A {@code ## Sources} heading, in either shipped UI language, through to the next heading. */
    private static final Pattern SOURCES_SECTION =
            Pattern.compile("(?im)^#{1,6}\\s*(?:sources|quellen)\\s*$(.*?)(?=^#{1,6}\\s|\\z)", Pattern.DOTALL);

    /** One bullet in that section: {@code - [label](url) - note}. */
    private static final Pattern SOURCE_ITEM =
            Pattern.compile("(?m)^\\s*[-*]\\s+\\[([^\\]]+)]\\(([^)\\s]+)\\)\\s*(?:[—:-]\\s*(.*))?$");

    // The host's `?t=` grammar (ARCHITECTURE §6.4), matched term for term against core's
    // `frontend/src/util/timestamp.ts` and `web/TimestampParam.java`. The spec's rule -- one grammar,
    // implemented on every side -- covers this third implementation too: a link that previews as one
    // moment and plays another is worse than one carrying no timestamp.
    private static final Pattern PLAIN = Pattern.compile("^\\d+$");
    private static final Pattern MMSS = Pattern.compile("^(\\d{1,3}):([0-5]\\d)$");
    private static final Pattern HHMMSS = Pattern.compile("^(\\d{1,2}):([0-5]\\d):([0-5]\\d)$");
    private static final Pattern UNITS =
            Pattern.compile("^(?:(\\d{1,6})h)?(?:(\\d{1,6})m)?(?:(\\d{1,6})s)?$");

    /** The largest position a link may carry: 24 h. Longer is a typo, not an episode. */
    private static final long MAX_SECONDS = 86_400L;

    /** A file this plugin stores itself, addressed by ref rather than by URL: {@code ![alt](blob:<ref>)}. */
    private static final String BLOB_PREFIX = "blob:";

    private WikiMarkdown() {
    }

    /** One outgoing edge: a wiki page, an episode, or somewhere on the open web. */
    record Link(String toSlug, String kind, String label) {}

    /** One image or file the page shows. Exactly one of {@code url} and {@code uploadRef} is set. */
    record Media(String url, String uploadRef, String kind, String provider, String caption) {}

    /** One entry of the page's Sources section. */
    record Source(String label, String url, String note) {}

    /**
     * Every link the body makes, de-duplicated by (target, kind) so a page that mentions one episode five
     * times still produces a single backlink.
     *
     * @param markdown the page body; may be {@code null}
     * @return the links, in the order they first appear
     */
    static List<Link> links(String markdown) {
        List<Link> links = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        if (markdown == null) {
            return links;
        }

        Matcher tokens = WIKI_TOKEN.matcher(markdown);
        while (tokens.find()) {
            String target = tokens.group(1).trim();
            String label = tokens.group(2) == null ? null : tokens.group(2).trim();
            boolean episode = target.regionMatches(true, 0, "episode:", 0, "episode:".length());
            if (episode) {
                target = target.substring("episode:".length());
            }
            // The @timestamp belongs to the rendered link, not to the identity of what is linked.
            int at = target.indexOf('@');
            if (at >= 0) {
                target = target.substring(0, at);
            }
            target = target.trim();
            if (target.isEmpty()) {
                continue;
            }
            String kind = episode ? "episode" : "wiki";
            if (seen.add(kind + ' ' + target)) {
                links.add(new Link(target, kind, label == null || label.isEmpty() ? target : label));
            }
        }

        Matcher external = LINK.matcher(markdown);
        while (external.find()) {
            String url = external.group(2).trim();
            if (!isHttp(url)) {
                continue;   // in-page anchors and relative paths are not edges out of this page
            }
            if (seen.add("external" + ' ' + url)) {
                links.add(new Link(url, "external", external.group(1).trim()));
            }
        }
        return links;
    }

    /**
     * Every image the body shows, in document order.
     *
     * <p>{@code ![alt](blob:<ref>)} names a file this plugin stores; the ref is kept and the URL is derived
     * at render time, because a stored URL is a copy of a decision the host is entitled to change.
     *
     * @param markdown the page body; may be {@code null}
     * @return the media rows to store for this page
     */
    static List<Media> media(String markdown) {
        List<Media> media = new ArrayList<>();
        if (markdown == null) {
            return media;
        }
        Matcher images = IMAGE.matcher(markdown);
        while (images.find()) {
            String caption = images.group(1).trim();
            String target = images.group(2).trim();
            if (target.startsWith(BLOB_PREFIX)) {
                String ref = target.substring(BLOB_PREFIX.length()).trim();
                if (!ref.isEmpty()) {
                    media.add(new Media(null, ref, "image", null, caption));
                }
            } else if (isHttp(target)) {
                media.add(new Media(target, null, "image", hostOf(target), caption));
            }
        }
        return media;
    }

    /**
     * The page's Sources section, if it has one.
     *
     * @param markdown the page body; may be {@code null}
     * @return the cited sources, in the order listed
     */
    static List<Source> sources(String markdown) {
        List<Source> sources = new ArrayList<>();
        if (markdown == null) {
            return sources;
        }
        Matcher section = SOURCES_SECTION.matcher(markdown);
        if (!section.find()) {
            return sources;
        }
        Matcher items = SOURCE_ITEM.matcher(section.group(1));
        while (items.find()) {
            String note = items.group(3) == null ? null : items.group(3).trim();
            sources.add(new Source(items.group(1).trim(), items.group(2).trim(),
                    note == null || note.isEmpty() ? null : note));
        }
        return sources;
    }

    /**
     * The first paragraph of a body, stripped of markup, for a share preview and a list summary.
     *
     * @param markdown the page body; may be {@code null}
     * @param limit    how many characters to keep
     * @return a plain-text excerpt, never {@code null}
     */
    static String excerpt(String markdown, int limit) {
        if (markdown == null) {
            return "";
        }
        String text = markdown;
        for (String[] rule : new String[][] {
                {"(?m)^\\s{0,3}#{1,6}\\s+.*$", ""},          // headings carry no prose
                {"(?s)```.*?```", ""},                        // fenced code
                {"!\\[[^\\]]*]\\([^)]*\\)", ""},              // images
                // Labelled first, so the label wins; then the unlabelled form falls back to the slug. One
                // combined pattern cannot express "either group, not both" and emits the slug twice.
                {"\\[\\[(?:episode:)?[^\\]|@]+(?:@[^\\]|]*)?\\|([^\\]]*)]]", "$1"},
                {"\\[\\[(?:episode:)?([^\\]|@]+)(?:@[^\\]|]*)?]]", "$1"},
                {"\\[([^\\]]+)]\\([^)]*\\)", "$1"},           // links keep their text
                {"[*_`>]", ""},
        }) {
            text = text.replaceAll(rule[0], rule[1]);
        }
        String first = "";
        for (String paragraph : text.split("\\n\\s*\\n")) {
            first = paragraph.strip().replaceAll("\\s+", " ");
            if (!first.isEmpty()) {
                break;
            }
        }
        if (first.length() <= limit) {
            return first;
        }
        int cut = first.lastIndexOf(' ', limit);
        return first.substring(0, cut < limit / 2 ? limit : cut).strip() + "…";
    }

    /**
     * Reads a timestamp the way a person writes one.
     *
     * @param text {@code 754}, {@code 12:04}, {@code 1:02:03}, {@code 1h02m03s} or {@code 90m}
     * @return the position in seconds, or {@code null} when it is unreadable or out of range -- never a
     *         guess, since a wrong moment is worse than no moment
     */
    static Long seconds(String text) {
        if (text == null) {
            return null;
        }
        String value = text.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) {
            return null;
        }

        Long seconds = null;
        if (PLAIN.matcher(value).matches()) {
            seconds = parseLongOrNull(value);
        } else {
            Matcher clock = HHMMSS.matcher(value);
            if (clock.matches()) {
                seconds = Long.parseLong(clock.group(1)) * 3600
                        + Long.parseLong(clock.group(2)) * 60
                        + Long.parseLong(clock.group(3));
            } else {
                Matcher shortClock = MMSS.matcher(value);
                if (shortClock.matches()) {
                    seconds = Long.parseLong(shortClock.group(1)) * 60 + Long.parseLong(shortClock.group(2));
                } else {
                    Matcher units = UNITS.matcher(value);
                    // The unit pattern is all-optional, so it also matches "h" or "m" alone, which would
                    // slip through as zero without this check.
                    if (units.matches()
                            && (units.group(1) != null || units.group(2) != null || units.group(3) != null)) {
                        seconds = group(units, 1) * 3600 + group(units, 2) * 60 + group(units, 3);
                    }
                }
            }
        }

        return seconds == null || seconds < 0 || seconds > MAX_SECONDS ? null : seconds;
    }

    private static long group(Matcher matcher, int index) {
        return matcher.group(index) == null ? 0L : Long.parseLong(matcher.group(index));
    }

    /** Bare digits within the pattern's bound still overflow a long past 19 digits. */
    private static Long parseLongOrNull(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean isHttp(String url) {
        return url.regionMatches(true, 0, "http://", 0, 7) || url.regionMatches(true, 0, "https://", 0, 8);
    }

    /** The host of a URL, for the media audit: which third parties a page pulls from. */
    private static String hostOf(String url) {
        try {
            String host = java.net.URI.create(url).getHost();
            return host == null ? null : host.toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            return null;   // a URL we cannot parse still renders; it just has no attributable provider
        }
    }
}
