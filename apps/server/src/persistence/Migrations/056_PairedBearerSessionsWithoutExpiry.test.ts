import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "056_PairedBearerSessionsWithoutExpiry",
  (it) => {
    it.effect("allows expiry-free new sessions without changing existing credentials", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 55 });
        const expiry = "2026-11-01T00:00:00.000Z";
        yield* sql`
          INSERT INTO auth_sessions (
            session_id, subject, scopes, method, client_device_type, issued_at,
            expires_at, client_surface, client_app_version
          ) VALUES
            ('paired', 'one-time-token', '[]', 'bearer-access-token', 'mobile',
              '2026-10-01T00:00:00.000Z', ${expiry}, 'mobile', '1.2.3'),
            ('custom-pair', 'named-device', '[]', 'bearer-access-token', 'mobile',
              '2026-10-01T00:00:00.000Z', '9999-12-31T23:59:59.000Z', 'mobile', '1.2.3'),
            ('temporary', 'desktop-bootstrap', '[]', 'bearer-access-token', 'desktop',
              '2026-10-01T00:00:00.000Z', ${expiry}, 'desktop', '1.2.3'),
            ('dpop', 'one-time-token', '[]', 'dpop-access-token', 'mobile',
              '2026-10-01T00:00:00.000Z', ${expiry}, 'mobile', '1.2.3')
        `;

        yield* runMigrations({ toMigrationInclusive: 56 });
        const rows = yield* sql<{
          readonly sessionId: string;
          readonly expiresAt: string | null;
          readonly clientSurface: string | null;
          readonly clientAppVersion: string | null;
        }>`
          SELECT session_id AS "sessionId", expires_at AS "expiresAt",
            client_surface AS "clientSurface", client_app_version AS "clientAppVersion"
          FROM auth_sessions ORDER BY session_id
        `;
        expect(rows).toEqual([
          {
            sessionId: "custom-pair",
            expiresAt: "9999-12-31T23:59:59.000Z",
            clientSurface: "mobile",
            clientAppVersion: "1.2.3",
          },
          {
            sessionId: "dpop",
            expiresAt: expiry,
            clientSurface: "mobile",
            clientAppVersion: "1.2.3",
          },
          {
            sessionId: "paired",
            expiresAt: expiry,
            clientSurface: "mobile",
            clientAppVersion: "1.2.3",
          },
          {
            sessionId: "temporary",
            expiresAt: expiry,
            clientSurface: "desktop",
            clientAppVersion: "1.2.3",
          },
        ]);
      }),
    );
  },
);
