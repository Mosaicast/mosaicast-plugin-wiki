// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import type { TranslationClient, TranslationRequest } from '@mosaicast/plugin-sdk';
import { mask, splitBlocks, stashTranslation, takeTranslation, translatePage, unmask } from './translate';

/**
 * A translator that behaves like a real one on the axis that matters: it rewrites the prose it is given
 * and leaves alphanumeric tokens alone. `transform` lets a test make it misbehave in one specific way.
 */
function fakeTranslator(transform: (text: string) => string = (t) => `«${t}»`): TranslationClient {
  return {
    available: () => true,
    translate: (request: TranslationRequest) =>
      Promise.resolve({
        text: transform(request.text),
        detectedSourceLanguage: request.from ?? 'en',
        providerId: 'fake',
        fromCache: false,
      }),
  };
}

const PAGE = {
  title: 'The Kraken',
  summary: 'A very large squid.',
  markdown: [
    '## Sightings',
    '',
    'Seen off [[deep-sea|the deep]] and cited in [[episode:s01e02@12:04|the bit]].',
    '',
    '```json',
    '{ "size": "unmeasured" }',
    '',
    '{ "still": "inside the fence" }',
    '```',
    '',
    '- One at https://example.org/kraken',
    '- Another with `inline code`',
    '',
    '![A squid](blob:abc-123)',
  ].join('\n'),
};

describe('splitBlocks', () => {
  it('keeps a fenced block whole, blank lines and all', () => {
    // The naive split is on blank lines, and a fence routinely contains one — cutting through it turns
    // one code block into two broken ones.
    const blocks = splitBlocks(PAGE.markdown);
    const fenced = blocks.filter((b) => b.startsWith('```'));
    expect(fenced).toHaveLength(1);
    expect(fenced[0]).toContain('still');
  });
});

describe('mask / unmask', () => {
  it('round-trips every construct that must survive byte for byte', () => {
    const source =
      'See [[the-kraken|it]] at https://example.org/x, `code`, ![cap](blob:r1) and <!-- a note -->.';
    const masked = mask(source)!;
    expect(masked.masked).not.toContain('[[');
    expect(masked.masked).not.toContain('https://');
    expect(unmask(masked.masked, masked.parts)).toBe(source);
  });

  it('leaves the label of a link translatable while pinning its target', () => {
    const masked = mask('![A squid](blob:abc-123)')!;
    expect(masked.masked).toContain('A squid');
    expect(masked.parts).toContain('](blob:abc-123)');
  });

  it('refuses text that already looks masked, since a restore could not be told from an invention', () => {
    expect(mask('this mentions MCWIKI0X literally')).toBeNull();
  });

  it('reports a dropped or duplicated token rather than restoring half a block', () => {
    const masked = mask('a [[link]] here')!;
    expect(unmask(masked.masked.replace('MCWIKI0X', ''), masked.parts)).toBeNull();
    expect(unmask(`${masked.masked} MCWIKI0X`, masked.parts)).toBeNull();
  });
});

describe('translatePage', () => {
  it('translates the prose and returns the markup unchanged', async () => {
    const draft = await translatePage(fakeTranslator(), { ...PAGE, from: 'en' }, 'de');

    expect(draft.title).toBe('«The Kraken»');
    // Every construct is back, exactly as written.
    expect(draft.markdown).toContain('[[deep-sea|the deep]]');
    expect(draft.markdown).toContain('[[episode:s01e02@12:04|the bit]]');
    expect(draft.markdown).toContain('](blob:abc-123)');
    expect(draft.markdown).toContain('https://example.org/kraken');
    expect(draft.markdown).toContain('`inline code`');
    // The fence is passed through untouched and is not counted as prose.
    expect(draft.markdown).toContain('{ "size": "unmeasured" }');
    expect(draft.markdown).not.toContain('«{ "size"');
    expect(draft.kept).toBe(0);
  });

  it('keeps a block in the source language rather than shipping mangled markup', async () => {
    // A translator that ate a token. The alternative to keeping this block is a page whose image link
    // silently stopped working, which is worse and much harder to notice.
    const eatsTokens = fakeTranslator((text) => text.replace(/MCWIKI\d+X/g, ''));

    const draft = await translatePage(eatsTokens, { ...PAGE, from: 'en' }, 'de');

    expect(draft.markdown).toContain('[[deep-sea|the deep]]');
    expect(draft.kept).toBeGreaterThan(0);
    expect(draft.kept).toBeLessThanOrEqual(draft.total);
  });

  it('keeps a block whose line count the translator changed', async () => {
    // Markers are re-applied positionally, so a merged list is a list whose bullets would land on the
    // wrong text.
    const mergesLines = fakeTranslator((text) => text.replace(/\n/g, ' '));

    const draft = await translatePage(mergesLines, { ...PAGE, from: 'en' }, 'de');

    expect(draft.markdown).toContain('- One at https://example.org/kraken');
    expect(draft.kept).toBeGreaterThan(0);
  });

  it('puts a heading and a list marker back where they were', async () => {
    const draft = await translatePage(fakeTranslator(), { ...PAGE, from: 'en' }, 'de');

    expect(draft.markdown).toContain('## «Sightings»');
    expect(draft.markdown.split('\n').some((line) => line.startsWith('- «'))).toBe(true);
  });

  it('lets the provider detect the language when the page states none', async () => {
    const seen: TranslationRequest[] = [];
    const spy: TranslationClient = {
      available: () => true,
      translate: (request) => {
        seen.push(request);
        return Promise.resolve({
          text: request.text,
          detectedSourceLanguage: null,
          providerId: 'fake',
          fromCache: false,
        });
      },
    };

    await translatePage(spy, { title: 'T', summary: '', markdown: 'Body.', from: null }, 'de');

    expect(seen.every((request) => request.from === undefined)).toBe(true);
    // Markdown is neither, so it goes as text with everything unsafe already masked out.
    expect(seen.every((request) => request.format === 'text')).toBe(true);
  });

  it('lets a refusal reach the caller instead of quietly returning the original', async () => {
    const refuses: TranslationClient = {
      available: () => true,
      translate: () => Promise.reject(new Error('429')),
    };

    await expect(translatePage(refuses, { ...PAGE, from: 'en' }, 'de')).rejects.toThrow('429');
  });
});

describe('the hand-off to a new page', () => {
  it('is taken once, so a reload finds nothing rather than a stale draft', () => {
    const parked = {
      slug: 'the-kraken-de',
      title: 'Der Krake',
      summary: '',
      markdown: 'Ein Tintenfisch.',
      locale: 'de',
      translationOf: 'the-kraken',
    };
    stashTranslation(parked);

    expect(takeTranslation()).toEqual(parked);
    expect(takeTranslation()).toBeNull();
  });
});
