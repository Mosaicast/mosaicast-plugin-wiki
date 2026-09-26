// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { FEED_HTML_POLICY } from '@mosaicast/plugin-sdk';
import { Marked } from 'marked';

/**
 * The parser, with one renderer changed: a task-list box becomes a glyph. The host policy drops `<input>`
 * (it is how a form gets into a page), so marked's disabled checkbox vanished and `- [x] done` read the same
 * as `- [ ] todo`. A glyph is text, so there is nothing for the policy to refuse and nothing to restore.
 */
const parser = new Marked({
  renderer: {
    checkbox: ({ checked }) => (checked ? '\u2611 ' : '\u2610 '),
  },
});

/**
 * Renders a page body to HTML that is safe to insert.
 *
 * **Never trust a page body verbatim.** It is written by a podcaster, but it is still author input that
 * ends up as markup on a public page, and markdown permits raw HTML by design. Everything the author wrote
 * goes through **`ctx.sanitize`** (SDK 0.16.0) after parsing — the host's own feed-HTML policy.
 *
 * Until 0.5.0 this ran `DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })`, i.e. DOMPurify's
 * defaults, which allow `<style>` and `style=`. Under the contract's `style-src 'unsafe-inline'` a saved page
 * containing `<style>:host{position:fixed;inset:0;…}</style>` covered the whole site for every reader,
 * anonymous included, and the Save button became unclickable even for its author (audit SEC-C07).
 *
 * On top of markdown, the wiki understands four tokens of its own. The markup they expand to needs things
 * the host policy rightly refuses an *author* — `class`, `data-wiki`/`data-ep`/`data-t`, an image width — so
 * they are not run through it. Each token is replaced by an inert placeholder word before parsing, the
 * author's HTML is sanitised with the placeholders in it, and only then is each placeholder swapped for the
 * element this module built, **in text nodes only**. Every attribute value in those elements is escaped
 * here, so the author controls text and a slug, never markup; a placeholder that ended up inside an
 * attribute stays a harmless word.
 *
 * ```
 * [[the-kraken]]                     a wiki link, label = the slug
 * [[the-kraken|the beast]]           a wiki link with a label
 * [[episode:s01e02]]                 an episode link
 * [[episode:s01e02@12:04|the bit]]   an episode link that starts at a moment
 * ![caption](blob:<ref>)             an image this plugin stores itself
 * ![caption](blob:<ref>){width=320}  …at a width the author chose, optionally {align=left|center|right}
 * ```
 */

/**
 * Swaps each placeholder word in a text node for the element it stands for.
 *
 * Text nodes only, deliberately: a placeholder the parser put inside an attribute (a token written in an
 * image's alt text, say) is left as the word it is, because splicing markup into an attribute value is how
 * a value becomes an attribute.
 */
function restoreTokens(root: HTMLElement, placeholder: RegExp, built: string[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    placeholder.lastIndex = 0;
    if (placeholder.test((node as Text).data)) {
      texts.push(node as Text);
    }
  }
  for (const text of texts) {
    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.data.matchAll(placeholder)) {
      fragment.append(text.data.slice(last, match.index));
      const template = document.createElement('template');
      template.innerHTML = built[Number(match[1])] ?? '';
      fragment.append(template.content);
      last = match.index! + match[0].length;
    }
    fragment.append(text.data.slice(last));
    text.replaceWith(fragment);
  }
}

/** One heading, for the table of contents. */
export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

/** What the renderer needs from the host to turn a token into a real link. */
export interface RenderOptions {
  /** Whether a wiki slug resolves to a page; a miss renders as a red link rather than a dead one. */
  hasPage(slug: string): boolean;
  /** The host's own URL shape for an episode, optionally at a position. Never hardcode `/episodes/…`. */
  episodeHref(slug: string, seconds?: number): string;
  /** Resolves an uploaded file's ref to a URL. Absent when the plugin has no file storage. */
  blobUrl?: (ref: string) => string;
  /** `ctx.sanitize` — the host's HTML policy, applied to everything the author wrote (SDK 0.16.0). */
  sanitize: (html: string) => string;
}

/** The rendered body plus the headings found in it. */
export interface RenderedPage {
  html: string;
  toc: TocEntry[];
  /**
   * The body's first paragraph as plain text.
   *
   * Exists so a caller can tell a *written* summary from one the backend derived — the derivation takes
   * this same paragraph, and rendering it again as a lead would print it twice.
   */
  plainFirstParagraph: string;
}

const WIKI_TOKEN = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const BLOB_IMAGE = /!\[([^\]]*)\]\(blob:([A-Za-z0-9-]+)\)/g;

/**
 * An image carrying a size or alignment: `![caption](target){width=320 align=right}`.
 *
 * **Why an attribute suffix and not a different markup language.** Markdown has no way to say how wide an
 * image should be, and `max-width: 100%` means every upload wider than the column — which is most of them —
 * renders full width whether or not that was wanted. The alternative on the table was moving the whole page
 * syntax to reStructuredText or LaTeX, which costs the regex extraction the backend depends on, a migration
 * of every stored revision, and a second renderer and sanitiser in the browser. This costs one regex.
 *
 * The suffix sits after the closing `)`, so `WikiMarkdown`'s own image pattern still matches the image and
 * simply ignores what follows it — an older backend extracts the media row exactly as before.
 */
const IMAGE_WITH_ATTRS = /!\[([^\]]*)\]\(([^)\s]+)\)\{([^}\n]*)\}/g;

/** `width=320`, `width=50%`, `align=right` — anything else in the block is ignored rather than rendered. */
const IMAGE_ATTR = /(\w+)\s*=\s*([^\s]+)/g;
// The host's `?t=` grammar (ARCHITECTURE §6.4), matched term for term against core's
// `frontend/src/util/timestamp.ts` and `web/TimestampParam.java`. This is a THIRD implementation of one
// grammar, so the spec's rule applies to it too: a link that previews as one moment and plays another is
// worse than one carrying no timestamp. Bare seconds, the clock a player shows, and the unit form other
// podcast apps emit.
const PLAIN = /^\d+$/;
const MMSS = /^(\d{1,3}):([0-5]\d)$/;
const HHMMSS = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;
const UNITS = /^(?:(\d{1,6})h)?(?:(\d{1,6})m)?(?:(\d{1,6})s)?$/;

/** The largest position a link may carry: 24 h. Longer is a typo, not an episode. */
const MAX_SECONDS = 86_400;

/**
 * Reads an image's attribute block into the two things this plugin renders.
 *
 * **Nothing the author typed reaches the output.** A width becomes a number and is written back out as one,
 * an alignment has to be one of three words, and anything else in the block is dropped. That is what makes
 * emitting a `style` attribute safe here: the value is regenerated, never interpolated, so the sanitiser is
 * a second line of defence rather than the only one.
 *
 * @param raw the text between the braces
 * @returns a CSS width this code composed, and an alignment class suffix
 */
export function parseImageAttrs(raw: string): { width: string | null; align: 'left' | 'center' | 'right' | null } {
  let width: string | null = null;
  let align: 'left' | 'center' | 'right' | null = null;

  for (const [, key, value] of raw.matchAll(IMAGE_ATTR)) {
    if (key === 'width') {
      const percent = /^(\d{1,3})%$/.exec(value);
      const pixels = /^(\d{1,4})(?:px)?$/.exec(value);
      if (percent && Number(percent[1]) > 0 && Number(percent[1]) <= 100) {
        width = `${Number(percent[1])}%`;
      } else if (pixels && Number(pixels[1]) > 0) {
        width = `${Number(pixels[1])}px`;
      }
    } else if (key === 'align' && (value === 'left' || value === 'center' || value === 'right')) {
      align = value;
    }
  }
  return { width, align };
}

/** What an image token looks like in the body, wherever it sits. */
const IMAGE_TOKEN = /!\[([^\]]*)\]\(([^)\s]+)\)(\{[^}\n]*\})?/g;

/** One image found in a body, and where it is, so an editor can replace exactly that span. */
export interface ImageToken {
  start: number;
  end: number;
  alt: string;
  target: string;
  width: string | null;
  align: 'left' | 'center' | 'right' | null;
}

/**
 * Finds the image the caret is sitting in or beside.
 *
 * **This is what "right-click the image" turns into in a textarea.** There is no image to right-click —
 * there is text — so the equivalent affordance is acting on the token the caret is already in. A caret
 * resting anywhere between the `!` and the closing brace counts, which includes the common case of having
 * just typed or inserted one.
 *
 * @param text  the whole body
 * @param caret the caret offset
 * @returns the token, or `null` when the caret is not in one
 */
export function imageTokenAt(text: string, caret: number): ImageToken | null {
  IMAGE_TOKEN.lastIndex = 0;
  for (let m = IMAGE_TOKEN.exec(text); m !== null; m = IMAGE_TOKEN.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (caret >= start && caret <= end) {
      const attrs = m[3] ? parseImageAttrs(m[3].slice(1, -1)) : { width: null, align: null };
      return { start, end, alt: m[1], target: m[2], ...attrs };
    }
  }
  return null;
}

/**
 * Writes an image back out, with an attribute block only when there is something to say.
 *
 * @param image alt text, target, and the two options
 * @returns the markdown token
 */
export function formatImage(image: {
  alt: string;
  target: string;
  width?: string | null;
  align?: 'left' | 'center' | 'right' | null;
}): string {
  const attrs = [
    image.width ? `width=${image.width}` : '',
    image.align ? `align=${image.align}` : '',
  ].filter(Boolean).join(' ');
  return `![${image.alt}](${image.target})${attrs ? `{${attrs}}` : ''}`;
}

/** Escapes text that is about to become part of an HTML attribute or an element's content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Reads a timestamp the way a person writes one: `754`, `12:04`, `1:02:03`, `1h02m03s` or `90m`.
 *
 * @param text the text after the `@` in an episode token
 * @returns the position in seconds, or `undefined` when it is not readable — a mangled timestamp still
 *          opens the episode rather than breaking the link
 */
export function parseTimestamp(text: string | undefined): number | undefined {
  const value = text?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }

  let seconds: number | undefined;
  if (PLAIN.test(value)) {
    seconds = Number(value);
  } else {
    const clock = HHMMSS.exec(value) ?? MMSS.exec(value);
    if (clock) {
      const parts = clock.slice(1).map(Number);
      seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    } else {
      const units = UNITS.exec(value);
      // The unit pattern is all-optional, so it also matches "h" or "m" alone, which would slip through
      // as zero without this check.
      if (units && (units[1] || units[2] || units[3])) {
        seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
      }
    }
  }

  if (seconds == null || !Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) {
    return undefined;
  }
  return Math.floor(seconds);
}

/** Formats seconds the way the token was written, for the link's own label. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const [h, m, sec] = parts;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Replaces the wiki's own tokens with placeholder words, handing the markup each one stands for to `keep`.
 *
 * @param keep records one element this module built and returns the word that stands for it
 */
function expandTokens(markdown: string, options: RenderOptions, keep: (html: string) => string): string {
  // Sized images first, and as raw HTML: markdown has no syntax for a width, so this is the one construct
  // that cannot survive as markdown and be styled afterwards. An image whose target this plugin cannot
  // resolve is dropped exactly as an unsized one is -- a caption without a picture beats a broken icon.
  const withSized = markdown.replace(IMAGE_WITH_ATTRS, (whole, alt: string, target: string, attrs: string) => {
    const src = target.startsWith('blob:')
      ? (options.blobUrl ? options.blobUrl(target.slice('blob:'.length)) : null)
      : target;
    // This element skips the sanitiser -- it needs `style` and `class` -- so its one author-typed URL is held
    // to the rule the host would have applied to an `<img src>`: the allowlist, plus the policy's one stated
    // exception, a `data:` image (SDK 0.16.1). No `javascript:`, no `vbscript:`.
    const uri = src?.trim().replace(/[\u0000-\u0020]/g, '') ?? '';
    if (!src || !(FEED_HTML_POLICY.allowedUriRegexp.test(uri) || uri.startsWith('data:'))) {
      return escapeHtml(alt);
    }
    const { width, align } = parseImageAttrs(attrs);
    const style = width ? ` style="width:${width}"` : '';
    // `wiki__img` makes it a block. An unsized image is inline inside the paragraph marked wraps it in, so
    // two of them stack; a raw <img> is an HTML *block* to marked and gets no paragraph, so without this
    // two sized images end up side by side and an author who wrote them on separate lines is surprised.
    const cls = ` class="wiki__img${align ? ` wiki__img--${align}` : ''}"`;
    return keep(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${style}${cls}>`);
  });

  const withImages = withSized.replace(BLOB_IMAGE, (whole, alt: string, ref: string) =>
    // No file storage: drop the image rather than emitting a broken one. The caption still reads.
    options.blobUrl ? `![${alt}](${options.blobUrl(ref)})` : escapeHtml(alt),
  );

  return withImages.replace(WIKI_TOKEN, (whole, rawTarget: string, rawLabel?: string) => {
    let target = rawTarget.trim();
    const label = rawLabel?.trim();
    const isEpisode = /^episode:/i.test(target);
    if (isEpisode) {
      target = target.slice('episode:'.length);
    }
    const at = target.indexOf('@');
    const stamp = at >= 0 ? parseTimestamp(target.slice(at + 1)) : undefined;
    if (at >= 0) {
      target = target.slice(0, at);
    }
    target = target.trim();
    if (!target) {
      return whole;
    }

    if (isEpisode) {
      const text = label || (stamp != null ? `${target} ${formatTimestamp(stamp)}` : target);
      const href = options.episodeHref(target, stamp);
      const time = stamp != null ? ` data-t="${stamp}"` : '';
      return keep(
        `<a class="wiki-ep" href="${escapeHtml(href)}" data-ep="${escapeHtml(target)}"${time}>${escapeHtml(text)}</a>`,
      );
    }

    const missing = !options.hasPage(target);
    const cls = missing ? 'wiki-link wiki-link--missing' : 'wiki-link';
    const title = missing ? ' title="This page does not exist yet"' : '';
    return keep(
      `<a class="${cls}" href="/p/wiki/${encodeURIComponent(target)}" data-wiki="${escapeHtml(target)}"${title}>${escapeHtml(label || target)}</a>`,
    );
  });
}

/**
 * A `## Sources` heading through to the next heading, in the two languages the shell ships with.
 *
 * **Only a fallback now.** The vocabulary is a config field an operator edits, and the backend records the
 * heading it actually matched on the page row — so this is used for a row ingested before that field
 * existed, and for nothing else. Keeping a second copy of the list in the browser is exactly the
 * duplication that made a Spanish wiki's Sources section render twice.
 */
const LEGACY_SOURCES_SECTION = /^#{1,6}[ \t]*(?:sources|quellen)[ \t]*$[\s\S]*?(?=^#{1,6}[ \t]|$(?![\s\S]))/im;

/** Escapes a heading so it matches itself: the text comes from a config field, not from us. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes the body's own Sources section, for a page whose sources are rendered from the extracted rows.
 *
 * The backend extracts that section into `source` rows and the reader renders those instead: numbered,
 * with each note styled, and guaranteed to match what a citation audit would see. Leaving the prose copy
 * in the body as well would print the whole list twice.
 *
 * @param markdown the page body
 * @param heading  the heading the backend matched (`page.sourcesHeading`); omitted or `null` falls back to
 *                 the two shipped languages, which is right for a page ingested before that field existed
 * @returns the body without that section; unchanged when it has none
 */
export function stripSourcesSection(markdown: string, heading?: string | null): string {
  const pattern = heading
    ? new RegExp(`^#{1,6}[ \t]*${escapeRegExp(heading)}[ \t]*$[\\s\\S]*?(?=^#{1,6}[ \t]|$(?![\\s\\S]))`, 'im')
    : LEGACY_SOURCES_SECTION;
  return markdown.replace(pattern, '').trimEnd();
}

/** Turns a heading's text into a stable anchor id, unique within one page. */
function headingId(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) {
    id = `${base}-${n}`;
  }
  taken.add(id);
  return id;
}

/**
 * Renders a page body and collects its headings.
 *
 * @param markdown the page body
 * @param options  how to resolve the wiki's own tokens
 * @returns sanitised HTML, and the `h2`/`h3` headings with the ids given to them
 */
export function renderPage(markdown: string, options: RenderOptions): RenderedPage {
  // Letters and digits only, so neither marked nor the sanitiser has anything to reinterpret; the nonce makes
  // it a word an author cannot type in advance.
  const nonce = Math.random().toString(36).slice(2, 10);
  const built: string[] = [];
  const keep = (html: string) => `wikitoken${nonce}n${built.push(html) - 1}x`;

  const parsed = parser.parse(expandTokens(markdown ?? '', options, keep), { async: false }) as string;
  const clean = options.sanitize(parsed);

  // Ids are assigned after sanitising, on a detached element: an id that came from the body could
  // collide with the host's own, and this way the anchor the TOC points at is one we minted.
  const host = document.createElement('div');
  host.innerHTML = clean;
  restoreTokens(host, new RegExp(`wikitoken${nonce}n(\\d+)x`, 'g'), built);

  const taken = new Set<string>();
  const toc: TocEntry[] = [];
  host.querySelectorAll('h2, h3').forEach((heading) => {
    const text = heading.textContent?.trim() ?? '';
    const id = headingId(text, taken);
    heading.setAttribute('id', id);
    toc.push({ id, text, level: heading.tagName === 'H2' ? 2 : 3 });
  });

  // No `target`/`rel` pass here: `ctx.sanitize` already sends a link leaving the site to a new tab with the
  // host's `rel`, and leaves a same-origin one alone. Rewriting it afterwards dropped `nofollow ugc`.

  const firstParagraph = host.querySelector('p')?.textContent?.trim() ?? '';
  return { html: host.innerHTML, toc, plainFirstParagraph: firstParagraph };
}
