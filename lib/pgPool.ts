import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("Missing SUPABASE_DB_URL");

export const pgPool =
  global.__pgPool ??
  new Pool({
    connectionString,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pgPool;
}
