// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useRef, useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { isPluginApiError } from '@mosaicast/plugin-sdk';

/** What a fetch is doing right now. `error` never carries a server message — the UI translates its own. */
export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  failed: boolean;
}

/**
 * Reads one site-scoped doc key.
 *
 * **Absence is not a failure** here (the host's 204): an absent document is the correct answer for a
 * wiki nobody has written to yet, and treating it as an error would show a scary tile on a healthy empty
 * install. Anything else is reported, because a 403 (a misdeclared `readableBy` floor) must not look like emptiness.
 *
 * **A reassigned `ctx` refetches but does not blank.** The host hands a new context object on a login, a
 * theme change, a language change and any other render of its own, and this hook re-reads on each — which
 * is right, since the answer can have changed. What it must not do is drop back to `loading` on the way,
 * because `WikiPage` gates its views on that flag: the editor would be unmounted and mounted again, with
 * an author's unsaved body in it, several times over the life of one edit. So the blank happens only when
 * the `key` really is a different document; otherwise the previous answer stays on screen until the new
 * one replaces it.
 *
 * @param ctx the host context
 * @param key the doc key below `data/site/main/`
 * @returns the document, or `null` when it does not exist yet
 */
export function useSiteDoc<T>(ctx: PluginContext, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, loading: true, failed: false });
  /** The key the state on screen belongs to, so a refetch can be told from a navigation. */
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (shownKey.current !== key) {
      setState({ data: null, loading: true, failed: false });
    }

    // `ctx.docs.get` resolves an absent document to null and rejects everything else, so a 403 (a
    // misdeclared read floor) still reads as a failure rather than as an empty wiki. It also collapses
    // concurrent reads of one key into one request -- four components read `index`. Its remembered misses
    // last 30 s and end on navigation (core 0.7.5), which only a key the backend writes later could
    // notice; the receipt poll in the editor is that key, and goes around it.
    ctx.docs
      .get<T>('site', key)
      .then((data) => {
        if (!cancelled) {
          shownKey.current = key;
          setState({ data, loading: false, failed: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        ctx.log('warn', `wiki: could not read ${key}: ${describeApiError(error)}`);
        shownKey.current = key;
        setState({ data: null, loading: false, failed: true });
      });

    return () => {
      cancelled = true;
    };
  }, [ctx, key]);

  return state;
}

/** The status and problem type behind a rejection, so a log line says which rule refused. */
export function describeApiError(error: unknown): string {
  // Not `instanceof`: the error crosses a bundle boundary from the host, so identity is not reliable.
  return isPluginApiError(error)
    ? `${error.status} ${error.problem?.type ?? ''}`.trim()
    : String(error);
}
