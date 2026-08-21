// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Renders a page body to HTML that is safe to insert.
 *
 * **Never trust a page body verbatim.** It is written by a podcaster, but it is still author input that
 * ends up as markup on a public page, and markdown permits raw HTML by design. Everything here goes
 * through DOMPurify after parsing, exactly like the reference plugin does for its own markdown.
 *
 * On top of markdown, the wiki understands four tokens of its own. They are expanded to anchors *before*
 * parsing, so the sanitiser still sees them and nothing here is a hole in it:
 *
 * ```
 * [[the-kraken]]                     a wiki link, label = the slug
 * [[the-kraken|the beast]]           a wiki link with a label
 * [[episode:s01e02]]                 an episode link
 * [[episode:s01e02@12:04|the bit]]   an episode link that starts at a moment
 * ![caption](blob:<ref>)             an image this plugin stores itself
 * ```
 */

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
}

/** The rendered body plus the headings found in it. */
export interface RenderedPage {
  html: string;
  toc: TocEntry[];
}

const WIKI_TOKEN = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const BLOB_IMAGE = /!\[([^\]]*)\]\(blob:([A-Za-z0-9-]+)\)/g;
const TIMESTAMP = /^(?:(\d+):)?(\d+):(\d{1,2})$|^(\d+)$/;

/** Escapes text that is about to become part of an HTML attribute or an element's content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Reads a timestamp the way a person writes one: `1:02:03`, `12:04` or plain seconds.
 *
 * @param text the text after the `@` in an episode token
 * @returns the position in seconds, or `undefined` when it is not readable — a mangled timestamp still
 *          opens the episode rather than breaking the link
 */
export function parseTimestamp(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }
  const m = TIMESTAMP.exec(text.trim());
  if (!m) {
    return undefined;
  }
  if (m[4] != null) {
    return Number(m[4]);
  }
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Formats seconds the way the token was written, for the link's own label. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const [h, m, sec] = parts;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Expands the wiki's own tokens into anchors the parser and the sanitiser both understand. */
function expandTokens(markdown: string, options: RenderOptions): string {
  const withImages = markdown.replace(BLOB_IMAGE, (whole, alt: string, ref: string) =>
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
      return `<a class="wiki-ep" href="${escapeHtml(href)}" data-ep="${escapeHtml(target)}"${time}>${escapeHtml(text)}</a>`;
    }

    const missing = !options.hasPage(target);
    const cls = missing ? 'wiki-link wiki-link--missing' : 'wiki-link';
    const title = missing ? ' title="This page does not exist yet"' : '';
    return `<a class="${cls}" href="/p/wiki/${encodeURIComponent(target)}" data-wiki="${escapeHtml(target)}"${title}>${escapeHtml(label || target)}</a>`;
  });
}

/**
 * A `## Sources` heading through to the next heading, in either shipped UI language.
 *
 * The backend extracts that section into `source` rows, and the reader renders those instead: numbered,
 * with each note styled, and guaranteed to match what a citation audit would see. Leaving the prose copy
 * in the body as well would print the whole list twice.
 */
const SOURCES_SECTION = /^#{1,6}[ \t]*(?:sources|quellen)[ \t]*$[\s\S]*?(?=^#{1,6}[ \t]|$(?![\s\S]))/im;

/**
 * Removes the body's own Sources section, for a page whose sources are rendered from the extracted rows.
 *
 * @param markdown the page body
 * @returns the body without that section; unchanged when it has none
 */
export function stripSourcesSection(markdown: string): string {
  return markdown.replace(SOURCES_SECTION, '').trimEnd();
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
  const parsed = marked.parse(expandTokens(markdown ?? '', options), { async: false }) as string;
  const clean = DOMPurify.sanitize(parsed, { ADD_ATTR: ['target', 'rel'] });

  // Ids are assigned after sanitising, on a detached element: an id that came from the body could
  // collide with the host's own, and this way the anchor the TOC points at is one we minted.
  const host = document.createElement('div');
  host.innerHTML = clean;

  const taken = new Set<string>();
  const toc: TocEntry[] = [];
  host.querySelectorAll('h2, h3').forEach((heading) => {
    const text = heading.textContent?.trim() ?? '';
    const id = headingId(text, taken);
    heading.setAttribute('id', id);
    toc.push({ id, text, level: heading.tagName === 'H2' ? 2 : 3 });
  });

  // An external link opens in a new tab and must not hand the opener over with it.
  host.querySelectorAll('a[href^="http"]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });

  return { html: host.innerHTML, toc };
}
