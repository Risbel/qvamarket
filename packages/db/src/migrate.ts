import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.ts";

// Applies the SQL files in packages/db/drizzle. Used in production (no drizzle-kit needed).
await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
console.log("Migrations applied");
await pool.end();
