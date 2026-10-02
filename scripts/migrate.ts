import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db";
const c = await pool.connect();
try {
  await c.query("select pg_advisory_lock(884430)");
  await migrate(db, { migrationsFolder: "./drizzle" });
} finally {
  await c.query("select pg_advisory_unlock(884430)");
  c.release();
  await pool.end();
}
