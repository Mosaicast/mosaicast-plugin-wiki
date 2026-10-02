// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import { formatImage, formatTimestamp, imageTokenAt, parseImageAttrs, parseTimestamp, renderPage } from '../markdown';
import { routeHref, routePath, toSlug, type WikiRoute } from '../routes';
import {
  ASSET_PREFIX,
  assetKey,
  deleteKey,
  draftKey,
  SITE_PATH,
  type AssetDoc,
  type IngestReceipt,
  type PageRow,
  type PageSummary,
} from '../types';
import type { PluginI18n } from '../i18n';
import { defaultContentLocale, isMultilingual, localeName } from '../languages';
import { peekTranslation, stashTranslation, translatePage, type TranslationDraft } from '../translate';
import { Icon } from '../icons';
import { describeApiError } from './useDoc';

/** How often to re-read the ingest receipt while a save is queued. */
/** How many rows a picker shows before searching is the better move than scrolling. */
const PICKER_LIMIT = 40;

const POLL_MS = 2_000;

/** How long to keep polling before saying so. The backend tick is configurable, so this is generous. */
const POLL_TIMEOUT_MS = 120_000;

/** What the save button is currently doing. */
type SaveState =
  | { phase: 'idle' }
  | { phase: 'queued' }
  | { phase: 'saved'; revisionNo: number | null }
  | { phase: 'conflict'; detail: string | null }
  | { phase: 'rejected'; detail: string | null }
  | { phase: 'timeout' }
  | { phase: 'failed' };

interface EditorViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  /** The page being edited, or null when this is a new page. */
  slug: string | null;
  index: Record<string, PageSummary>;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * The page editor.
 *
 * **A save here is not a write to the wiki; it is a request to write.** There are no schema writes over
 * HTTP and no plugin code runs at request time, so the editor puts a `draft:<slug>` document in the doc
 * store and the backend applies it on its next tick. That gap is real — a few seconds by default — and
 * this component's job is to be honest about it: the save button reports *queued*, then polls the
 * `ingest:<slug>` receipt the backend leaves, and only claims success once the backend says so.
 *
 * The same receipt is how a **conflict** surfaces. A draft carries the revision it was started from; if
 * the page moved on meanwhile, the backend refuses the save and keeps the draft, and the editor says so
 * rather than pretending the writing landed.
 *
 * Role is enforced by the host, not here: `data.writableBy` is `podcaster`, so a fan's `PUT` is a 403
 * whatever this component renders. Hiding the editor from them is courtesy, not security.
 */
export function EditorView({ ctx, i18n, slug, index, go }: EditorViewProps) {
  const isNew = slug == null;
  const [loaded, setLoaded] = useState(isNew);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [comment, setComment] = useState('');
  const [baseRevisionNo, setBaseRevisionNo] = useState<number | null>(null);
  // The language this page is written in, and the page it translates. Both are only offered on a site that
  // authors in more than one language -- elsewhere they would be a picker with one option.
  const [locale, setLocale] = useState('');
  const [translationOf, setTranslationOf] = useState('');
  const [target, setTarget] = useState('');
  const [translation, setTranslation] =
    useState<{ busy: boolean; draft: TranslationDraft | null; error: string | null }>({
      busy: false,
      draft: null,
      error: null,
    });

  const [save, setSave] = useState<SaveState>({ phase: 'idle' });
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [picker, setPicker] = useState<'page' | 'episode' | 'library' | null>(null);
  const [quota, setQuota] = useState<{ usedBytes: number; quotaBytes: number; maxFileBytes: number } | null>(null);
  const [vocabulary, setVocabulary] = useState<{ tag: string; label: string }[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  const targetSlug = isNew ? newSlug : slug;

  // The context as of this render, reachable from an effect that must not re-run when it is replaced.
  // The host hands a new `ctx` object on a login, a theme change and any render of its own, and the load
  // below writes straight into the fields the author is typing in.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // --- load the page being edited ------------------------------------------------------------------
  // Keyed on the *page*, not on the context. Re-running this because the host rebuilt its context object
  // would call `setMarkdown` with what is stored and throw away everything typed since — the editor is the
  // one view where refetching is not a harmless revalidation. A genuine move to another page changes
  // `slug` and does re-run it.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (isNew || !ctx.schema) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    ctx.schema
      .select<PageRow>('page', { where: [{ field: 'slug', op: 'eq', value: slug }], size: 1 })
      .then((page) => {
        if (cancelled) {
          return;
        }
        const row = page.items[0];
        if (!row) {
          setNotFound(true);
        } else {
          setTitle(row.title ?? '');
          setSummary(row.summary ?? '');
          setTags((row.tags ?? '').split(',').filter(Boolean).join(', '));
          setMarkdown(row.markdown ?? '');
          setBaseRevisionNo(row.revisionNo ?? null);
          setLocale(row.locale ?? '');
          setTranslationOf(row.translationOf ?? '');
        }
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          ctx.log('warn', `wiki: editor could not load '${slug}': ${String(error)}`);
          setNotFound(true);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ctx` is read through `ctxRef` on purpose
  }, [slug, isNew]);

  // Read the effective quota before anyone picks a file: an admin's grant replaces the manifest's ask, so
  // this is the only honest source for what this install actually allows. Telling someone the ceiling
  // beats refusing them after the upload.
  useEffect(() => {
    let cancelled = false;
    ctx.blobs
      ?.quota()
      .then((q) => !cancelled && setQuota(q))
      // Deliberately swallowed, and narrow: a missing quota costs the hint above the file picker
      // and nothing else. The upload itself still reports its own refusal.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  // The site's shared vocabulary (§6.1.1), offered as suggestions. Before SDK 0.9 this was a free-text
  // box over a private column, which is how a site ends up with `lore`, `Lore` and `lore ` as three tags.
  // `ctx.tags` is null unless the manifest declares the block.
  useEffect(() => {
    let cancelled = false;
    ctx.tags
      ?.all()
      .then((all) => !cancelled && setVocabulary(all.map((t) => ({ tag: t.tag, label: t.label }))))
      // Swallowed narrowly: without suggestions the field is still a working text input.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  // A translation the author asked to open as a new page. Read rather than consumed: navigating re-hands
  // `ctx`, which re-runs the index fetch, which unmounts this editor and mounts a fresh one -- a
  // clear-on-read hand-off is swallowed by the mount that is thrown away. `WikiPage` clears it when the
  // route leaves `_new`. Nothing machine-written was ever stored to get here.
  useEffect(() => {
    if (!isNew) {
      return;
    }
    const parked = peekTranslation();
    if (!parked) {
      return;
    }
    setTitle(parked.title);
    setSummary(parked.summary);
    setMarkdown(parked.markdown);
    setLocale(parked.locale);
    setTranslationOf(parked.translationOf);
    setSlugTouched(true);
    setNewSlug(parked.slug);
  }, [isNew]);

  // A new page on a multilingual site starts in the site's default language rather than unstated: an
  // unstated page reads as the default anyway, and leaving the picker empty is how a wiki ends up with the
  // field on every page and a value on none. Runs once per mount, so the author can still pick anything.
  useEffect(() => {
    if (isNew && isMultilingual(ctx)) {
      setLocale((current) => current || defaultContentLocale(ctx) || '');
    }
  }, [ctx, isNew]);

  useEffect(() => () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
    }
  }, []);

  const preview = useMemo(
    () =>
      renderPage(markdown, {
        hasPage: (target) => Object.prototype.hasOwnProperty.call(index, target),
        episodeHref: (episode, seconds) => ctx.links.episode(episode, seconds == null ? undefined : { t: seconds }),
        blobUrl: ctx.blobs ? (ref) => ctx.blobs!.urlFor(ref) : undefined,
        sanitize: ctx.sanitize,
      }),
    [ctx, markdown, index],
  );

  // The image the caret is in, if any. **A textarea has no image to right-click** — it has text — so the
  // affordance that does work is acting on the token the caret is already inside. Tracked on every
  // interaction with the body rather than polled, so the button appears the moment the caret lands in one.
  const [caretImage, setCaretImage] = useState<ReturnType<typeof imageTokenAt>>(null);
  // The width box keeps what was typed, not what was parsed. Feeding the parsed value back would turn "32"
  // into "32px" between two keystrokes and the next character would land after the unit.
  const [caretWidthText, setCaretWidthText] = useState('');
  const caretImageStart = useRef<number | null>(null);

  const trackCaret = useCallback(() => {
    const area = bodyRef.current;
    const found = area ? imageTokenAt(area.value, area.selectionStart ?? 0) : null;
    setCaretImage(found);
    // Reload the box only when the caret moved to a *different* image, or it would overwrite what is
    // being typed into it on every keystroke.
    if ((found?.start ?? null) !== caretImageStart.current) {
      caretImageStart.current = found?.start ?? null;
      setCaretWidthText(found?.width ?? '');
    }
  }, []);

  /** Rewrites the image under the caret with new options, leaving its alt text and target alone. */
  const applyToCaretImage = (next: { width: string | null; align: '' | 'left' | 'center' | 'right' }) => {
    const area = bodyRef.current;
    if (!area || !caretImage) {
      return;
    }
    const replacement = formatImage({
      alt: caretImage.alt,
      target: caretImage.target,
      width: next.width,
      align: next.align || null,
    });
    const value = area.value.slice(0, caretImage.start) + replacement + area.value.slice(caretImage.end);
    setMarkdown(value);
    // The token's new span is known right here, so record it **synchronously**. Deriving it inside the
    // rAF below made the next edit slice against a stale `end` and append a second attribute block
    // instead of replacing the first — and typing a width is several edits in a row. rAF is also
    // throttled in a backgrounded tab, which makes it the wrong place for anything correctness needs.
    setCaretImage({
      ...caretImage,
      end: caretImage.start + replacement.length,
      width: next.width,
      align: next.align || null,
    });
    // Cosmetic, and only cosmetic: put the caret back inside the token so the box stays open under the
    // hand using it. `caretImageStart` is left alone — it is still the same image.
    requestAnimationFrame(() => {
      area.focus();
      area.selectionStart = area.selectionEnd = caretImage.start + replacement.length;
    });
  };

  /**
   * Keeps the preview beside the body: the same height, and scrolled to the same place.
   *
   * Two halves. The **height** is mirrored because the textarea is user-resizable — a fixed height in CSS
   * gives them the same height until someone drags the handle, and then they never match again. The
   * **scroll** is proportional rather than caret-anchored: mapping a caret offset to the element it became
   * would mean the renderer handing back a source map, and a ratio is right wherever the two halves have
   * roughly the same shape, which for a wiki page they do. The browser scrolls the textarea to follow the
   * caret on its own, so typing near the bottom pulls the preview along without a keystroke listener.
   *
   * One direction only, editor to preview. Syncing both ways means each one's programmatic scroll wakes
   * the other's handler, and the two fight over the last pixel.
   */
  useEffect(() => {
    const area = bodyRef.current;
    const pane = previewRef.current;
    if (!area || !pane) {
      return;
    }
    const syncScroll = () => {
      const room = area.scrollHeight - area.clientHeight;
      const previewRoom = pane.scrollHeight - pane.clientHeight;
      // Nothing to scroll on either side is the normal state of a short page, not an error.
      if (room <= 0 || previewRoom <= 0) {
        return;
      }
      pane.scrollTop = (area.scrollTop / room) * previewRoom;
    };
    const mirrorHeight = () => {
      pane.style.height = `${area.getBoundingClientRect().height}px`;
    };
    area.addEventListener('scroll', syncScroll, { passive: true });
    // Guarded rather than assumed: every browser this ships to has it, but a missing global thrown from a
    // render is what the host's error boundary turns into a blank tile, and the editor still works without
    // the mirror -- the two panes simply stop matching after a manual resize.
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(mirrorHeight) : null;
    resize?.observe(area);
    return () => {
      area.removeEventListener('scroll', syncScroll);
      resize?.disconnect();
    };
  }, [loaded]);

  /** Inserts text at the caret, so an upload lands where the author was typing. */
  const insertAtCaret = useCallback((snippet: string) => {
    const area = bodyRef.current;
    if (!area) {
      setMarkdown((current) => `${current}\n${snippet}\n`);
      return;
    }
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    setMarkdown((current) => `${current.slice(0, start)}${snippet}${current.slice(end)}`);
    requestAnimationFrame(() => {
      area.focus();
      area.selectionStart = area.selectionEnd = start + snippet.length;
    });
  }, []);

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be picked again after a refusal
    if (!file || !ctx.blobs) {
      return;
    }
    setUpload({ busy: true, error: null });
    try {
      const stored = await ctx.blobs.upload(file);
      const name = file.name.replace(/[[\]]/g, '').replace(/\.[^.]+$/, '');
      // The ref is the identity; the URL is derived at render time. Writing a URL into the body would be
      // a copy of a decision the host is entitled to change.
      insertAtCaret(`![${name}](blob:${stored.ref})`);
      // File it in the library on the way past, so the same picture never has to be uploaded twice. This
      // is also what keeps it alive: the backend's sweep counts a ref named here as referenced, so a file
      // uploaded and not yet placed survives the grace period.
      await ctx.docs
        .put('site', assetKey(stored.ref), {
          name,
          mime: stored.mime,
          addedBy: ctx.user?.id ?? null,
          at: new Date().toISOString(),
        } satisfies AssetDoc)
        // Narrow on purpose: the image is already uploaded and already in the body. Losing the library
        // entry costs findability later, and must not be reported as a failed upload now.
        .catch((error: unknown) => ctx.log('warn', `wiki: file not added to the library: ${describeApiError(error)}`));
      setUpload({ busy: false, error: null });
      ctx.blobs.quota().then(setQuota).catch(() => undefined);
    } catch (error: unknown) {
      // The person who picked the file is the only one who can pick a different one, so the refusal has
      // to reach them, and 413 and 415 are worded apart because the fixes differ: send a smaller file,
      // versus send a different kind of file. Since SDK 0.9 the status is on the error rather than
      // something to find in its message.
      const status = isPluginApiError(error) ? error.status : 0;
      const key =
        status === 413 ? 'editor.uploadTooBig' : status === 415 ? 'editor.uploadWrongType' : 'editor.uploadFailed';
      setUpload({ busy: false, error: i18n.t(key) });
      ctx.log('warn', `wiki: upload refused: ${describeApiError(error)}`);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const slugToWrite = (isNew ? (slugTouched ? toSlug(newSlug) : toSlug(title)) : slug) ?? '';
    if (!slugToWrite) {
      setSave({ phase: 'rejected', detail: i18n.t('editor.needsTitle') });
      return;
    }
    if (isNew && Object.prototype.hasOwnProperty.call(index, slugToWrite)) {
      setSave({ phase: 'rejected', detail: i18n.t('editor.slugTaken', { slug: slugToWrite }) });
      return;
    }

    setSave({ phase: 'queued' });
    try {
      await ctx.docs.put('site', draftKey(slugToWrite), {
        title: title.trim(),
        summary: summary.trim(),
        markdown,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        comment: comment.trim(),
        author: ctx.user?.id ?? null,
        status: 'published',
        baseRevisionNo,
        locale: locale || null,
        translationOf: translationOf || null,
      });
    } catch (error: unknown) {
      ctx.log('warn', `wiki: draft could not be written: ${String(error)}`);
      setSave({ phase: 'failed' });
      return;
    }
    pollReceipt(slugToWrite);
  };

  /** Watches the receipt the backend leaves for this slug, which is how a queued save resolves. */
  const pollReceipt = (slugToWatch: string) => {
    const started = Date.now();
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
    }
    pollRef.current = window.setInterval(async () => {
      let receipt: IngestReceipt | null = null;
      try {
        // `ctx.api`, not `ctx.docs`, on purpose: the docs client remembers a miss for 30 s, and "no receipt
        // yet" is exactly the answer this loop asks again every few seconds until it changes. Through the
        // cache, a save would look queued for up to one extra ingest period after it landed.
        receipt = (await ctx.api.get<IngestReceipt>(`${SITE_PATH}/ingest:${slugToWatch}`)) ?? null;
      } catch {
        receipt = null; // no receipt yet is the normal state right after a save
      }
      const fresh = receipt && (!baseRevisionNo || (receipt.revisionNo ?? 0) > baseRevisionNo || receipt.state !== 'ok');
      if (receipt && fresh) {
        window.clearInterval(pollRef.current!);
        pollRef.current = null;
        if (receipt.state === 'ok') {
          setSave({ phase: 'saved', revisionNo: receipt.revisionNo ?? null });
          setBaseRevisionNo(receipt.revisionNo ?? baseRevisionNo);
        } else if (receipt.state === 'conflict') {
          setSave({ phase: 'conflict', detail: receipt.detail });
        } else {
          setSave({ phase: 'rejected', detail: receipt.detail });
        }
        return;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        window.clearInterval(pollRef.current!);
        pollRef.current = null;
        setSave({ phase: 'timeout' });
      }
    }, POLL_MS);
  };

  /**
   * Asks the host to translate this page, and shows the answer without saving any of it.
   *
   * `ctx.translation` is read here rather than held: it is `null` unless the manifest declared the kind
   * *and* the operator configured a provider, and the operator half can change while this page is open.
   */
  const onTranslate = async () => {
    const client = ctx.translation;
    if (!client || !target) {
      return;
    }
    setTranslation({ busy: true, draft: null, error: null });
    try {
      const draft = await translatePage(
        client,
        { title, summary, markdown, from: locale || null },
        target,
      );
      setTranslation({ busy: false, draft, error: null });
    } catch (error: unknown) {
      // Shown, never swallowed into the untranslated original: a reader who cannot tell a translation
      // from an original is worse off than one who sees an error.
      ctx.log('warn', `wiki: translation refused: ${describeApiError(error)}`);
      setTranslation({
        busy: false,
        draft: null,
        error: isPluginApiError(error) && error.status === 403
          ? i18n.t('editor.translateForbidden')
          : i18n.t('editor.translateFailed'),
      });
    }
  };

  /** Opens the machine draft as a new page, prefilled. Nothing is written until the author saves. */
  const onOpenTranslation = () => {
    const draft = translation.draft;
    if (!draft || !slug) {
      return;
    }
    stashTranslation({
      slug: `${slug}-${draft.target}`,
      title: draft.title,
      summary: draft.summary,
      markdown: draft.markdown,
      locale: draft.target,
      // A translation of a translation belongs to the same original: the backend collapses it anyway.
      translationOf: translationOf || slug,
    });
    ctx.route.navigate(routePath({ view: 'new' }));
  };

  const onDelete = async () => {
    if (isNew || !slug) {
      return;
    }
    setSave({ phase: 'queued' });
    try {
      // A tombstone, not a delete: the cascade across four entities is the backend's to run.
      await ctx.docs.put('site', deleteKey(slug), { requestedBy: ctx.user?.id ?? null });
      pollReceipt(slug);
    } catch (error: unknown) {
      ctx.log('warn', `wiki: delete could not be requested: ${String(error)}`);
      setSave({ phase: 'failed' });
    }
  };

  if (!loaded) {
    return <p className="wiki__meta">{i18n.t('loading')}</p>;
  }
  if (notFound) {
    return (
      <div className="wiki__empty">
        <p>{i18n.t('page.notFound')}</p>
      </div>
    );
  }

  const savedSlug = isNew ? (slugTouched ? toSlug(newSlug) : toSlug(title)) : slug;

  // Language controls exist only where they mean something. On a site with one content language a picker
  // has one option and a "translation of" box can never be answered, so neither is rendered at all.
  const contentLocales = ctx.locale.content();
  const multilingual = isMultilingual(ctx);
  // Everything this page could be a translation of: any published page that is not this one and is not
  // itself a translation. The backend collapses a chain anyway, but offering one would be misleading.
  const originals = Object.entries(index)
    .filter(([candidate, summary]) => candidate !== savedSlug && !summary.translationOf)
    .sort(([, a], [, b]) => a.title.localeCompare(b.title));
  // The backend refuses a second page in one language per group; saying so here means the author learns
  // before the tick rather than from a rejection receipt a few seconds later.
  const languageTaken =
    translationOf && locale
      ? Object.entries(index).find(
          ([candidate, summary]) =>
            candidate !== savedSlug &&
            summary.locale === locale &&
            (candidate === translationOf || summary.translationOf === translationOf),
        )?.[0] ?? null
      : null;

  return (
    <form onSubmit={onSubmit}>
      <h1 className="wiki__title">{isNew ? i18n.t('editor.newTitle') : i18n.t('editor.editTitle', { title })}</h1>

      <div className="wiki__field">
        <label htmlFor="wiki-title">{i18n.t('editor.title')}</label>
        <input
          id="wiki-title"
          className="wiki__input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </div>

      {isNew && (
        <div className="wiki__field">
          <label htmlFor="wiki-slug">{i18n.t('editor.slug')}</label>
          <input
            id="wiki-slug"
            className="wiki__input"
            value={slugTouched ? newSlug : toSlug(title)}
            onChange={(event) => {
              setSlugTouched(true);
              setNewSlug(event.target.value);
            }}
          />
          <p className="wiki__hint">{i18n.t('editor.slugHint', { url: `/p/wiki/${toSlug(savedSlug ?? '')}` })}</p>
        </div>
      )}

      <div className="wiki__field">
        <label htmlFor="wiki-summary">{i18n.t('editor.summary')}</label>
        <input
          id="wiki-summary"
          className="wiki__input"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder={i18n.t('editor.summaryHint')}
        />
      </div>

      <div className="wiki__field">
        <label htmlFor="wiki-tags">{i18n.t('editor.tags')}</label>
        <input
          id="wiki-tags"
          className="wiki__input"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="lore, sea"
          list={vocabulary.length > 0 ? 'wiki-tag-vocabulary' : undefined}
        />
        {vocabulary.length > 0 && (
          <datalist id="wiki-tag-vocabulary">
            {vocabulary.map((entry) => (
              <option key={entry.tag} value={entry.label} />
            ))}
          </datalist>
        )}
        <p className="wiki__hint">{i18n.t('editor.tagsHint')}</p>
      </div>

      {multilingual && (
        <div className="wiki__row">
          <div className="wiki__field">
            <label htmlFor="wiki-locale">{i18n.t('editor.language')}</label>
            <select
              id="wiki-locale"
              className="wiki__input"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              {/* Unstated is a real answer, not a placeholder: it means "the site default", which is what
                  every page written before this field existed says. */}
              <option value="">{i18n.t('editor.languageUnstated')}</option>
              {contentLocales.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.nativeName}
                </option>
              ))}
            </select>
            <p className="wiki__hint">{i18n.t('editor.languageHint')}</p>
          </div>

          <div className="wiki__field">
            <label htmlFor="wiki-translation-of">{i18n.t('editor.translationOf')}</label>
            <select
              id="wiki-translation-of"
              className="wiki__input"
              value={translationOf}
              onChange={(event) => setTranslationOf(event.target.value)}
            >
              <option value="">{i18n.t('editor.translationOfNone')}</option>
              {originals.map(([candidate, summary]) => (
                <option key={candidate} value={candidate}>
                  {summary.title}
                  {summary.locale ? ` (${localeName(ctx, summary.locale)})` : ''}
                </option>
              ))}
            </select>
            {languageTaken ? (
              <p className="wiki__error">
                {i18n.t('editor.translationTaken', { slug: languageTaken })}
              </p>
            ) : (
              <p className="wiki__hint">{i18n.t('editor.translationOfHint')}</p>
            )}
          </div>
        </div>
      )}

      {multilingual && !isNew && (
        <div className="wiki__field">
          <span className="wiki__label">{i18n.t('editor.translate')}</span>
          <div className="wiki__translate">
            <select
              id="wiki-translate-target"
              className="wiki__input"
              aria-label={i18n.t('editor.translateInto')}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">{i18n.t('editor.translateInto')}</option>
              {contentLocales
                .filter((entry) => entry.code !== locale)
                .map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.nativeName}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="wiki__btn wiki__btn--ghost"
              onClick={onTranslate}
              // Disabled on the handle, not on a click that would 403 or 409: the host refuses a call
              // below `external.usedBy`, and `available()` is the provider half of the same question.
              disabled={!ctx.translation?.available() || !target || translation.busy}
            >
              <Icon name="translate" />
              {translation.busy ? i18n.t('editor.translating') : i18n.t('editor.translate')}
            </button>
          </div>
          {!ctx.translation && <p className="wiki__hint">{i18n.t('editor.translateUnavailable')}</p>}
          {translation.error && <p className="wiki__error">{translation.error}</p>}

          {translation.draft && (
            <div className="wiki__machine">
              <p className="wiki__hint">
                <Icon name="warning" />
                {i18n.t('editor.translateDraft')}
              </p>
              <h3 lang={translation.draft.target}>{translation.draft.title}</h3>
              <pre className="wiki__machinebody" lang={translation.draft.target}>
                {translation.draft.markdown}
              </pre>
              {translation.draft.kept > 0 && (
                <p className="wiki__hint">
                  {i18n.t('editor.translateKept', {
                    kept: String(translation.draft.kept),
                    total: String(translation.draft.total),
                  })}
                </p>
              )}
              <p className="wiki__hint">{i18n.t('editor.translateSourcesHint')}</p>
              <div className="wiki__actions">
                <button type="button" className="wiki__btn" onClick={onOpenTranslation}>
                  {i18n.t('editor.translateOpen')}
                </button>
                <button
                  type="button"
                  className="wiki__btn wiki__btn--ghost"
                  onClick={() => setTranslation({ busy: false, draft: null, error: null })}
                >
                  {i18n.t('editor.translateDiscard')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="wiki__editor">
        <div className="wiki__field">
          <label htmlFor="wiki-body">{i18n.t('editor.body')}</label>
          <textarea
            id="wiki-body"
            ref={bodyRef}
            className="wiki__area"
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value);
              trackCaret();
            }}
            onKeyUp={trackCaret}
            onClick={trackCaret}
            onSelect={trackCaret}
            rows={20}
            spellCheck
          />
          <p className="wiki__hint">{i18n.t('editor.syntaxHint')}</p>

          <div className="wiki__upload">
            {/* Buttons rather than syntax to memorise: a page slug is guessable, an episode slug is not. */}
            <button
              type="button"
              className="wiki__btn wiki__btn--ghost"
              onClick={() => setPicker(picker === 'page' ? null : 'page')}
            >
              <Icon name="link" />
              {i18n.t('editor.insertPage')}
            </button>
            <button
              type="button"
              className="wiki__btn wiki__btn--ghost"
              onClick={() => setPicker(picker === 'episode' ? null : 'episode')}
            >
              <Icon name="music" />
              {i18n.t('editor.insertEpisode')}
            </button>
            {ctx.blobs && (
              <button
                type="button"
                className="wiki__btn wiki__btn--ghost"
                onClick={() => setPicker(picker === 'library' ? null : 'library')}
              >
                <Icon name="image" />
                {i18n.t('editor.insertLibrary')}
              </button>
            )}
            {ctx.blobs && (
              <label className="wiki__btn wiki__btn--ghost">
                <Icon name="upload" />
                {upload.busy ? i18n.t('editor.uploading') : i18n.t('editor.addImage')}
                <input type="file" accept="image/*" hidden onChange={onPickFile} disabled={upload.busy} />
              </label>
            )}
          </div>

          {caretImage && (
            <div className="wiki__caretimg">
              <p className="wiki__hint">{i18n.t('editor.image.atCaret', { alt: caretImage.alt || '—' })}</p>
              <ImageOptions
                i18n={i18n}
                width={caretWidthText}
                align={caretImage.align ?? ''}
                onWidth={(value) => {
                  setCaretWidthText(value);
                  const parsed = value.trim() === '' ? null : parseImageAttrs(`width=${value.trim()}`).width;
                  // A half-typed width ("32" on the way to "320") parses; nonsense does not, and rewriting
                  // the token with it would silently drop the width the author is still typing.
                  if (value.trim() === '' || parsed !== null) {
                    applyToCaretImage({ width: parsed, align: caretImage.align ?? '' });
                  }
                }}
                onAlign={(value) =>
                  applyToCaretImage({
                    width: caretWidthText.trim() === ''
                      ? null
                      : parseImageAttrs(`width=${caretWidthText.trim()}`).width,
                    align: value,
                  })
                }
              />
            </div>
          )}

          {picker && (
            <InsertPicker
              kind={picker}
              ctx={ctx}
              i18n={i18n}
              index={index}
              onInsert={(snippet) => {
                insertAtCaret(snippet);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
            />
          )}

          {quota && (
            <p className="wiki__hint">
              {i18n.t('editor.quota', {
                used: i18n.bytes(quota.usedBytes),
                total: i18n.bytes(quota.quotaBytes),
                max: i18n.bytes(quota.maxFileBytes),
              })}
            </p>
          )}
          {upload.error && <p className="wiki__error">{upload.error}</p>}
        </div>

        <div className="wiki__field">
          <span className="wiki__label">{i18n.t('editor.preview')}</span>
          {/* Sanitised in renderPage, exactly as the reader does it — a preview must not be the one place
              author markup reaches the DOM unfiltered. */}
          <div
            ref={previewRef}
            className="wiki__body wiki__preview"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      </div>

      <div className="wiki__field">
        <label htmlFor="wiki-comment">{i18n.t('editor.comment')}</label>
        <input
          id="wiki-comment"
          className="wiki__input"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={i18n.t('editor.commentHint')}
        />
      </div>

      <SaveStatus i18n={i18n} state={save} slug={savedSlug ?? ''} go={go} />

      <div className="wiki__actions">
        <button className="wiki__btn" type="submit" disabled={save.phase === 'queued'}>
          <Icon name="save" />
          {save.phase === 'queued' ? i18n.t('editor.saving') : i18n.t('editor.save')}
        </button>
        {!isNew && slug && (
          <a className="wiki__btn wiki__btn--ghost" href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
            {i18n.t('editor.cancel')}
          </a>
        )}
        {!isNew && slug && (
          <button
            className="wiki__btn wiki__btn--danger"
            type="button"
            onClick={() => {
              if (window.confirm(i18n.t('editor.confirmDelete', { title }))) {
                void onDelete();
              }
            }}
          >
            <Icon name="delete" />
            {i18n.t('editor.delete')}
          </button>
        )}
      </div>
    </form>
  );
}

/** The one place the eventual-consistency gap is spoken about, rather than papered over. */
function SaveStatus({
  i18n,
  state,
  slug,
  go,
}: {
  i18n: PluginI18n;
  state: SaveState;
  slug: string;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}) {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'queued':
      return (
        <p className="wiki__status" role="status">
          <Icon name="clock" />
          {i18n.t('editor.queued')}
        </p>
      );
    case 'saved':
      return (
        <p className="wiki__status wiki__status--ok" role="status">
          <Icon name="check" />
          {i18n.t('editor.saved')}{' '}
          <a href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
            {i18n.t('editor.viewPage')}
          </a>
        </p>
      );
    case 'conflict':
      return (
        <p className="wiki__error" role="alert">
          <Icon name="warning" />
          {i18n.t('editor.conflict')} {state.detail}
        </p>
      );
    case 'rejected':
      return (
        <p className="wiki__error" role="alert">
          <Icon name="warning" />
          {i18n.t('editor.rejected')} {state.detail}
        </p>
      );
    case 'timeout':
      return (
        <p className="wiki__error" role="alert">
          <Icon name="warning" />
          {i18n.t('editor.timeout')}
        </p>
      );
    case 'failed':
      return (
        <p className="wiki__error" role="alert">
          <Icon name="warning" />
          {i18n.t('editor.failed')}
        </p>
      );
  }
}

/**
 * Size and placement for an image, without anyone having to know the syntax.
 *
 * The defaults are the behaviour you get by writing nothing — full column width, no float — so leaving the
 * box alone produces exactly the token the plugin produced before this existed.
 */
function ImageOptions({
  i18n,
  width,
  align,
  onWidth,
  onAlign,
}: {
  i18n: PluginI18n;
  width: string;
  align: '' | 'left' | 'center' | 'right';
  onWidth(value: string): void;
  onAlign(value: '' | 'left' | 'center' | 'right'): void;
}) {
  // Shown as you type rather than on submit: the field is three characters long and a wrong one silently
  // producing a full-width image is the confusion this whole control exists to remove.
  const bad = width.trim() !== '' && parseImageAttrs(`width=${width.trim()}`).width === null;

  return (
    <div className="wiki__imgopts">
      <label>
        {i18n.t('editor.image.width')}
        <input
          className="wiki__input"
          value={width}
          placeholder={i18n.t('editor.image.widthHint')}
          onChange={(event) => onWidth(event.target.value)}
        />
      </label>
      <label>
        {i18n.t('editor.image.align')}
        <select
          className="wiki__input"
          value={align}
          onChange={(event) => onAlign(event.target.value as '' | 'left' | 'center' | 'right')}
        >
          <option value="">{i18n.t('editor.image.alignDefault')}</option>
          <option value="left">{i18n.t('editor.image.alignLeft')}</option>
          <option value="center">{i18n.t('editor.image.alignCenter')}</option>
          <option value="right">{i18n.t('editor.image.alignRight')}</option>
        </select>
      </label>
      {bad && <p className="wiki__error">{i18n.t('editor.image.badWidth')}</p>}
    </div>
  );
}

/**
 * The insert pickers: a page, an episode, or a file already in the library.
 *
 * **A slug is not something to know by heart.** `[[the-kraken]]` and `[[episode:s01e02@12:04]]` are terse to
 * read and unguessable to write — an author has to remember an episode's slug, and there is no reason they
 * would. The host hands over `ctx.episodes` (access-filtered) and `ctx.episodeLabels`, and the SDK says in
 * as many words to use them in pickers so people see titles; the page list is the `index` projection the
 * editor already holds.
 */
function InsertPicker({
  kind,
  ctx,
  i18n,
  index,
  onInsert,
  onClose,
}: {
  kind: 'page' | 'episode' | 'library';
  ctx: PluginContext;
  i18n: PluginI18n;
  index: Record<string, PageSummary>;
  onInsert(snippet: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [stamp, setStamp] = useState('');
  const [width, setWidth] = useState('');
  const [align, setAlign] = useState<'' | 'left' | 'center' | 'right'>('');
  const [library, setLibrary] = useState<{ ref: string; name: string; mime: string }[]>([]);

  useEffect(() => {
    if (kind !== 'library') {
      return;
    }
    let cancelled = false;
    ctx.docs
      .list<AssetDoc>('site', { prefix: ASSET_PREFIX, size: 100 })
      .then((page) => {
        if (!cancelled) {
          setLibrary(
            page.items.map((entry) => ({
              ref: entry.key.slice(ASSET_PREFIX.length),
              name: entry.value?.name ?? entry.key.slice(ASSET_PREFIX.length),
              mime: entry.value?.mime ?? '',
            })),
          );
        }
      })
      // Swallowed narrowly: an empty library still leaves upload working, which is the way in anyway.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx, kind]);

  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

  // `parseTimestamp` is the shared `?t=` grammar, not a fifth implementation of it. An unreadable value is
  // dropped rather than guessed, which is why the field says so instead of refusing to submit.
  const seconds = stamp.trim() ? parseTimestamp(stamp.trim()) : undefined;
  const stampBad = stamp.trim() !== '' && seconds === undefined;

  const pages = Object.entries(index)
    .filter(([slug, summary]) => matches(summary.title || slug) || matches(slug))
    .sort(([, a], [, b]) => (a.title || '').localeCompare(b.title || ''))
    .slice(0, PICKER_LIMIT);

  const episodes = ctx.episodes
    .map((slug) => ({ slug, label: ctx.episodeLabels?.[slug] ?? slug }))
    .filter((episode) => matches(episode.label) || matches(episode.slug))
    .slice(0, PICKER_LIMIT);

  const files = library.filter((file) => matches(file.name)).slice(0, PICKER_LIMIT);

  return (
    <div className="wiki__picker">
      <div className="wiki__pickerbar">
        <input
          className="wiki__input"
          type="search"
          autoFocus
          value={query}
          placeholder={i18n.t(`editor.pick.${kind}`)}
          aria-label={i18n.t(`editor.pick.${kind}`)}
          onChange={(event) => setQuery(event.target.value)}
        />
        {kind === 'episode' && (
          <input
            className="wiki__input wiki__stamp"
            value={stamp}
            placeholder={i18n.t('editor.pick.at')}
            aria-label={i18n.t('editor.pick.at')}
            onChange={(event) => setStamp(event.target.value)}
          />
        )}
        <button type="button" className="wiki__btn wiki__btn--ghost" onClick={onClose}>
          {i18n.t('editor.pick.close')}
        </button>
      </div>
      {stampBad && <p className="wiki__error">{i18n.t('editor.pick.badStamp')}</p>}
      {kind === 'library' && (
        <ImageOptions i18n={i18n} width={width} align={align} onWidth={setWidth} onAlign={setAlign} />
      )}

      <ul className="wiki__pickerlist">
        {kind === 'page' &&
          pages.map(([slug, summary]) => (
            <li key={slug}>
              <button type="button" onClick={() => onInsert(`[[${slug}|${summary.title || slug}]]`)}>
                <span>{summary.title || slug}</span>
                <code>{slug}</code>
              </button>
            </li>
          ))}

        {kind === 'episode' &&
          episodes.map((episode) => (
            <li key={episode.slug}>
              <button
                type="button"
                onClick={() =>
                  onInsert(
                    `[[episode:${episode.slug}${seconds === undefined ? '' : `@${formatTimestamp(seconds)}`}|${episode.label}]]`,
                  )
                }
              >
                <span>{episode.label}</span>
                <code>{episode.slug}</code>
              </button>
            </li>
          ))}

        {kind === 'library' &&
          files.map((file) => (
            <li key={file.ref}>
              <button
                type="button"
                onClick={() =>
                  onInsert(
                    formatImage({
                      alt: file.name,
                      target: `blob:${file.ref}`,
                      width: parseImageAttrs(`width=${width.trim()}`).width,
                      align: align || null,
                    }),
                  )
                }
              >
                {ctx.blobs && file.mime.startsWith('image/') && (
                  <img className="wiki__thumb" src={ctx.blobs.urlFor(file.ref)} alt="" />
                )}
                <span>{file.name}</span>
              </button>
            </li>
          ))}
      </ul>

      {((kind === 'page' && pages.length === 0) ||
        (kind === 'episode' && episodes.length === 0) ||
        (kind === 'library' && files.length === 0)) && (
        <p className="wiki__hint">{i18n.t(`editor.pick.none.${kind}`)}</p>
      )}
    </div>
  );
}
