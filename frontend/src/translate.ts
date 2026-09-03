// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { TranslationClient } from '@mosaicast/plugin-sdk';

/**
 * Machine-translating a wiki page, without handing the translator markup it does not understand.
 *
 * **The host owns translation and this plugin only asks.** `ctx.translation` is `null` unless the manifest
 * declares `external.kinds: ['translation']` *and* the site admin configured a provider — two reasons the
 * contract keeps deliberately indistinguishable — so every call site reads the handle at the point of use
 * rather than caching it, since the operator half moves under a running plugin.
 *
 * **Markdown is neither `'text'` nor `'html'`**, which the SDK says plainly: sent as text, a translator
 * rewords link targets, breaks fences and helpfully translates a slug. So the body is taken apart before
 * it is sent:
 *
 * 1. Split into blocks, respecting fenced code — a fence contains blank lines and a naive split cuts
 *    through it. A block is translated alone, so one bad answer costs one paragraph rather than the page.
 * 2. Lift each line's own marker (`##`, `-`, `1.`, `>`) off the front. A translator asked to translate
 *    `## Sightings` may return prose about a heading.
 * 3. Mask everything that must come back byte-identical into `MCWIKI<n>X` tokens — the alphanumeric shape
 *    core's own catalog drafter uses for `{{placeholders}}`, because it survives a translator *and* leaves
 *    sensible word order around itself.
 * 4. Check every token came back exactly once, and that the line count is unchanged. A block that fails
 *    is **kept in the source language** and counted, because mangled markup is worse than untranslated
 *    prose and silently shipping it is worse than both.
 *
 * **Nothing here writes.** The result is a draft an author reads and saves, or does not — the same posture
 * core's legal-page prefill takes, for the same reason: a translation nobody has read is not made safer by
 * being automatic.
 */

/** The token shape masked constructs are replaced by. Alphanumeric, so no translator treats it as markup. */
const TOKEN = (n: number) => `MCWIKI${n}X`;

/**
 * What is masked before a markdown link, most specific first.
 *
 * Order is load-bearing throughout: `[[wiki links]]` go before {@link LINK} so one cannot be read as a
 * label, and a bare URL goes *after* it — a `\S+` URL pattern run first swallows the `)` closing a link's
 * target and leaves nothing for the link pattern to match.
 */
const BEFORE_LINKS: RegExp[] = [
  /<!--[\s\S]*?-->/g, // an HTML comment
  /`[^`\n]*`/g, // inline code
  /\[\[[^\]\n]*\]\]/g, // a wiki or episode link, whole: a translated slug resolves nowhere
];

/** And after: what is left once every link's target is already a token. */
const AFTER_LINKS: RegExp[] = [
  /<\/?[a-zA-Z][^>\n]*>/g, // an inline HTML tag
  /\bhttps?:\/\/[^\s<>()]+/g, // a bare URL, stopping short of the bracket that may be closing something
];

/**
 * A markdown link or image: `[label](target)`, `![caption](blob:ref)`.
 *
 * **Masked as a matched pair, not as one blob and not as a trailing half.** The label is prose and has to
 * be translated; the target is an address and must not be touched. Masking only the `](target)` half does
 * both of those and leaves the translator an *unbalanced* `[` — which a real one closes for you, at the
 * end of the sentence, in the middle of a page. Seen against LibreTranslate; the pair is the fix.
 */
const LINK = /(!?\[)([^\]\n]*)(\]\([^)\s]*(?:\s+"[^"]*")?\))/g;

/** The marker a line carries in its own right, lifted off before translating and put back after. */
const LINE_MARKER = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)?)([\s\S]*)$/;

/** What came back from a translation run. */
export interface TranslationDraft {
  /** The locale it was translated into. */
  target: string;
  title: string;
  summary: string;
  markdown: string;
  /** Blocks left in the source language because their markup did not survive. */
  kept: number;
  /** Blocks that carried prose at all — a fenced code block is neither translated nor counted. */
  total: number;
}

/**
 * Splits markdown into blocks, keeping a fenced code block whole.
 *
 * @param markdown the page body
 * @returns the blocks, in order, with their separating blank lines dropped
 */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of markdown.split('\n')) {
    const opening = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null && opening) {
      flush();
      fence = opening[1][0];
      current.push(line);
      continue;
    }
    if (fence !== null) {
      current.push(line);
      if (new RegExp(`^\\s*${fence}{3,}\\s*$`).test(line)) {
        fence = null;
        flush();
      }
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Whether a block is code rather than prose — never translated, never counted as a failure. */
function isFenced(block: string): boolean {
  return /^\s*(```|~~~)/.test(block);
}

/**
 * Replaces every construct that must survive verbatim with a token.
 *
 * @param text the text to mask
 * @returns the masked text and the originals, in token order; `null` when the text already contains a
 *          token shape, in which case restoring it could not be told apart from the translator inventing
 *          one and the block is left alone
 */
export function mask(text: string): { masked: string; parts: string[] } | null {
  if (/MCWIKI\d+X/.test(text)) {
    return null;
  }
  const parts: string[] = [];
  const take = (found: string) => {
    parts.push(found);
    return TOKEN(parts.length - 1);
  };
  let masked = text;
  for (const pattern of BEFORE_LINKS) {
    masked = masked.replace(pattern, take);
  }
  masked = masked.replace(LINK, (_all, open: string, label: string, close: string) =>
    `${take(open)}${label}${take(close)}`);
  for (const pattern of AFTER_LINKS) {
    masked = masked.replace(pattern, take);
  }
  return { masked, parts };
}

/**
 * Puts the masked constructs back.
 *
 * @param text  what the translator returned
 * @param parts the originals from {@link mask}
 * @returns the restored text, or `null` when a token was dropped, duplicated or mangled — which is the
 *          signal that this block's markup did not survive and the source must be kept instead
 */
export function unmask(text: string, parts: string[]): string | null {
  let restored = text;
  for (let i = 0; i < parts.length; i += 1) {
    const token = TOKEN(i);
    const occurrences = restored.split(token).length - 1;
    if (occurrences !== 1) {
      return null;
    }
    restored = restored.replace(token, () => parts[i]);
  }
  // A token the translator invented, or one belonging to a part that is not ours, is the same failure.
  return /MCWIKI\d+X/.test(restored) ? null : restored;
}

/** One block, ready to send: its per-line markers lifted off and its markup masked. */
interface Prepared {
  markers: string[];
  masked: string;
  parts: string[];
}

function prepare(block: string): Prepared | null {
  const lines = block.split('\n');
  const markers: string[] = [];
  const payloads: string[] = [];
  for (const line of lines) {
    const [, marker, rest] = LINE_MARKER.exec(line) ?? [undefined, '', line];
    markers.push(marker ?? '');
    payloads.push(rest ?? '');
  }
  const masked = mask(payloads.join('\n'));
  return masked === null ? null : { markers, masked: masked.masked, parts: masked.parts };
}

function restore(prepared: Prepared, answer: string): string | null {
  const restored = unmask(answer, prepared.parts);
  if (restored === null) {
    return null;
  }
  const lines = restored.split('\n');
  // A translator that merged or split lines has changed the structure of a list or a heading, and
  // re-applying the markers positionally would put them on the wrong text.
  if (lines.length !== prepared.markers.length) {
    return null;
  }
  return lines.map((line, i) => `${prepared.markers[i]}${line}`).join('\n');
}

/**
 * Translates a page's title, summary and body.
 *
 * @param translation the host's client — read from `ctx.translation` at the point of call, never cached
 * @param page        what to translate; `from` is the source locale, or omitted to let the provider detect
 * @param target      the locale to translate into
 * @returns the draft, with a count of the blocks that had to be left alone
 * @throws whatever `translate` rejects with — a 403 below `external.usedBy`, 409 when the admin removed
 *         the provider, 429, 503 or 504. The caller shows it: a reader who cannot tell a translation from
 *         an original is worse off than one who sees an error.
 */
export async function translatePage(
  translation: TranslationClient,
  page: { title: string; summary: string; markdown: string; from?: string | null },
  target: string,
): Promise<TranslationDraft> {
  const from = page.from || undefined;
  const one = async (text: string): Promise<string> => {
    const trimmed = text.trim();
    if (!trimmed) {
      return text;
    }
    const result = await translation.translate({ text: trimmed, from, to: target, format: 'text' });
    return result.text;
  };

  const title = await one(page.title);
  const summary = await one(page.summary);

  const blocks = splitBlocks(page.markdown);
  const out: string[] = [];
  let kept = 0;
  let total = 0;
  for (const block of blocks) {
    if (isFenced(block) || block.trim() === '') {
      out.push(block);
      continue;
    }
    total += 1;
    const prepared = prepare(block);
    if (prepared === null || prepared.masked.trim() === '') {
      kept += 1;
      out.push(block);
      continue;
    }
    const answer = await translation.translate({
      text: prepared.masked,
      from,
      to: target,
      format: 'text',
    });
    const restored = restore(prepared, answer.text);
    if (restored === null) {
      kept += 1;
      out.push(block);
      continue;
    }
    out.push(restored);
  }

  return { target, title, summary, markdown: out.join('\n\n'), kept, total };
}

/**
 * A translated page waiting to be opened in a new editor.
 *
 * **Module state, deliberately, and the alternative is worse.** The only other way to carry a body from
 * one editor mount to the next is the doc store — which would mean *writing* machine output, the one thing
 * this whole file refuses to do. `ctx.route.navigate` is a client-side move within one bundle, so module
 * state survives it; a reload does not, and finding nothing after one is the right answer.
 *
 * **Read it, do not consume it.** The obvious design — clear on read — was written first and did not
 * work: navigating re-hands `ctx`, which re-runs the index fetch, which unmounts the editor and mounts a
 * fresh one. The *discarded* mount reads the value and the surviving one finds nothing, and the symptom is
 * an empty new-page form with no error anywhere. So {@link peekTranslation} is idempotent and
 * {@link clearTranslation} is called by the view that knows the editor has moved on.
 */
export interface PendingTranslation {
  slug: string;
  title: string;
  summary: string;
  markdown: string;
  locale: string;
  translationOf: string;
}

let pending: PendingTranslation | null = null;

/** Parks a translated page for the editor the caller is about to navigate to. */
export function stashTranslation(draft: PendingTranslation): void {
  pending = draft;
}

/**
 * Reads the parked translation without consuming it, so a remount mid-navigation cannot swallow it.
 *
 * @returns the draft, or `null` when nothing is parked
 */
export function peekTranslation(): PendingTranslation | null {
  return pending;
}

/**
 * Drops the parked translation.
 *
 * Called when the editor leaves the new-page route: an author who navigated away rather than saving has
 * discarded it, and finding it again on their next new page would be a body they did not ask for.
 */
export function clearTranslation(): void {
  pending = null;
}
