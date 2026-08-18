// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { WIKI_CSS } from './styles';

/**
 * The stylesheet is a template literal, so **importing it is itself the guard** against the trap that cost
 * two builds here: a backtick inside a CSS comment terminates the string, and the parse error then points
 * at whatever word follows rather than at the quote. This file cannot run at all if that happens again.
 *
 * What is left to assert is the part a compiler cannot see.
 */
describe('WIKI_CSS', () => {
  it('takes every colour from a host theme token', () => {
    // A literal colour survives a theme switch and an operator's accent seed, and looks broken after both.
    // Hex and rgb() are the two ways that creeps in by accident.
    expect(WIKI_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(WIKI_CSS).not.toMatch(/\brgba?\(/);
    expect(WIKI_CSS).toContain('var(--mc-text)');
    expect(WIKI_CSS).toContain('var(--mc-accent)');
  });

  it('sizes the search field by width, never by height, once the bar stacks', () => {
    // In a column flex container flex-basis sizes the HEIGHT: the row layout's "flex: 1 1 16rem" made the
    // search field 16rem tall on a phone. Caught by the 375px screenshot; pinned here so it stays fixed.
    const query = WIKI_CSS.split('@container (max-width: 30rem)')[1] ?? '';
    expect(query).toContain('.wiki__search { flex: 0 0 auto; }');
  });
});
