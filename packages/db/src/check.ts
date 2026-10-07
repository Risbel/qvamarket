import { sql } from "drizzle-orm";
import { db, pool } from "./index.ts";

const result = await db.execute(sql`select version() as version`);
console.log("DB connection OK:", result.rows[0]?.version);
await pool.end();
