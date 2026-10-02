import { db, pool } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { members } from "../src/data/members";
import { projects } from "../src/data/projects";
import { workTypes, type WorkType } from "../src/shared/types";
await db.transaction(async (tx) => {
  for (const [position, m] of members.entries()) {
    const [inserted] = await tx
      .insert(s.members)
      .values({ ...m, position })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      const types: WorkType[] = [];
      if (m.role.includes("AMV")) types.push("AMV");
      if (m.role.includes("GMV")) types.push("GMV");
      if (m.role.includes("Clip")) types.push("VIDEO_CLIPS");
      if (m.role.includes("GFX")) types.push("GFX");
      if (m.role.includes("Logo")) types.push("LOGO");
      if (m.role.includes("Motion") || m.role.includes("Sound"))
        types.push("OTHER");
      if (types.length)
        await tx
          .insert(s.specializations)
          .values(types.map((type) => ({ memberId: m.id, type })))
          .onConflictDoNothing();
    }
  }
  for (const [position, p] of projects.entries())
    await tx
      .insert(s.portfolio)
      .values({
        ...p,
        platform: p.platform === "CLIP" ? "VIDEO_CLIPS" : p.platform,
        duration: Math.round(p.duration * 1000),
        position,
      })
      .onConflictDoNothing();
  for (const type of workTypes)
    await tx.insert(s.rates).values({ type }).onConflictDoNothing();
});
console.log("Roster and portfolio seeded without overwriting edits");
await pool.end();
