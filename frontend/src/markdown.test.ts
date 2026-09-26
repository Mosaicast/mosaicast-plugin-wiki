// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { sanitizeLikeHost } from '@mosaicast/plugin-sdk/testing';
import {
  formatImage,
  formatTimestamp,
  imageTokenAt,
  parseImageAttrs,
  parseTimestamp,
  renderPage,
  stripSourcesSection,
  type RenderOptions,
} from './markdown';

const options = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  hasPage: (slug) => slug === 'the-kraken',
  episodeHref: (slug, seconds) => (seconds == null ? `/episodes/${slug}` : `/episodes/${slug}?t=${seconds}`),
  // What `ctx.sanitize` does in the host, reimplemented by the SDK test kit (SDK 0.16.0).
  sanitize: sanitizeLikeHost,
  ...over,
});

describe('renderPage — the host policy, and the wiki\'s own markup (SDK 0.16.0)', () => {
  const host = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  };

  it('drops a stylesheet an author wrote — the page defacement DOMPurify defaults let through (SEC-C07)', () => {
    const { html } = renderPage(
      'Fine <style>:host{position:fixed;inset:0;z-index:99999}</style>\n\n<p style="position:fixed">x</p>',
      options(),
    );
    const page = host(html);
    expect(page.querySelector('style')).toBeNull();
    expect(page.querySelector('[style]')).toBeNull();
    expect(page.textContent).toContain('Fine');
  });

  it('keeps the attributes the wiki\'s own tokens need, and gives an author none of them', () => {
    const { html } = renderPage(
      '[[the-kraken]] and [[episode:s01e02@1:30]] and ![map](/m.png){width=50% align=left} and ' +
        '<a class="wiki-link" data-wiki="evil" href="/x">forged</a>',
      options(),
    );
    const page = host(html);
    const link = page.querySelector('a[data-wiki="the-kraken"]');
    expect(link?.className).toBe('wiki-link');
    expect(page.querySelector('a.wiki-ep')?.getAttribute('data-t')).toBe('90');
    const image = page.querySelector('img.wiki__img--left') as HTMLImageElement | null;
    expect(image?.style.width).toBe('50%');
    // The same attributes, typed by the author, are the host's to refuse.
    const forged = [...page.querySelectorAll('a')].find((a) => a.textContent === 'forged');
    expect(forged?.hasAttribute('class')).toBe(false);
    expect(forged?.hasAttribute('data-wiki')).toBe(false);
  });

  it('never splices a token into an attribute, where markup would become attributes', () => {
    const { html } = renderPage('![look [[the-kraken]]](/m.png)', options());
    const image = host(html).querySelector('img');
    expect(image).not.toBeNull();
    expect(image!.getAttributeNames().sort()).toEqual(['alt', 'src']);
    expect(image!.getAttribute('alt')).not.toContain('<');
  });
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

describe('image attributes', () => {
  const opts: RenderOptions = {
    hasPage: () => true,
    episodeHref: (slug) => `/episodes/${slug}`,
    blobUrl: (ref) => `/api/plugins/wiki/blob/${ref}`,
    sanitize: sanitizeLikeHost,
  };

  it('reads a width in pixels or percent, and an alignment', () => {
    expect(parseImageAttrs('width=320')).toEqual({ width: '320px', align: null });
    expect(parseImageAttrs('width=320px align=right')).toEqual({ width: '320px', align: 'right' });
    expect(parseImageAttrs('width=50%')).toEqual({ width: '50%', align: null });
    expect(parseImageAttrs('align=center')).toEqual({ width: null, align: 'center' });
  });

  it('drops anything it did not ask for rather than rendering it', () => {
    // The value is regenerated from a number, never interpolated, which is what makes writing a style
    // attribute safe here. A width that is not a number, or an alignment that is not one of three words,
    // simply does not appear.
    expect(parseImageAttrs('width=onhundred')).toEqual({ width: null, align: null });
    expect(parseImageAttrs('width=0')).toEqual({ width: null, align: null });
    expect(parseImageAttrs('width=200%')).toEqual({ width: null, align: null });
    expect(parseImageAttrs('align=diagonal')).toEqual({ width: null, align: null });
    expect(parseImageAttrs('onerror=alert(1)')).toEqual({ width: null, align: null });
    expect(parseImageAttrs('width=100;background:url(x)')).toEqual({ width: null, align: null });
  });

  it('renders a sized upload as an img the sanitiser keeps', () => {
    const html = renderPage('![A squid](blob:abc-123){width=320 align=right}', opts).html;

    expect(html).toContain('src="/api/plugins/wiki/blob/abc-123"');
    expect(html).toContain('width:320px');
    expect(html).toContain('wiki__img--right');
    expect(html).not.toContain('{width');
  });

  it('makes a sized image a block, so two in a row stack like unsized ones do', () => {
    // A raw <img> is an HTML *block* to marked and gets no wrapping paragraph, so without this two sized
    // images render side by side and an author who wrote them on separate lines is surprised.
    const html = renderPage(`![One](blob:a){width=100}\n\n![Two](blob:b){width=100}`, opts).html;

    expect(html.match(/class="wiki__img"/g)).toHaveLength(2);
  });

  it('sizes an external image too', () => {
    const html = renderPage('![Chart](https://example.org/c.png){width=50%}', opts).html;

    expect(html).toContain('src="https://example.org/c.png"');
    expect(html).toContain('width:50%');
  });

  it('leaves an image with no attribute block exactly as it was', () => {
    const html = renderPage('![A squid](blob:abc-123)', opts).html;

    expect(html).toContain('/api/plugins/wiki/blob/abc-123');
    expect(html).not.toContain('style=');
  });

  it('drops a sized upload when there is no file storage, like an unsized one', () => {
    const html = renderPage('![A squid](blob:abc-123){width=320}', { ...opts, blobUrl: undefined }).html;

    expect(html).not.toContain('<img');
    expect(html).toContain('A squid');
  });
});

describe('editing an image already in the body', () => {
  const body = 'Before.\n\n![A squid](blob:abc){width=320 align=right}\n\nAfter.';

  it('finds the image the caret is sitting in', () => {
    // The stand-in for right-clicking an image: a textarea has text, not images, so the affordance has to
    // be the token the caret is already inside.
    const found = imageTokenAt(body, body.indexOf('squid'))!;

    expect(found).toMatchObject({ alt: 'A squid', target: 'blob:abc', width: '320px', align: 'right' });
    expect(body.slice(found.start, found.end)).toBe('![A squid](blob:abc){width=320 align=right}');
  });

  it('counts the caret at either edge of the token, including just after inserting one', () => {
    const start = body.indexOf('![A squid');
    const end = start + '![A squid](blob:abc){width=320 align=right}'.length;

    expect(imageTokenAt(body, start)).not.toBeNull();
    expect(imageTokenAt(body, end)).not.toBeNull();
    expect(imageTokenAt(body, 0)).toBeNull();
  });

  it('writes an image back out, and omits the block when there is nothing to say', () => {
    expect(formatImage({ alt: 'A squid', target: 'blob:abc' })).toBe('![A squid](blob:abc)');
    expect(formatImage({ alt: 'A squid', target: 'blob:abc', width: null, align: null }))
      .toBe('![A squid](blob:abc)');
    expect(formatImage({ alt: 'A squid', target: 'blob:abc', width: '320px', align: 'right' }))
      .toBe('![A squid](blob:abc){width=320px align=right}');
    expect(formatImage({ alt: 'A squid', target: 'blob:abc', align: 'center' }))
      .toBe('![A squid](blob:abc){align=center}');
  });

  it('round-trips: what it reads it can write back unchanged', () => {
    const found = imageTokenAt(body, body.indexOf('squid'))!;

    expect(formatImage(found)).toBe('![A squid](blob:abc){width=320px align=right}');
    // …and reading that again gives the same thing, so repeated edits do not drift.
    expect(imageTokenAt(formatImage(found), 3)).toMatchObject({ width: '320px', align: 'right' });
  });

  it('finds an unsized image too, so options can be added to one that has none', () => {
    const plain = 'Text ![Plain](blob:xyz) more.';

    expect(imageTokenAt(plain, plain.indexOf('Plain'))).toMatchObject({
      alt: 'Plain', target: 'blob:xyz', width: null, align: null,
    });
  });
});
