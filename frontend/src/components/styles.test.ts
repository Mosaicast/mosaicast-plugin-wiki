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

  it('draws host icons as a mask, never as a background image', () => {
    // A background image bakes in the colour the artwork was drawn as; a mask takes the caller's own,
    // so the icon re-themes with the text beside it (ARCHITECTURE §12.3).
    expect(WIKI_CSS).toContain('mask-image: var(--mc-icon-');
    expect(WIKI_CSS).not.toMatch(/background-image:\s*var\(--mc-icon-/);
  });

  it('gives every icon reference a blank fallback, so a missing one is not a solid square', () => {
    // An unresolved var() makes the declaration invalid at computed-value time and mask-image reverts to
    // its initial "none" — an unmasked element painting currentColor across its whole box.
    for (const [, reference] of WIKI_CSS.matchAll(/mask-image:\s*([^;]+);/g)) {
      expect(reference).toContain('var(--wiki-icon-blank)');
    }
    expect(WIKI_CSS).toContain('--wiki-icon-blank:');
  });

  it('never declares into the host own token namespace', () => {
    // Defining a --mc-* property would shadow the real token for this plugin's subtree the moment core
    // publishes one. Referencing them is the whole point; declaring them is the bug.
    expect(WIKI_CSS).not.toMatch(/^\s*--mc-[a-z-]+\s*:/m);
  });

  it('sizes the search field by width, never by height, once the bar stacks', () => {
    // In a column flex container flex-basis sizes the HEIGHT: the row layout's "flex: 1 1 16rem" made the
    // search field 16rem tall on a phone. Caught by the 375px screenshot; pinned here so it stays fixed.
    const query = WIKI_CSS.split('@container (max-width: 30rem)')[1] ?? '';
    expect(query).toContain('.wiki__search { flex: 0 0 auto; }');
  });
});
