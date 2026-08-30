// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { collapseContext, diffLines } from './diff';

const kinds = (before: string, after: string) => diffLines(before, after).lines.map((l) => `${l.kind[0]}${l.text}`);

describe('diffLines', () => {
  it('reports two identical bodies as all context', () => {
    const diff = diffLines('one\ntwo', 'one\ntwo');

    expect(diff.stats).toEqual({ added: 0, removed: 0 });
    expect(diff.lines.every((line) => line.kind === 'context')).toBe(true);
  });

  it('finds a single changed line without rewriting the rest', () => {
    // The whole point of an LCS diff over a naive one: a one-word fix is one line, not a whole-file swap.
    expect(kinds('a\nb\nc', 'a\nB\nc')).toEqual(['ca', 'rb', 'aB', 'cc']);
    expect(diffLines('a\nb\nc', 'a\nB\nc').stats).toEqual({ added: 1, removed: 1 });
  });

  it('handles an insertion and a deletion', () => {
    expect(kinds('a\nc', 'a\nb\nc')).toEqual(['ca', 'ab', 'cc']);
    expect(kinds('a\nb\nc', 'a\nc')).toEqual(['ca', 'rb', 'cc']);
  });

  it('numbers lines against their own revision', () => {
    const diff = diffLines('a\nb', 'a\nB');

    const removed = diff.lines.find((line) => line.kind === 'removed');
    const added = diff.lines.find((line) => line.kind === 'added');
    expect(removed).toMatchObject({ oldNo: 2 });
    expect(removed?.newNo).toBeUndefined();
    expect(added).toMatchObject({ newNo: 2 });
    expect(added?.oldNo).toBeUndefined();
  });

  it('treats an empty body as no lines, not as one blank line', () => {
    expect(diffLines('', 'a').stats).toEqual({ added: 1, removed: 0 });
    expect(diffLines('a', '').stats).toEqual({ added: 0, removed: 1 });
    expect(diffLines('', '').lines).toEqual([]);
  });

  it('normalises line endings, so a CRLF paste is not a whole-file change', () => {
    expect(diffLines('a\r\nb', 'a\nb').stats).toEqual({ added: 0, removed: 0 });
  });

  it('degrades to a whole-file replace rather than freezing on a pathological pair', () => {
    // The table is O(n*m). Better to say "too large to align" than to spend a second of the visitor's
    // main thread on a view they can still read.
    const big = (seed: string) => Array.from({ length: 2200 }, (_, i) => `${seed}${i}`).join('\n');

    const diff = diffLines(big('a'), big('b'));

    expect(diff.truncated).toBe(true);
    expect(diff.stats).toEqual({ added: 2200, removed: 2200 });
  });
});

describe('collapseContext', () => {
  it('keeps context around a change and folds the rest into one gap', () => {
    const lines = diffLines(
      Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
      Array.from({ length: 40 }, (_, i) => (i === 20 ? 'changed' : `line ${i}`)).join('\n'),
    ).lines;

    const collapsed = collapseContext(lines, 2);
    const gaps = collapsed.filter((line) => line === null).length;
    const kept = collapsed.filter((line): line is NonNullable<typeof line> => line !== null);

    expect(gaps).toBe(2); // one before the change, one after
    expect(kept.some((line) => line.text === 'changed')).toBe(true);
    expect(kept.every((line) => Math.abs(Number((line.oldNo ?? line.newNo ?? 0)) - 21) <= 4)).toBe(true);
  });

  it('emits one marker per run, however long the run is', () => {
    const lines = diffLines('x\n'.repeat(100) + 'a', 'x\n'.repeat(100) + 'b').lines;

    expect(collapseContext(lines, 1).filter((line) => line === null).length).toBe(1);
  });

  it('leaves a short diff alone', () => {
    const lines = diffLines('a\nb', 'a\nB').lines;

    expect(collapseContext(lines, 3)).toEqual(lines);
  });
});
