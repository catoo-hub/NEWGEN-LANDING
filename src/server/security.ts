import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db, type Tx } from "./db";
import { members, orders, userRoles, user } from "./db/schema";
import type { Role } from "../shared/types";
import { baseUrl, required } from "./env";
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export type Actor = { id: string; email: string; name: string; roles: Role[] };
export const isStaff = (a: Actor) =>
  a.roles.includes("admin") || a.roles.includes("moderator");
export const isAdmin = (a: Actor) => a.roles.includes("admin");
export function need(
  condition: unknown,
  code = "FORBIDDEN",
  status = 403,
): asserts condition {
  if (!condition) throw new AppError(code, status);
}
export async function actor(request: Request): Promise<Actor> {
  const s = await auth.api.getSession({ headers: request.headers });
  need(s, "LOGIN_REQUIRED", 401);
  const [u] = await db.select().from(user).where(eq(user.id, s.user.id));
  need(u && !u.disabled, "ACCOUNT_DISABLED");
  need(u.emailVerified, "VERIFY_EMAIL");
  const list = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, u.id));
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roles: ["customer", ...list.map((r) => r.role)],
  };
}
export async function orderAccess(
  a: Actor,
  orderId: string,
  tx: Tx | typeof db = db,
) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  need(o, "NOT_FOUND", 404);
  const [m] = o.memberId
    ? await tx.select().from(members).where(eq(members.id, o.memberId))
    : [];
  need(
    isStaff(a) ||
      o.customerId === a.id ||
      (m?.userId === a.id && a.roles.includes("performer")),
  );
  return {
    o,
    m,
    isCustomer: o.customerId === a.id,
    isPerformer: m?.userId === a.id && a.roles.includes("performer"),
  };
}
export async function myMember(a: Actor, tx: Tx | typeof db = db) {
  need(a.roles.includes("performer"));
  const [m] = await tx.select().from(members).where(eq(members.userId, a.id));
  need(m, "NO_TEAM_PROFILE");
  return m;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  need(origin === new URL(baseUrl).origin, "INVALID_ORIGIN");
}
export function encrypt(value: string) {
  const iv = randomBytes(12),
    key = createHash("sha256").update(required("DATA_SECRET")).digest();
  const c = createCipheriv("aes-256-gcm", key, iv);
  return [
    iv.toString("hex"),
    Buffer.concat([c.update(value, "utf8"), c.final()]).toString("hex"),
    c.getAuthTag().toString("hex"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, body, tag] = value.split(".");
  const c = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(required("DATA_SECRET")).digest(),
    Buffer.from(iv, "hex"),
  );
  c.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    c.update(Buffer.from(body, "hex")),
    c.final(),
  ]).toString();
}
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
