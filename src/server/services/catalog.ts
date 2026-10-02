import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import * as s from "../db/schema";
import { type Actor, need, isAdmin, hash, myMember } from "../security";
import { baseUrl } from "../env";
import { workTypes, roles } from "../../shared/types";
import { enqueueMail } from "../mail";
import { log } from "./orders";
import { members as initialMembers } from "../../data/members";
import { projects as initialProjects } from "../../data/projects";
const publicMember = (
  m: typeof s.members.$inferSelect,
  types: string[],
  busy: boolean,
) => ({
  id: m.id,
  name: m.name,
  role: m.role,
  link: m.link,
  types,
  available:
    m.active && m.available && !!m.userId && m.shareBps !== null && !busy,
});
export async function catalog() {
  if (!process.env.DATABASE_URL)
    return {
      members: initialMembers.map((m) => ({
        ...m,
        available: false,
        types: [],
      })),
      projects: initialProjects,
      rates: workTypes.map((type) => ({
        type,
        amount: null,
        descriptionRu: "",
        descriptionEn: "",
      })),
    };
  const [members, types, slots, projects, rates] = await Promise.all([
    db
      .select()
      .from(s.members)
      .where(eq(s.members.active, true))
      .orderBy(asc(s.members.position)),
    db.select().from(s.specializations),
    db.select().from(s.slots),
    db
      .select()
      .from(s.portfolio)
      .where(eq(s.portfolio.published, true))
      .orderBy(asc(s.portfolio.position)),
    db.select().from(s.rates),
  ]);
  return {
    members: members.map((m) =>
      publicMember(
        m,
        types.filter((t) => t.memberId === m.id).map((t) => t.type),
        slots.some((t) => t.memberId === m.id),
      ),
    ),
    projects: projects.map((p) => ({ ...p, duration: p.duration / 1000 })),
    rates,
  };
}
export async function availability(a: Actor, available: boolean) {
  return db.transaction(async (tx) => {
    const m = await myMember(a, tx);
    need(
      !available ||
        (m.active &&
          m.shareBps !== null &&
          (
            await tx
              .select()
              .from(s.specializations)
              .where(eq(s.specializations.memberId, m.id))
          ).length > 0),
      "PROFILE_INCOMPLETE",
      400,
    );
    await tx.update(s.members).set({ available }).where(eq(s.members.id, m.id));
    await log(tx, a, "AVAILABILITY_CHANGED", undefined, { available });
  });
}
export async function adminData(a: Actor) {
  need(isAdmin(a));
  const [
    members,
    types,
    users,
    userRoles,
    portfolio,
    rates,
    audit,
    invitations,
  ] = await Promise.all([
    db.select().from(s.members).orderBy(asc(s.members.position)),
    db.select().from(s.specializations),
    db
      .select({
        id: s.user.id,
        name: s.user.name,
        email: s.user.email,
        emailVerified: s.user.emailVerified,
        disabled: s.user.disabled,
      })
      .from(s.user)
      .limit(500),
    db.select().from(s.userRoles),
    db.select().from(s.portfolio).orderBy(asc(s.portfolio.position)),
    db.select().from(s.rates),
    db
      .select()
      .from(s.audit)
      .orderBy(sql`${s.audit.createdAt} desc`)
      .limit(150),
    db
      .select({
        id: s.invitations.id,
        email: s.invitations.email,
        usedAt: s.invitations.usedAt,
        expiresAt: s.invitations.expiresAt,
      })
      .from(s.invitations)
      .limit(100),
  ]);
  return {
    members: members.map((m) => ({
      ...m,
      types: types.filter((t) => t.memberId === m.id).map((t) => t.type),
    })),
    users: users.map((u) => ({
      ...u,
      roles: [
        "customer",
        ...userRoles.filter((r) => r.userId === u.id).map((r) => r.role),
      ],
    })),
    portfolio,
    rates,
    audit,
    invitations,
  };
}
const http = z.url().refine((v) => /^https?:\/\//.test(v));
const media = z
  .string()
  .refine(
    (v) =>
      /^\/(videos|posters)\/[a-zA-Z0-9_.-]+$/.test(v) ||
      /^\/api\/public-media\/[a-f0-9-]{36}\/$/.test(v),
  );
export async function saveCatalog(a: Actor, kind: string, input: unknown) {
  need(isAdmin(a));
  return db.transaction(async (tx) => {
    if (kind === "members") {
      const v = z
        .object({
          id: z.string().min(1).max(80),
          name: z.string().min(1).max(100),
          role: z.string().max(100),
          link: http,
          active: z.boolean(),
          shareBps: z.number().int().min(0).max(10000).nullable(),
          types: z.array(z.enum(workTypes)).max(6),
          position: z.number().int().min(0).max(10000).default(0),
        })
        .parse(input);
      const { types, ...row } = v;
      await tx
        .insert(s.members)
        .values(row)
        .onConflictDoUpdate({ target: s.members.id, set: row });
      await tx
        .delete(s.specializations)
        .where(eq(s.specializations.memberId, v.id));
      if (types.length)
        await tx
          .insert(s.specializations)
          .values(
            [...new Set(types)].map((type) => ({ memberId: v.id, type })),
          );
      if (!types.length || v.shareBps === null || !v.active)
        await tx
          .update(s.members)
          .set({ available: false })
          .where(eq(s.members.id, v.id));
    } else if (kind === "rates") {
      const v = z
        .object({
          type: z.enum(workTypes),
          amount: z.number().int().positive().max(1000000000).nullable(),
          descriptionRu: z.string().max(3000),
          descriptionEn: z.string().max(3000),
        })
        .parse(input);
      await tx
        .insert(s.rates)
        .values(v)
        .onConflictDoUpdate({ target: s.rates.type, set: v });
    } else if (kind === "portfolio") {
      const v = z
        .object({
          id: z.string().min(1).max(80),
          title: z.string().min(1).max(150),
          platform: z.enum(workTypes),
          url: http,
          src: media,
          poster: media,
          duration: z.number().int().min(0).default(0),
          memberId: z.string().nullable(),
          orderId: z.string().nullable(),
          published: z.boolean(),
          position: z.number().int().min(0).max(10000).default(0),
        })
        .parse(input);
      if (v.orderId) {
        const [o] = await tx
          .select()
          .from(s.orders)
          .where(eq(s.orders.id, v.orderId));
        need(
          o?.portfolioConsent && o.completedAt,
          "PORTFOLIO_PERMISSION_REQUIRED",
          400,
        );
      }
      for (const path of [v.src, v.poster])
        if (path.startsWith("/api/public-media/")) {
          const [f] = await tx
            .select()
            .from(s.files)
            .where(eq(s.files.id, path.split("/")[3]));
          need(f, "FILE_NOT_FOUND", 400);
          need(
            !f.orderId || f.orderId === v.orderId,
            "PORTFOLIO_PERMISSION_REQUIRED",
            400,
          );
        }
      await tx
        .insert(s.portfolio)
        .values(v)
        .onConflictDoUpdate({ target: s.portfolio.id, set: v });
    } else if (kind === "users") {
      const v = z
        .object({
          id: z.string(),
          disabled: z.boolean(),
          roles: z.array(z.enum(roles)).max(4),
        })
        .parse(input);
      const [u] = await tx.select().from(s.user).where(eq(s.user.id, v.id));
      need(u, "NOT_FOUND", 404);
      need(
        u.email !== (process.env.OWNER_EMAIL || "hikeru1@icloud.com") ||
          (!v.disabled && v.roles.includes("admin")),
        "OWNER_PROTECTED",
        400,
      );
      need(v.id !== a.id || !v.disabled, "OWNER_PROTECTED", 400);
      await tx
        .update(s.user)
        .set({ disabled: v.disabled })
        .where(eq(s.user.id, v.id));
      await tx.delete(s.userRoles).where(eq(s.userRoles.userId, v.id));
      if (v.roles.length)
        await tx
          .insert(s.userRoles)
          .values(
            [...new Set(v.roles)].map((role) => ({ userId: v.id, role })),
          );
      if (!v.roles.includes("performer"))
        await tx
          .update(s.members)
          .set({ available: false })
          .where(eq(s.members.userId, v.id));
      if (v.disabled) {
        await tx.delete(s.session).where(eq(s.session.userId, v.id));
        await tx
          .update(s.members)
          .set({ available: false })
          .where(eq(s.members.userId, v.id));
      }
    } else need(false, "UNKNOWN_RESOURCE", 400);
    await log(tx, a, "CATALOG_UPDATED", undefined, { kind, changes: input });
  });
}
export async function invite(a: Actor, input: unknown) {
  need(isAdmin(a));
  const v = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      memberId: z.string().nullable(),
      roles: z.array(z.enum(roles)).min(1).max(4),
    })
    .parse(input);
  const token = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    if (v.memberId) {
      const [m] = await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, v.memberId));
      need(m && !m.userId, "MEMBER_ALREADY_LINKED", 409);
      need(v.roles.includes("performer"), "PERFORMER_ROLE_REQUIRED", 400);
    }
    await tx
      .insert(s.invitations)
      .values({
        ...v,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      });
    await enqueueMail(
      v.email,
      "RE:STATIC — приглашение / Team invitation",
      `${baseUrl}/ru/account/?invite=${token}`,
      tx,
    );
    await log(tx, a, "TEAM_INVITED", undefined, {
      email: v.email,
      memberId: v.memberId,
    });
  });
}
export async function claim(a: Actor, token: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from invitations where token_hash=${hash(token)} for update`,
    );
    const [i] = await tx
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.tokenHash, hash(token)));
    need(
      i &&
        !i.usedAt &&
        i.expiresAt > new Date() &&
        i.email === a.email.toLowerCase(),
      "INVALID_INVITATION",
      400,
    );
    if (i.memberId) {
      await tx.execute(
        sql`select id from members where id=${i.memberId} for update`,
      );
      const [m] = await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, i.memberId));
      need(m && !m.userId, "MEMBER_ALREADY_LINKED", 409);
      await tx
        .update(s.members)
        .set({ userId: a.id })
        .where(eq(s.members.id, i.memberId));
    }
    for (const r of i.roles)
      await tx
        .insert(s.userRoles)
        .values({ userId: a.id, role: r as any })
        .onConflictDoNothing();
    await tx
      .update(s.invitations)
      .set({ usedAt: new Date() })
      .where(eq(s.invitations.id, i.id));
    await log(tx, a, "INVITATION_ACCEPTED");
  });
}
