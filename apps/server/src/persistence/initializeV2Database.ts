import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class V2DatabaseImportError extends Schema.TaggedError<V2DatabaseImportError>()(
  "V2DatabaseImportError",
  { sourcePath: Schema.String, destinationPath: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `Could not copy the V1 database at ${this.sourcePath} to ${this.destinationPath}. The V1 database has not been migrated.`;
  }
}

/** Its copied legacy tables remain the source for lazy transcript import. */
export const initializeV2Database = Effect.fn("initializeV2Database")(function* (
  destinationPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(destinationPath);
  const sourcePath = path.join(directory, "state.sqlite");
  const sourceSettingsPath = path.join(directory, "settings.json");
  const destinationSettingsPath = path.join(directory, "settings-v2.json");
  if (!(yield* fs.exists(destinationSettingsPath)) && (yield* fs.exists(sourceSettingsPath))) {
    yield* fs.copyFile(sourceSettingsPath, destinationSettingsPath);
  }
  yield* Effect.gen(function* () {
    if (yield* fs.exists(destinationPath)) return;
    if (!(yield* fs.exists(sourcePath))) return;
    const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
      directory,
      prefix: ".v2-import-",
    });
    const snapshotPath = path.join(temporaryDirectory, "snapshot.sqlite");
    yield* Effect.tryPromise(async () => {
      const database = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
      try {
        await NodeSqlite.backup(database, snapshotPath);
      } finally {
        database.close();
      }
    });
    // Fork V1 used migration 55 for snooze state; V2 needs that id for its
    // orchestration schema. Keep V1's column but free the id in this copy only.
    yield* Effect.sync(() => {
      const snapshot = new NodeSqlite.DatabaseSync(snapshotPath);
      try {
        const migrationsTable = snapshot
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
          )
          .get();
        if (!migrationsTable) return;
        const later = snapshot
          .prepare("SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 55")
          .all();
        if (
          later.length === 1 &&
          later[0]?.migration_id === 55 &&
          later[0]?.name === "ProjectionThreadsSnoozedThroughTurn"
        ) {
          snapshot.exec("DELETE FROM effect_sql_migrations WHERE migration_id = 55");
        }
      } finally {
        snapshot.close();
      }
    });
    // Publish only a complete snapshot, without replacing an existing V2 database.
    yield* fs
      .link(snapshotPath, destinationPath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(error),
        ),
      );
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) => new V2DatabaseImportError({ sourcePath, destinationPath, cause })),
  );
});
