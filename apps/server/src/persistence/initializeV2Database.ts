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

function normalizeForkV1Snapshot(databasePath: string, freshSnapshot = false): void {
  const snapshot = new NodeSqlite.DatabaseSync(databasePath);
  try {
    const migrationsTable = snapshot
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
      )
      .get();
    const later = migrationsTable
      ? snapshot
          .prepare(
            "SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 55 ORDER BY migration_id",
          )
          .all()
      : [];
    const forkMigrations =
      later[0]?.migration_id === 55 &&
      later[0]?.name === "ProjectionThreadsSnoozedThroughTurn" &&
      (later.length === 1 ||
        (later.length === 2 &&
          later[1]?.migration_id === 56 &&
          later[1]?.name === "PairedBearerSessionsWithoutExpiry"));
    if (!forkMigrations && !freshSnapshot) return;

    // These ids belong to different migrations in V2. Keep the V1 tables for
    // lazy thread import, but do not carry V1 auth sessions into a new identity.
    snapshot.exec("BEGIN IMMEDIATE");
    try {
      if (forkMigrations) {
        snapshot.exec("DELETE FROM effect_sql_migrations WHERE migration_id IN (55, 56)");
      }
      if (
        snapshot
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'")
          .get()
      ) {
        snapshot.exec("DELETE FROM auth_sessions");
      }
      snapshot.exec("COMMIT");
    } catch (cause) {
      snapshot.exec("ROLLBACK");
      throw cause;
    }
  } finally {
    snapshot.close();
  }
}

const isV2DatabaseImportError = Schema.is(V2DatabaseImportError);

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

// Legacy names have no PID; newer copies stay while their process is alive.
const removeAbandonedCopies = Effect.fn("removeAbandonedCopies")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.catchIf(
      (error) => error.reason._tag === "NotFound",
      () => Effect.succeed([]),
    ),
  );
  for (const entry of entries) {
    const copy = /^\.v2-import-(?:(\d+)-)?[A-Za-z0-9]{6}$/.exec(entry);
    if (copy === null || (copy[1] !== undefined && isProcessAlive(Number(copy[1])))) continue;
    yield* fs.remove(path.join(directory, entry), { recursive: true });
  }
});

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
  const sourceKeybindingsPath = path.join(directory, "keybindings.json");
  const destinationKeybindingsPath = path.join(directory, "keybindings-v2.json");
  if (
    !(yield* fs.exists(destinationKeybindingsPath)) &&
    (yield* fs.exists(sourceKeybindingsPath))
  ) {
    yield* fs.copyFile(sourceKeybindingsPath, destinationKeybindingsPath);
  }
  yield* removeAbandonedCopies(directory).pipe(Effect.ignore({ log: true }));
  yield* Effect.gen(function* () {
    if (yield* fs.exists(destinationPath)) {
      // Repair snapshots published by earlier migration builds before their
      // first successful V2 schema migration.
      yield* Effect.sync(() => normalizeForkV1Snapshot(destinationPath));
      return;
    }
    if (!(yield* fs.exists(sourcePath))) return;
    const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
      directory,
      prefix: `.v2-import-${process.pid}-`,
    });
    const snapshotPath = path.join(temporaryDirectory, "snapshot.sqlite");
    yield* Effect.tryPromise({
      try: async () => {
        const database = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
        try {
          await NodeSqlite.backup(database, snapshotPath);
        } finally {
          database.close();
        }
      },
      catch: (cause) => new V2DatabaseImportError({ sourcePath, destinationPath, cause }),
    });
    yield* Effect.sync(() => normalizeForkV1Snapshot(snapshotPath, true));
    // Publish only a complete snapshot, without replacing an existing V2 database.
    yield* fs.link(snapshotPath, destinationPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        (_error) => Effect.void,
      ),
    );
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) =>
      isV2DatabaseImportError(cause)
        ? cause
        : new V2DatabaseImportError({ sourcePath, destinationPath, cause }),
    ),
  );
});
