import { tick } from "../src/server/worker";
import { pool } from "../src/server/db";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dataDir } from "../src/server/env";
const directory = resolve(dataDir);
await mkdir(directory, { recursive: true });
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    await tick();
    await writeFile(resolve(directory, "worker-health"), String(Date.now()));
  } catch {
    console.error("Worker tick failed");
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await pool.end();
