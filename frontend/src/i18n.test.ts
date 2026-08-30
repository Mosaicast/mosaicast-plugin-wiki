// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import de from '../locales/de.json';

// The imported JSON has a literal type per key, so indexing it by a string needs the wider view.
const EN: Record<string, string> = en;
const DE: Record<string, string> = de;
const CATALOGS: Record<string, Record<string, string>> = { en: EN, de: DE };

describe('locale catalogs', () => {
  it('carry the same keys, so a locale never falls back silently', () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it('contain sentences only, never presentation characters', () => {
    // An icon is not a word. A mark inside a translated string is something a translator can alter, drop
    // or mirror wrongly for an RTL locale, and it renders as whatever emoji font the visitor happens to
    // have. Marks belong in CSS, as a --mc-icon-* mask (ARCHITECTURE §12.3).
    const MARKS = /[←-⇿⌀-➿⬀-⯿️]|[\u{1F000}-\u{1FAFF}]/u;
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(MARKS.test(value), `${locale}.${key} carries a presentation character: ${value}`).toBe(false);
      }
    }
  });

  it('keep every interpolation placeholder across locales', () => {
    // A dropped {{n}} shows a sentence with a hole in it, and only in the locale nobody tests in.
    const placeholders = (value: string) => (value.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const key of Object.keys(EN)) {
      expect(placeholders(DE[key]), `de.${key}`).toEqual(placeholders(EN[key]));
    }
  });
});
