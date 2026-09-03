// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import type { LocaleInfo } from '@mosaicast/plugin-sdk';
import { defaultContentLocale, isMultilingual, localeName, variantsOf } from './languages';
import type { PageSummary } from './types';

const EN: LocaleInfo = { code: 'en', nativeName: 'English', isDefault: true };
const DE: LocaleInfo = { code: 'de', nativeName: 'Deutsch', isDefault: false };

/** A context whose UI list and content list differ, which is the case the two-list contract exists for. */
function ctxWith(content: LocaleInfo[], available: LocaleInfo[] = [EN]) {
  return makeMockCtx({
    locale: { current: () => 'en', onChange: () => () => {}, available: () => available, content: () => content },
  });
}

function summary(fields: Partial<PageSummary> & { title: string }): PageSummary {
  return { summary: null, tags: null, updatedAt: null, locale: null, translationOf: null, ...fields };
}

describe('languages', () => {
  it('treats a site with one content language as monolingual, whatever its UI offers', () => {
    // A site can render its shell in two languages and still author in one. Hanging the editor's language
    // picker off `available()` would put a control on every page of such a site that can only be answered
    // one way.
    expect(isMultilingual(ctxWith([EN], [EN, DE]))).toBe(false);
    expect(isMultilingual(ctxWith([EN, DE], [EN]))).toBe(true);
  });

  it('names a language in its own language, and falls back to the code it does not know', () => {
    const ctx = ctxWith([EN, DE]);
    expect(localeName(ctx, 'de')).toBe('Deutsch');
    // A content language needs no catalog at all, so a code the host cannot name is normal, not an error.
    expect(localeName(ctx, 'nl')).toBe('nl');
    expect(localeName(ctx, null)).toBe('');
  });

  it('reads the site default off the content list', () => {
    expect(defaultContentLocale(ctxWith([DE, EN]))).toBe('en');
  });

  describe('variantsOf', () => {
    const index: Record<string, PageSummary> = {
      'the-kraken': summary({ title: 'The Kraken', locale: 'en' }),
      'der-krake': summary({ title: 'Der Krake', locale: 'de', translationOf: 'the-kraken' }),
      'deep-sea': summary({ title: 'The deep sea', locale: 'en' }),
    };

    it('finds a page from its translation and a translation from its page', () => {
      expect(variantsOf('the-kraken', null, index).map((v) => v.slug)).toEqual(['der-krake', 'the-kraken']);
      expect(variantsOf('der-krake', 'the-kraken', index).map((v) => v.slug)).toEqual([
        'der-krake',
        'the-kraken',
      ]);
    });

    it('marks the page being read, so the switcher can say where you are', () => {
      const current = variantsOf('der-krake', 'the-kraken', index).filter((v) => v.current);
      expect(current.map((v) => v.slug)).toEqual(['der-krake']);
    });

    it('returns nothing for a page that stands alone, so a monolingual wiki renders no switcher', () => {
      expect(variantsOf('deep-sea', null, index)).toEqual([]);
    });

    it('cannot surface an unpublished translation, because the index holds published pages only', () => {
      // The security property, stated as a test: the reader never queries the schema for siblings, so
      // there is no filter here to forget. A draft translation is absent from `index` by construction.
      const withoutDraft = { ...index };
      delete withoutDraft['der-krake'];
      expect(variantsOf('the-kraken', null, withoutDraft)).toEqual([]);
    });
  });
});
