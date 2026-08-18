// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { createPluginI18n, type PluginContext } from '@mosaicast/plugin-sdk';
import en from '../locales/en.json';
import de from '../locales/de.json';

/**
 * Builds this plugin's translator, bound to the host's active locale.
 *
 * Only the wiki's own chrome is translated. **Page content is author data, not UI** — a podcaster writes
 * a page in whatever language they write in, and translating it would be a guess about their intent.
 */
export function makeI18n(locale: PluginContext['locale']) {
  return createPluginI18n({ en, de }, locale);
}
