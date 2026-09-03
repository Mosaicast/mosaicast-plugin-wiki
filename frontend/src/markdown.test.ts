// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseTimestamp, renderPage, stripSourcesSection, type RenderOptions } from './markdown';

const options = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  hasPage: (slug) => slug === 'the-kraken',
  episodeHref: (slug, seconds) => (seconds == null ? `/episodes/${slug}` : `/episodes/${slug}?t=${seconds}`),
  ...over,
});

describe('renderPage — sanitising', () => {
  it('strips a script tag out of author markdown', () => {
    // Markdown permits raw HTML by design, and a page body is author input that ends up as markup on a
    // public page. This is the whole reason the output goes through DOMPurify.
    const { html } = renderPage('Hello <script>alert(1)</script> there', options());

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Hello');
  });

  it('strips an inline event handler', () => {
    const { html } = renderPage('<img src="x" onerror="alert(1)">', options());

    expect(html).not.toContain('onerror');
  });

  it('drops a javascript: URL', () => {
    const { html } = renderPage('[click me](javascript:alert(1))', options());

    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('escapes a label that tries to close its own tag', () => {
    const { html } = renderPage('[[the-kraken|</a><script>alert(1)</script>]]', options());

    expect(html).not.toContain('<script');
  });
});

describe('renderPage — wiki tokens', () => {
  it('links a page that exists and marks one that does not', () => {
    const { html } = renderPage('[[the-kraken]] and [[nowhere]]', options());

    expect(html).toContain('href="/p/wiki/the-kraken"');
    expect(html).toContain('data-wiki="the-kraken"');
    // A red link tells the reader the page is unwritten rather than leaving a dead link that looks fine.
    expect(html).toContain('wiki-link--missing');
  });

  it('uses the label when the token carries one', () => {
    const { html } = renderPage('[[the-kraken|the beast]]', options());

    expect(html).toContain('>the beast</a>');
  });

  it('asks the host for an episode URL rather than hardcoding one', () => {
    const seen: (number | undefined)[] = [];
    const { html } = renderPage('[[episode:s01e02]]', options({
      episodeHref: (slug, seconds) => {
        seen.push(seconds);
        return `/episodes/${slug}`;
      },
    }));

    expect(seen).toEqual([undefined]);
    expect(html).toContain('data-ep="s01e02"');
  });

  it('carries a timestamp into the episode link and its label', () => {
    const { html } = renderPage('[[episode:s01e02@12:04]]', options());

    expect(html).toContain('href="/episodes/s01e02?t=724"');
    expect(html).toContain('12:04');
  });

  it('keeps a mangled timestamp from breaking the link', () => {
    // The host drops an unparsable `t` rather than rejecting the URL, and so does this.
    const { html } = renderPage('[[episode:s01e02@half past|later]]', options());

    expect(html).toContain('href="/episodes/s01e02"');
    expect(html).toContain('>later</a>');
  });

  it('renders an upload through the blob URL, and drops it when there is no file storage', () => {
    const withStorage = renderPage('![a diagram](blob:abc-123)', options({ blobUrl: (ref) => `/api/plugins/wiki/blob/${ref}` }));
    expect(withStorage.html).toContain('src="/api/plugins/wiki/blob/abc-123"');

    // A plugin whose manifest declares no `blobs` block has `ctx.blobs === null`. Emitting a broken
    // image would be worse than keeping the caption as text.
    const without = renderPage('![a diagram](blob:abc-123)', options());
    expect(without.html).not.toContain('<img');
    expect(without.html).toContain('a diagram');
  });
});

describe('renderPage — headings and external links', () => {
  it('gives every heading an id and reports it as a table of contents', () => {
    const { html, toc } = renderPage('## First\n\n### Nested\n\n## Second', options());

    expect(toc).toEqual([
      { id: 'first', text: 'First', level: 2 },
      { id: 'nested', text: 'Nested', level: 3 },
      { id: 'second', text: 'Second', level: 2 },
    ]);
    expect(html).toContain('id="first"');
  });

  it('keeps two headings with the same text apart', () => {
    const { toc } = renderPage('## Notes\n\n## Notes', options());

    expect(toc.map((entry) => entry.id)).toEqual(['notes', 'notes-2']);
  });

  it('never hands the opener to an external tab', () => {
    const { html } = renderPage('[out](https://example.com)', options());

    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('leaves an in-wiki link in the same tab', () => {
    const { html } = renderPage('[[the-kraken]]', options());

    expect(html).not.toContain('target="_blank"');
  });
});

describe('timestamps', () => {
  // The host's `?t=` grammar (ARCHITECTURE §6.4). The same table core's util/timestamp.ts and
  // web/TimestampParam.java are held to: one grammar, three implementations, and a link that previews as
  // one moment and plays another is worse than one carrying no timestamp at all.
  it('reads the forms a person writes', () => {
    expect(parseTimestamp('754')).toBe(754);
    expect(parseTimestamp('12:04')).toBe(724);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('1h02m03s')).toBe(3723);
    expect(parseTimestamp('90m')).toBe(5400);
    expect(parseTimestamp('1H')).toBe(3600);
  });

  it('drops one it cannot read', () => {
    expect(parseTimestamp('later')).toBeUndefined();
    expect(parseTimestamp(undefined)).toBeUndefined();
    expect(parseTimestamp('')).toBeUndefined();
    expect(parseTimestamp('h')).toBeUndefined();      // the all-optional unit pattern reads as zero without a guard
    expect(parseTimestamp('12:70')).toBeUndefined();  // minutes and seconds are bounded, as in the host
    expect(parseTimestamp('99999')).toBeUndefined();  // past 24h is a typo or a probe
  });

  it('formats them back the same way', () => {
    expect(formatTimestamp(724)).toBe('12:04');
    expect(formatTimestamp(3723)).toBe('1:02:03');
    expect(formatTimestamp(9)).toBe('0:09');
  });
});

describe('stripSourcesSection', () => {
  it('removes the body copy of a section rendered from the extracted rows', () => {
    const body = [
      'Prose.',
      '',
      '## Sources',
      '- [W](https://example.com) - note',
      '',
      '## Notes',
      'Kept.',
    ].join('\n');

    const stripped = stripSourcesSection(body);

    expect(stripped).not.toContain('https://example.com');
    expect(stripped).toContain('Prose.');
    expect(stripped).toContain('Kept.');   // the section ends at the next heading
  });

  it('removes a trailing section with nothing after it', () => {
    expect(stripSourcesSection('Prose.\n\n## Sources\n- [W](https://example.com)\n')).toBe('Prose.');
  });

  it('handles the German heading the extractor also accepts', () => {
    expect(stripSourcesSection('Prose.\n\n## Quellen\n- [W](https://example.com)\n')).toBe('Prose.');
  });

  it('strips the heading the backend actually matched, in a language it never shipped with', () => {
    // The vocabulary is a config field now. The browser is told which heading matched rather than keeping
    // a second copy of the list -- which is why a Spanish wiki used to print its sources twice.
    const body = 'Prosa.\n\n## Fuentes\n- [Un libro](https://example.com/libro)\n';

    expect(stripSourcesSection(body, 'Fuentes')).toBe('Prosa.');
    expect(stripSourcesSection(body)).toContain('Fuentes');   // no heading given: the shipped pair only
  });

  it('treats a configured heading as text, not as a pattern', () => {
    const body = 'Prose.\n\n## Sources (cited)\n- [W](https://example.com)\n';

    expect(stripSourcesSection(body, 'Sources (cited)')).toBe('Prose.');
  });

  it('leaves a body without one untouched', () => {
    expect(stripSourcesSection('Just prose.')).toBe('Just prose.');
    expect(stripSourcesSection('Just prose.', 'Fuentes')).toBe('Just prose.');
  });
});
