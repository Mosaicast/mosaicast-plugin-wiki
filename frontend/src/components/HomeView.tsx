// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { renderPage } from '../markdown';
import { routeHref, routePath, type WikiRoute } from '../routes';
import { KEY_HOME, type HomePage, type PageSummary } from '../types';
import { useSiteDoc } from './useDoc';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';

/** How many pages the front page lists as recently updated before it stops being a front page. */
const RECENT_LIMIT = 6;

interface HomeViewProps {
  ctx: PluginContext;
  i18n: PluginI18n;
  index: Record<string, PageSummary>;
  mayEdit: boolean;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}

/**
 * The wiki's front page: what a podcaster wrote, then what the wiki can work out for itself.
 *
 * **The written part is an ordinary wiki page**, addressed by the `homePageSlug` config. That is the whole
 * design: it gets the editor, revisions, history, search and backlinks for nothing, instead of being a
 * second kind of content with its own editing, its own storage and its own bugs. A podcaster who wants to
 * change the front page edits a page.
 *
 * Everything below it is generated, so a wiki with no front page written yet still has a usable one — the
 * state every new install starts in, which has to look deliberate rather than broken.
 */
export function HomeView({ ctx, i18n, index, mayEdit, go }: HomeViewProps) {
  const home = useSiteDoc<HomePage>(ctx, KEY_HOME);
  const entries = Object.entries(index);

  const intro = useMemo(() => {
    if (!home.data?.markdown) {
      return null;
    }
    return renderPage(home.data.markdown, {
      hasPage: (target) => Object.prototype.hasOwnProperty.call(index, target),
      episodeHref: (episode, seconds) => ctx.links.episode(episode, seconds == null ? undefined : { t: seconds }),
      blobUrl: ctx.blobs ? (ref) => ctx.blobs!.urlFor(ref) : undefined,
      sanitize: ctx.sanitize,
    });
  }, [ctx, home.data?.markdown, index]);

  const recent = [...entries]
    .sort(([, a], [, b]) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, RECENT_LIMIT);
  const tags = [...new Set(entries.flatMap(([, s]) => (s.tags ?? '').split(',').filter(Boolean)))].sort();

  if (entries.length === 0) {
    // One h1 in every state, or a screen reader navigating by heading finds nothing and core's route focus
    // falls back to the landmark (#28). An editor gets the action itself rather than a sentence naming the
    // role they already have (#25).
    return (
      <>
        <h1 className="wiki__title">{i18n.t('home.title')}</h1>
        <div className="wiki__empty">
          <p>{i18n.t('home.empty')}</p>
          {mayEdit ? (
            <p>
              <a className="wiki__btn" href={routeHref({ view: 'new' })} onClick={go({ view: 'new' })}>
                <Icon name="add" />
                {i18n.t('home.createFirst')}
              </a>
            </p>
          ) : (
            <p>{i18n.t('home.emptyHint')}</p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {intro ? (
        <article className="wiki__intro">
          <h1 className="wiki__title">{home.data?.title}</h1>
          {/* Sanitised in renderPage, exactly as a page body is — the front page is one. */}
          <div className="wiki__body" dangerouslySetInnerHTML={{ __html: intro.html }} />
          {mayEdit && home.data ? (
            <p className="wiki__meta">
              <a
                href={routeHref({ view: 'edit', slug: home.data.slug })}
                onClick={go({ view: 'edit', slug: home.data.slug })}
              >
                <Icon name="edit" />
                {i18n.t('home.editIntro')}
              </a>
            </p>
          ) : null}
        </article>
      ) : (
        <>
          <h1 className="wiki__title">{i18n.t('home.title')}</h1>
          {mayEdit ? (
            <p className="wiki__meta">
              {i18n.t('home.noIntro')}{' '}
              <a href={routeHref({ view: 'new' })} onClick={go({ view: 'new' })}>
                {i18n.t('home.writeIntro')}
              </a>
            </p>
          ) : (
            <p className="wiki__meta">{i18n.t('home.count', { n: String(entries.length) })}</p>
          )}
        </>
      )}

      <RandomPage i18n={i18n} index={index} exclude={home.data?.slug} go={go} />

      {tags.length > 0 && (
        <div className="wiki__tags">
          {tags.map((tag) => (
            <a className="wiki__tag" key={tag} href={routeHref({ view: 'tag', tag })} onClick={go({ view: 'tag', tag })}>
              <Icon name="tag" />
              {tag}
            </a>
          ))}
        </div>
      )}

      <h2 className="wiki__section-title">{i18n.t('home.recent')}</h2>
      <ul className="wiki__list">
        {recent.map(([slug, summary]) => (
          <li className="wiki__item" key={slug}>
            <h3>
              <a href={routeHref({ view: 'page', slug })} onClick={go({ view: 'page', slug })}>
                {summary.title || slug}
              </a>
            </h3>
            {summary.summary && <p>{summary.summary}</p>}
          </li>
        ))}
      </ul>

      <p className="wiki__meta">
        <a href={routeHref({ view: 'all' })} onClick={go({ view: 'all' })}>
          {i18n.t('home.seeAll', { n: String(entries.length) })}
        </a>
      </p>
    </>
  );
}

/**
 * One page picked at random, with its summary — somewhere to land when you did not come looking for
 * anything in particular.
 *
 * Picked client-side from the index the page already holds, so re-rolling costs nothing and there is no
 * "random row" query to add. The pick is stable across re-renders until someone asks for another, because
 * a card that changed every time React re-rendered would be unreadable.
 */
function RandomPage({
  i18n,
  index,
  exclude,
  go,
}: {
  i18n: PluginI18n;
  index: Record<string, PageSummary>;
  /** The front page, which is never offered here: the reader is already on it. */
  exclude?: string;
  go(route: WikiRoute): (event: MouseEvent | React.MouseEvent) => void;
}) {
  const slugs = Object.keys(index).filter((slug) => slug !== exclude);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    setPick(slugs.length > 0 ? slugs[Math.floor(Math.random() * slugs.length)] : null);
  }, [slugs.join(' ')]);

  if (!pick || !index[pick]) {
    return null;
  }
  const summary = index[pick];

  return (
    <section className="wiki__section wiki__random">
      <h2>
        <Icon name="dice" />
        {i18n.t('home.randomTitle')}
      </h2>
      <div className="wiki__item">
        <h3>
          <a href={routeHref({ view: 'page', slug: pick })} onClick={go({ view: 'page', slug: pick })}>
            {summary.title || pick}
          </a>
        </h3>
        {summary.summary ? <p>{summary.summary}</p> : <p>{i18n.t('home.randomNoSummary')}</p>}
      </div>
      <button
        className="wiki__btn wiki__btn--ghost"
        type="button"
        onClick={() => setPick(slugs[Math.floor(Math.random() * slugs.length)])}
      >
        <Icon name="refresh" />
        {i18n.t('home.randomAgain')}
      </button>
    </section>
  );
}
