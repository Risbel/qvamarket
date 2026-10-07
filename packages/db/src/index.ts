import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
export * from "./schema.ts";
// Query helpers re-exported so apps do not depend on drizzle-orm directly
export { and, eq, or, sql } from "drizzle-orm";
