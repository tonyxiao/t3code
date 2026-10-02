import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE auth_sessions_without_expiry (
      session_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      scopes TEXT NOT NULL,
      method TEXT NOT NULL,
      client_label TEXT,
      client_ip_address TEXT,
      client_user_agent TEXT,
      client_device_type TEXT NOT NULL DEFAULT 'unknown',
      client_os TEXT,
      client_browser TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT,
      last_connected_at TEXT,
      revoked_at TEXT,
      client_surface TEXT,
      client_app_version TEXT
    )
  `;
  yield* sql`
    INSERT INTO auth_sessions_without_expiry
    SELECT session_id, subject, scopes, method, client_label, client_ip_address,
      client_user_agent, client_device_type, client_os, client_browser, issued_at,
      expires_at,
      last_connected_at, revoked_at, client_surface, client_app_version
    FROM auth_sessions
  `;
  yield* sql`DROP TABLE auth_sessions`;
  yield* sql`ALTER TABLE auth_sessions_without_expiry RENAME TO auth_sessions`;
  yield* sql`
    CREATE INDEX idx_auth_sessions_active
    ON auth_sessions(revoked_at, expires_at, issued_at)
  `;
});
