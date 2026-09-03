// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.wiki;

import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * A {@link FakeSchemaStore} built from {@code plugin.json} rather than transcribed from it.
 *
 * <p><strong>Why this exists.</strong> {@code FakeSchemaStore} enforces the same declaration the host does,
 * which is the point of it — a write to a field the manifest never declared fails in a unit test instead of
 * at load. That only holds while the fixture agrees with the manifest, and it was spelled out by hand in
 * four test classes. Adding one schema field therefore broke 29 tests in ways that named the symptom
 * (an {@code ArrayIndexOutOfBoundsException} deep in a row mapper) and not the cause. Reading the manifest
 * makes the fixture derived: a field added to {@code plugin.json} is a field these tests already know about.
 *
 * <p>The path is resolved from the test's working directory ({@code backend/}) rather than from the
 * classpath, because the manifest is deliberately not a build input — {@code build.sh} copies it into
 * {@code dist/} untouched, and packaging it would create a second copy able to disagree with the first.
 */
final class WikiSchemaFixture {

    private static final Path MANIFEST = Path.of("..", "plugin.json");

    private WikiSchemaFixture() {
    }

    /**
     * Builds a store declaring exactly the entities and fields the manifest declares.
     *
     * @return a fresh, empty store with this plugin's schema
     */
    static FakeSchemaStore schema() {
        JsonNode entities = manifest().path("storage").path("schema");
        if (entities.isMissingNode() || entities.isEmpty()) {
            throw new IllegalStateException("plugin.json declares no storage.schema");
        }
        FakeSchemaStore store = new FakeSchemaStore("plugin_wiki_");
        for (String entity : entities.propertyNames()) {
            JsonNode declared = entities.get(entity);
            List<String> fields = new ArrayList<>();
            List<String> fulltext = new ArrayList<>();
            for (String field : declared.propertyNames()) {
                fields.add(field);
                // The declaration is `type:flag:flag`; only `fulltext` changes what the fake accepts.
                if (declared.get(field).asString().contains(":fulltext")) {
                    fulltext.add(field);
                }
            }
            store = store.withEntity(entity, fields.toArray(String[]::new));
            if (!fulltext.isEmpty()) {
                store = store.withFulltext(entity, fulltext.toArray(String[]::new));
            }
        }
        return store;
    }

    private static JsonNode manifest() {
        try {
            return new ObjectMapper().readTree(Files.readString(MANIFEST));
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + MANIFEST.toAbsolutePath(), e);
        }
    }
}
