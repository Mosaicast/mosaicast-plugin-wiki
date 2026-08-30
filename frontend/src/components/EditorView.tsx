// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import { renderPage } from '../markdown';
import { routeHref, routePath, toSlug, type WikiRoute } from '../routes';
import { deleteKey, draftKey, SITE_PATH, type IngestReceipt, type PageRow, type PageSummary } from '../types';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { describeApiError } from './useDoc';

/** How often to re-read the ingest receipt while a save is queued. */
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

  const [save, setSave] = useState<SaveState>({ phase: 'idle' });
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [quota, setQuota] = useState<{ usedBytes: number; quotaBytes: number; maxFileBytes: number } | null>(null);
  const [vocabulary, setVocabulary] = useState<{ tag: string; label: string }[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<number | null>(null);

  const targetSlug = isNew ? newSlug : slug;

  // --- load the page being edited ------------------------------------------------------------------
  useEffect(() => {
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
  }, [ctx, slug, isNew]);

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
      }),
    [ctx, markdown, index],
  );

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
      // The ref is the identity; the URL is derived at render time. Writing a URL into the body would be
      // a copy of a decision the host is entitled to change.
      insertAtCaret(`![${file.name.replace(/[[\]]/g, '')}](blob:${stored.ref})`);
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
      await ctx.api.put(`${SITE_PATH}/${draftKey(slugToWrite)}`, {
        title: title.trim(),
        summary: summary.trim(),
        markdown,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        comment: comment.trim(),
        author: ctx.user?.id ?? null,
        status: 'published',
        baseRevisionNo,
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
        receipt = await ctx.api.get<IngestReceipt>(`${SITE_PATH}/ingest:${slugToWatch}`);
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

  const onDelete = async () => {
    if (isNew || !slug) {
      return;
    }
    setSave({ phase: 'queued' });
    try {
      // A tombstone, not a delete: the cascade across four entities is the backend's to run.
      await ctx.api.put(`${SITE_PATH}/${deleteKey(slug)}`, { requestedBy: ctx.user?.id ?? null });
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

      <div className="wiki__editor">
        <div className="wiki__field">
          <label htmlFor="wiki-body">{i18n.t('editor.body')}</label>
          <textarea
            id="wiki-body"
            ref={bodyRef}
            className="wiki__area"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            rows={20}
            spellCheck
          />
          <p className="wiki__hint">{i18n.t('editor.syntaxHint')}</p>

          {ctx.blobs && (
            <div className="wiki__upload">
              <label className="wiki__btn wiki__btn--ghost">
                <Icon name="upload" />
                {upload.busy ? i18n.t('editor.uploading') : i18n.t('editor.addImage')}
                <input type="file" accept="image/*" hidden onChange={onPickFile} disabled={upload.busy} />
              </label>
              {quota && (
                <span className="wiki__hint">
                  {i18n.t('editor.quota', {
                    used: i18n.bytes(quota.usedBytes),
                    total: i18n.bytes(quota.quotaBytes),
                    max: i18n.bytes(quota.maxFileBytes),
                  })}
                </span>
              )}
              {upload.error && <p className="wiki__error">{upload.error}</p>}
            </div>
          )}
        </div>

        <div className="wiki__field">
          <span className="wiki__label">{i18n.t('editor.preview')}</span>
          {/* Sanitised in renderPage, exactly as the reader does it — a preview must not be the one place
              author markup reaches the DOM unfiltered. */}
          <div className="wiki__body wiki__preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
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
