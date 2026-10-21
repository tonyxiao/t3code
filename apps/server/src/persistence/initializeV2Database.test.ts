// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "./Sqlite.ts";
import { runMigrations } from "./Migrations.ts";
import { initializeV2Database } from "./initializeV2Database.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";

it.effect(
  "snapshots V1, imports transcripts lazily, and preserves both databases across switches",
  () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v1-v2-"));
    const sourcePath = NodePath.join(directory, "state.sqlite");
    const destinationPath = NodePath.join(directory, "statev2.sqlite");
    const threadId = ThreadId.make("legacy-thread");
    const seed = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 52 });
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('project', 'Project', '/tmp/project', '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
      VALUES (${threadId}, 'project', 'V1 thread', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
      for (let index = 0; index < 6; index++) {
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES (${`message-${index}`}, ${threadId}, ${index % 2 ? "assistant" : "user"}, ${`Text ${index}`}, 0, ${`2026-01-0${index + 1}T00:00:00.000Z`}, ${`2026-01-0${index + 1}T00:00:00.000Z`})`;
      }
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: sourcePath })));

    return Effect.gen(function* () {
      yield* seed;
      const original = NodeFS.readFileSync(sourcePath);
      const config = yield* ServerConfig.ServerConfig;
      const layerDatabase = SqlitePersistence.layerConfig.pipe(
        Layer.provide(ServerConfig.layer({ ...config, dbPath: destinationPath })),
      );
      const layerStores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
        Layer.provideMerge(layerDatabase),
      );
      const layerSink = EventSink.layer.pipe(Layer.provide(layerStores));
      const layerImporter = LegacyV1ThreadImporter.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(layerStores, layerSink)),
      );
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const legacy = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        yield* legacy.reconcileShells;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const shell = yield* projections.getThreadProjection(threadId);
        assert.equal(shell.thread.id, threadId);
        assert.deepEqual(
          shell.messages.map((message) => message.text),
          ["Text 4", "Text 5"],
        );
        const pending =
          yield* sql`SELECT transcript_imported_at FROM orchestration_v2_legacy_imports`;
        assert.equal(pending[0]?.transcript_imported_at, null);
        yield* legacy.ensureTranscript(threadId);
        const transcript = yield* projections.getThreadProjection(threadId);
        assert.deepEqual(
          transcript.messages.map((message) => message.text),
          ["Text 0", "Text 1", "Text 2", "Text 3", "Text 4", "Text 5"],
        );
        const imported =
          yield* sql`SELECT imported_message_count, transcript_imported_at FROM orchestration_v2_legacy_imports`;
        assert.equal(imported[0]?.imported_message_count, 6);
        assert.isNotNull(imported[0]?.transcript_imported_at);
        yield* sql`CREATE TABLE v2_work (text TEXT)`;
        yield* sql`INSERT INTO v2_work VALUES ('Keep V2 work')`;
      }).pipe(Effect.provide(layerImporter));
      assert.deepEqual(NodeFS.readFileSync(sourcePath), original);
      const v1 = new NodeSqlite.DatabaseSync(sourcePath);
      try {
        assert.equal(
          v1.prepare("SELECT MAX(migration_id) AS id FROM effect_sql_migrations").get()?.id,
          52,
        );
        assert.equal(
          v1
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE name = 'orchestration_v2_legacy_imports'",
            )
            .get()?.count,
          0,
        );
        v1.exec("UPDATE projection_threads SET title = 'Continued in V1'");
      } finally {
        v1.close();
      }
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.equal((yield* sql`SELECT text FROM v2_work`)[0]?.text, "Keep V2 work");
        assert.equal((yield* sql`SELECT title FROM projection_threads`)[0]?.title, "V1 thread");
      }).pipe(Effect.provide(layerDatabase));
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
      Effect.ensuring(
        Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
    );
  },
);

it.effect("includes committed WAL data and does not publish a failed snapshot", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-snapshot-"));
  const sourcePath = NodePath.join(directory, "state.sqlite");
  const destinationPath = NodePath.join(directory, "statev2.sqlite");
  return Effect.gen(function* () {
    NodeFS.writeFileSync(sourcePath, "invalid SQLite");
    assert.isTrue((yield* Effect.result(initializeV2Database(destinationPath)))._tag === "Failure");
    assert.isFalse(NodeFS.existsSync(destinationPath));
    NodeFS.unlinkSync(sourcePath);
    const source = new NodeSqlite.DatabaseSync(sourcePath);
    try {
      source.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE messages(text TEXT); INSERT INTO messages VALUES ('committed'); BEGIN; INSERT INTO messages VALUES ('uncommitted');",
      );
      yield* initializeV2Database(destinationPath);
      const copy = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
      try {
        assert.deepEqual(
          copy
            .prepare("SELECT text FROM messages")
            .all()
            .map((row) => row.text),
          ["committed"],
        );
      } finally {
        copy.close();
      }
      source.exec("ROLLBACK");
    } finally {
      source.close();
    }
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});

it.effect("uses statev2.sqlite for default and explicit development paths", () =>
  Effect.gen(function* () {
    for (const devUrl of [undefined, new URL("http://localhost:5173")]) {
      for (const baseDirIsExplicit of [false, true]) {
        const paths = yield* ServerConfig.deriveServerPaths("/tmp/t3", devUrl, {
          baseDirIsExplicit,
        });
        assert.equal(NodePath.basename(paths.dbPath), "statev2.sqlite");
        assert.equal(NodePath.basename(paths.serverRuntimeStatePath), "server-runtime-v2.json");
        assert.equal(NodePath.basename(paths.keybindingsConfigPath), "keybindings-v2.json");
        assert.equal(NodePath.basename(paths.environmentIdPath), "environment-id-v2");
        assert.equal(paths.settingsPath, NodePath.join(paths.stateDir, "settings-v2.json"));
      }
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("copies V1 settings and keybindings once without sharing later writes", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-settings-"));
  const sourcePath = NodePath.join(directory, "settings.json");
  const destinationPath = NodePath.join(directory, "settings-v2.json");
  const sourceKeybindingsPath = NodePath.join(directory, "keybindings.json");
  const destinationKeybindingsPath = NodePath.join(directory, "keybindings-v2.json");
  return Effect.gen(function* () {
    NodeFS.writeFileSync(sourcePath, '{"theme":"light"}');
    NodeFS.writeFileSync(sourceKeybindingsPath, '{"open":"Ctrl+O"}');
    yield* initializeV2Database(NodePath.join(directory, "statev2.sqlite"));
    assert.equal(NodeFS.readFileSync(destinationPath, "utf8"), '{"theme":"light"}');
    assert.equal(NodeFS.readFileSync(destinationKeybindingsPath, "utf8"), '{"open":"Ctrl+O"}');
    NodeFS.writeFileSync(sourcePath, '{"theme":"dark"}');
    NodeFS.writeFileSync(sourceKeybindingsPath, '{"open":"Ctrl+P"}');
    yield* initializeV2Database(NodePath.join(directory, "statev2.sqlite"));
    assert.equal(NodeFS.readFileSync(destinationPath, "utf8"), '{"theme":"light"}');
    assert.equal(NodeFS.readFileSync(destinationKeybindingsPath, "utf8"), '{"open":"Ctrl+O"}');
  }).pipe(
    Effect.provide(NodeServices.layer),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});

it.effect("imports a current fork V1 database with both conflicting migrations", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v1-fork-"));
  const sourcePath = NodePath.join(directory, "state.sqlite");
  const destinationPath = NodePath.join(directory, "statev2.sqlite");
  return Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 54 }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: sourcePath })),
    );
    const v1 = new NodeSqlite.DatabaseSync(sourcePath);
    try {
      v1.exec("ALTER TABLE projection_threads ADD COLUMN snoozed_through_turn_id TEXT");
      v1.exec(
        "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'ProjectionThreadsSnoozedThroughTurn')",
      );
      v1.exec(
        "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (56, 'PairedBearerSessionsWithoutExpiry')",
      );
      v1.exec(
        "INSERT INTO auth_sessions (session_id, subject, scopes, method, issued_at, expires_at) VALUES ('v1-session', 'user', '[]', 'browser-session-cookie', '2026-01-01T00:00:00.000Z', '2036-01-01T00:00:00.000Z')",
      );
      // Match fork migration 56, which rebuilt the table with nullable expiry.
      v1.exec(`
        CREATE TABLE auth_sessions_without_expiry (
          session_id TEXT PRIMARY KEY, subject TEXT NOT NULL, scopes TEXT NOT NULL,
          method TEXT NOT NULL, client_label TEXT, client_ip_address TEXT,
          client_user_agent TEXT, client_device_type TEXT NOT NULL DEFAULT 'unknown',
          client_os TEXT, client_browser TEXT, issued_at TEXT NOT NULL,
          expires_at TEXT, last_connected_at TEXT, revoked_at TEXT,
          client_surface TEXT, client_app_version TEXT
        );
        INSERT INTO auth_sessions_without_expiry SELECT * FROM auth_sessions;
        DROP TABLE auth_sessions;
        ALTER TABLE auth_sessions_without_expiry RENAME TO auth_sessions;
        CREATE INDEX idx_auth_sessions_active ON auth_sessions(revoked_at, expires_at, issued_at);
        UPDATE auth_sessions SET expires_at = NULL WHERE session_id = 'v1-session';
      `);
    } finally {
      v1.close();
    }
    yield* initializeV2Database(destinationPath);
    const config = yield* ServerConfig.ServerConfig;
    yield* runMigrations().pipe(
      Effect.provide(
        SqlitePersistence.layerConfig.pipe(
          Layer.provide(ServerConfig.layer({ ...config, dbPath: destinationPath })),
        ),
      ),
    );
    const source = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
    const destination = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
    try {
      assert.equal(
        source.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 55").get()
          ?.name,
        "ProjectionThreadsSnoozedThroughTurn",
      );
      assert.equal(
        source.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 56").get()
          ?.name,
        "PairedBearerSessionsWithoutExpiry",
      );
      assert.equal(source.prepare("SELECT count(*) AS count FROM auth_sessions").get()?.count, 1);
      assert.equal(
        source.prepare("SELECT expires_at FROM auth_sessions WHERE session_id = 'v1-session'").get()
          ?.expires_at,
        null,
      );
      assert.equal(
        destination.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 55").get()
          ?.name,
        "OrchestrationV2",
      );
      assert.equal(
        destination.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 56").get()
          ?.name,
        "RemoveRedundantProjectionIndexes",
      );
      assert.equal(
        destination.prepare("SELECT count(*) AS count FROM auth_sessions").get()?.count,
        0,
      );
      assert.equal(
        destination
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'orchestration_v2_events'",
          )
          .get()?.count,
        1,
      );
    } finally {
      source.close();
      destination.close();
    }
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});

it.effect("repairs an earlier V2 snapshot blocked by fork migration ids", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-fork-repair-"));
  const sourcePath = NodePath.join(directory, "state.sqlite");
  const destinationPath = NodePath.join(directory, "statev2.sqlite");
  return Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 54 }).pipe(
      Effect.provide(NodeSqliteClient.layer({ filename: sourcePath })),
    );
    const v1 = new NodeSqlite.DatabaseSync(sourcePath);
    try {
      v1.exec("ALTER TABLE projection_threads ADD COLUMN snoozed_through_turn_id TEXT");
      v1.exec(
        "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'ProjectionThreadsSnoozedThroughTurn'), (56, 'PairedBearerSessionsWithoutExpiry')",
      );
    } finally {
      v1.close();
    }
    NodeFS.copyFileSync(sourcePath, destinationPath);
    yield* initializeV2Database(destinationPath);
    const config = yield* ServerConfig.ServerConfig;
    yield* runMigrations().pipe(
      Effect.provide(
        SqlitePersistence.layerConfig.pipe(
          Layer.provide(ServerConfig.layer({ ...config, dbPath: destinationPath })),
        ),
      ),
    );
    const source = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
    const destination = new NodeSqlite.DatabaseSync(destinationPath, { readOnly: true });
    try {
      assert.equal(
        source.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 56").get()
          ?.name,
        "PairedBearerSessionsWithoutExpiry",
      );
      assert.equal(
        destination.prepare("SELECT name FROM effect_sql_migrations WHERE migration_id = 56").get()
          ?.name,
        "RemoveRedundantProjectionIndexes",
      );
    } finally {
      source.close();
      destination.close();
    }
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});

it.effect("starts fresh without V1 and never imports over existing V2 state", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-v2-fresh-"));
  const destinationPath = NodePath.join(directory, "userdata", "statev2.sqlite");
  return Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const layerDatabase = SqlitePersistence.layerConfig.pipe(
      Layer.provide(ServerConfig.layer({ ...config, dbPath: destinationPath })),
    );
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE v2_work (text TEXT)`;
      yield* sql`INSERT INTO v2_work VALUES ('fresh V2 work')`;
    }).pipe(Effect.provide(layerDatabase));
    const sourcePath = NodePath.join(NodePath.dirname(destinationPath), "state.sqlite");
    assert.isFalse(NodeFS.existsSync(sourcePath));
    NodeFS.writeFileSync(sourcePath, "This source must never be opened once V2 exists");
    yield* initializeV2Database(destinationPath);
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      assert.equal((yield* sql`SELECT text FROM v2_work`)[0]?.text, "fresh V2 work");
    }).pipe(Effect.provide(layerDatabase));
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(directory, directory).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.ensuring(Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true }))),
  );
});
