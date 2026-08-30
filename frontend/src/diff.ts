// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * A line diff between two revisions of a page.
 *
 * Hand-rolled rather than pulled in, and the reason is the same one that keeps a markdown parser out of
 * the backend: this bundle ships whole to every visitor who opens a wiki page, and a diff library is a
 * lot of bytes for a view most readers never open. The algorithm is the textbook LCS one, which is
 * O(n·m) — fine for a page, and bounded below so a pathological pair degrades to "replaced" rather than
 * to a frozen tab.
 */

/** How many lines the quadratic table is allowed to cover before falling back to a whole-file replace. */
const MAX_CELLS = 4_000_000;

/** One line of a rendered diff. `context` lines are in both revisions. */
export interface DiffLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
  /** 1-based line number in the old revision, absent for an added line. */
  oldNo?: number;
  /** 1-based line number in the new revision, absent for a removed line. */
  newNo?: number;
}

/** How much changed, for a one-line summary above the diff. */
export interface DiffStats {
  added: number;
  removed: number;
}

/** A diff, plus the counts a summary line needs. */
export interface Diff {
  lines: DiffLine[];
  stats: DiffStats;
  /** True when the pair was too large to diff and the result is a whole-file replace. */
  truncated: boolean;
}

const split = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n'));

/**
 * Diffs two page bodies line by line.
 *
 * @param before the older revision's markdown
 * @param after  the newer revision's markdown
 * @returns every line, tagged, in the order a reader should see them
 */
export function diffLines(before: string, after: string): Diff {
  const a = split(before ?? '');
  const b = split(after ?? '');

  if (a.length * b.length > MAX_CELLS) {
    // Two very large bodies: say so rather than spending a second of the visitor's main thread on a
    // table nobody asked for. The content is still shown, just not aligned.
    return {
      lines: [
        ...a.map((text, i): DiffLine => ({ kind: 'removed', text, oldNo: i + 1 })),
        ...b.map((text, i): DiffLine => ({ kind: 'added', text, newNo: i + 1 })),
      ],
      stats: { added: b.length, removed: a.length },
      truncated: true,
    };
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ kind: 'removed', text: a[i], oldNo: i + 1 });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: 'added', text: b[j], newNo: j + 1 });
      added += 1;
      j += 1;
    }
  }
  for (; i < a.length; i += 1) {
    lines.push({ kind: 'removed', text: a[i], oldNo: i + 1 });
    removed += 1;
  }
  for (; j < b.length; j += 1) {
    lines.push({ kind: 'added', text: b[j], newNo: j + 1 });
    added += 1;
  }

  return { lines, stats: { added, removed }, truncated: false };
}

/**
 * Drops runs of unchanged lines far from any change, the way a unified diff does.
 *
 * A wiki page is mostly prose, so a one-word fix in a long article otherwise renders as the whole article
 * with two highlighted lines somewhere in it.
 *
 * @param lines   the full diff
 * @param context how many unchanged lines to keep either side of a change
 * @returns the same lines with distant context replaced by `null` gap markers
 */
export function collapseContext(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'context') {
      return;
    }
    for (let n = index - context; n <= index + context; n += 1) {
      if (n >= 0 && n < lines.length) {
        keep.add(n);
      }
    }
  });

  const out: (DiffLine | null)[] = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push(null); // one gap marker per run, however long the run is
      skipping = true;
    }
  });
  return out;
}
