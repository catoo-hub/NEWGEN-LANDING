import { auth } from "../src/server/auth";
import { db, pool } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { eq } from "drizzle-orm";
import { required } from "../src/server/env";
const email = process.env.OWNER_EMAIL || "hikeru1@icloud.com";
const password = required("ADMIN_INITIAL_PASSWORD");
if (password.length < 16)
  throw new Error("Use a unique password of at least 16 characters");
const [existing] = await db
  .select()
  .from(s.user)
  .where(eq(s.user.email, email));
if (existing)
  throw new Error(
    "Owner account already exists; this command cannot promote an existing account. Use recovery or a reviewed DB operation.",
  );
const result = await auth.api.signUpEmail({
  body: { name: "Никита", email, password },
});
await db.transaction(async (tx) => {
  await tx
    .update(s.user)
    .set({ emailVerified: true })
    .where(eq(s.user.id, result.user.id));
  await tx
    .insert(s.userRoles)
    .values({ userId: result.user.id, role: "admin" });
});
console.log(
  "Owner account created. Remove ADMIN_INITIAL_PASSWORD from the environment.",
);
await pool.end();
