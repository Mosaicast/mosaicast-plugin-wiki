# Brief: mosaicast-plugin-wiki

> Prerequisite: `docs/ARCHITECTURE.md` §7.6 (schema provider). Depends **only** on the SDK.
> **Site-scope** plugin. The only plugin that uses the **declarative schema provider** instead of the doc store — because it is more relational (search, backlinks, revisions).

## Concept
A simple wiki for the site (lore, glossary, people, etc.). Hundreds of pages are trivial for Postgres; the reason for schema tables is **query ergonomics** (full-text search, tags, revisions), not volume.

## Storage: declared schema (NOT the doc store)
Declare it in the manifest under `storage.schema` — the **platform** provisions namespaced tables (`plugin_wiki_*`) from it via Flyway and cleans up on uninstall. **The plugin never writes DDL.**
```json
"storage": { "schema": {
  "page":     { "slug":"string:indexed:unique", "title":"string",
                "markdown":"text:fulltext", "updatedAt":"timestamp:indexed" },
  "revision": { "pageSlug":"string:indexed", "markdown":"text", "createdAt":"timestamp:indexed", "author":"string" }
}}
```
- **Full-text search** over the `fulltext` field (the platform adds `tsvector` + GIN).
- **Revisions** as a separate entity (no last-write-wins).
- **Backlinks** computed on the fly over the `markdown` content at hundreds of pages.

## Slots (manifest)
- `site / main` — wiki browser (page list, search, page view, markdown editor for PODCASTER).
- Editing only `visibleTo: podcaster`; reading `anonymous`.

## Deep links & sharing (reference implementation, ARCHITECTURE §6.4)
- Pages live at **`/p/wiki/{slug}`**: read `ctx.route` (+ `onChange`) to render the addressed page; navigation inside the wiki updates the route.
- Implement **`ShareMetadataProvider`**: `metaFor("{slug}")` → page title + a short excerpt (first paragraph, stripped) so shared wiki links get a proper preview. No match → empty (core falls back to site OG).
- Implement **`SitemapProvider`**: expose all page URLs (`/p/wiki/{slug}`, `lastModified` = `updatedAt`) so wiki pages land in the site's sitemap (§6.6).
- UI strings via the SDK i18n helper (`locales/en.json` + `de.json`); **page content itself is author data, not UI** — it is written in whatever language the podcaster writes.

## Notes
- Render markdown safely: sanitize (no raw HTML/script pass-through) — same care as for SVG uploads.
- If the plugin embeds third-party content (images/maps), declare consent categories in the manifest (§12.5).

## Definition of Done
A podcaster creates/edits pages (with revisions), full-text search works, anonymous users read. Tables are platform-provisioned, no DDL in the plugin, clean cleanup on uninstall.

**Tests (§13.5):** backend unit tests against the test kit for the schema-store operations (pages/revisions, search); a frontend test with `makeMockCtx` for the editor/reader rendering by role.

## SDK & license
- Depends **only** on the SDK; consume via `mavenLocal()`/`includeBuild` and `npm link` (ARCHITECTURE §3.5). **Exact signatures from the SDK Javadoc/TSDoc, don't guess.**
- **License: AGPLv3** (official feature plugin). SPDX headers in source files. Take `CONTRIBUTING.md` + DCO workflow from the templates.
