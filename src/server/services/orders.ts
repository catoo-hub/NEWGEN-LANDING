import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "../db";
import * as s from "../db/schema";
import {
  type Actor,
  AppError,
  need,
  isAdmin,
  isStaff,
  orderAccess,
} from "../security";
import { notify, staffIds } from "../mail";
import { share, workTypes } from "../../shared/types";
import { termsVersion } from "../env";
import offers from "../../data/offers.json";
const link = z.url().refine((v) => /^https?:\/\//.test(v));
const links = z.array(link).max(20).default([]);
const text = z.string().trim().min(1).max(30000);
export const applicationSchema = z.object({
  title: z.string().trim().min(2).max(150),
  type: z.enum(workTypes),
  country: z.string().trim().min(2).max(100),
  brief: text,
  description: z.string().max(30000).default(""),
  music: z.string().max(5000).default(""),
  links,
  preferredMemberId: z.string().nullable().optional(),
  language: z.enum(["ru", "en"]).default("ru"),
});
export async function log(
  tx: Tx,
  a: Actor | null,
  action: string,
  orderId?: string,
  details: unknown = {},
) {
  await tx.insert(s.audit).values({ actorId: a?.id, orderId, action, details });
}
async function audience(tx: Tx, o: typeof s.orders.$inferSelect) {
  const [m] = o.memberId
    ? await tx.select().from(s.members).where(eq(s.members.id, o.memberId))
    : [];
  return [
    o.customerId,
    ...(o.paidAt && m?.userId ? [m.userId] : []),
    ...(await staffIds(tx)),
  ];
}
async function update(
  tx: Tx,
  a: Actor | null,
  o: typeof s.orders.$inferSelect,
  values: Partial<typeof s.orders.$inferInsert>,
  action: string,
  details: unknown = {},
) {
  await tx
    .update(s.orders)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(s.orders.id, o.id));
  await log(tx, a, action, o.id, details);
  await notify(tx, await audience(tx, o), `${action} / ${o.title}`, o.id);
}
export async function createOrder(a: Actor, input: unknown) {
  const v = applicationSchema.parse(input);
  if (["AMV", "GMV", "VIDEO_CLIPS"].includes(v.type))
    need(v.music.trim(), "MUSIC_REQUIRED", 400);
  return db.transaction(async (tx) => {
    const [o] = await tx
      .insert(s.orders)
      .values({
        ...v,
        preferredMemberId: v.preferredMemberId || null,
        customerId: a.id,
      })
      .returning();
    await log(tx, a, "APPLICATION_CREATED", o.id);
    await notify(tx, await staffIds(tx), "NEW_APPLICATION / " + o.title, o.id);
    return o;
  });
}
export async function listOrders(a: Actor, mode: string) {
  let filter = eq(s.orders.customerId, a.id);
  if (mode === "staff") {
    need(isStaff(a));
    filter = sql`true` as any;
  }
  if (mode === "performer") {
    need(a.roles.includes("performer"));
    const [m] = await db
      .select()
      .from(s.members)
      .where(eq(s.members.userId, a.id));
    if (!m) return [];
    filter = eq(s.orders.memberId, m.id);
  }
  return db
    .select({
      id: s.orders.id,
      title: s.orders.title,
      type: s.orders.type,
      status: s.orders.status,
      paidAt: s.orders.paidAt,
      createdAt: s.orders.createdAt,
      updatedAt: s.orders.updatedAt,
    })
    .from(s.orders)
    .where(filter)
    .orderBy(desc(s.orders.updatedAt))
    .limit(200);
}
export async function detail(a: Actor, id: string) {
  const { o, m, isCustomer, isPerformer } = await orderAccess(a, id);
  const prepay = isPerformer && !isCustomer && !isStaff(a) && !o.paidAt;
  const quotes = await db
    .select()
    .from(s.quotes)
    .where(eq(s.quotes.orderId, id))
    .orderBy(desc(s.quotes.createdAt));
  const msg = prepay ? [] : await conversation(a, id);
  const files = prepay
    ? []
    : await db
        .select({
          id: s.files.id,
          name: s.files.name,
          mime: s.files.mime,
          size: s.files.size,
          kind: s.files.kind,
          createdAt: s.files.createdAt,
        })
        .from(s.files)
        .where(eq(s.files.orderId, id))
        .orderBy(asc(s.files.createdAt));
  const events = await db
    .select({ action: s.audit.action, createdAt: s.audit.createdAt })
    .from(s.audit)
    .where(eq(s.audit.orderId, id))
    .orderBy(desc(s.audit.createdAt))
    .limit(100);
  const assignments = await db
    .select()
    .from(s.assignments)
    .where(eq(s.assignments.orderId, id))
    .orderBy(desc(s.assignments.createdAt));
  const payments = prepay
    ? []
    : await db
        .select({
          id: s.payments.id,
          status: s.payments.status,
          amount: s.payments.amount,
          test: s.payments.test,
          paidAt: s.payments.paidAt,
          refundAmount: s.payments.refundAmount,
        })
        .from(s.payments)
        .where(eq(s.payments.orderId, id));
  return {
    order: prepay
      ? {
          id: o.id,
          title: o.title,
          type: o.type,
          brief: o.brief.slice(0, 2000),
          status: o.status,
          paidAt: null,
        }
      : o,
    member: m ? { id: m.id, name: m.name } : null,
    quotes: quotes.map((q) => {
      const { shareBps, termsSnapshot, ...rest } = q;
      return isStaff(a) || isPerformer ? { ...rest, shareBps } : rest;
    }),
    messages: msg,
    files,
    events: prepay ? [] : events,
    assignments: assignments.filter((x) => isStaff(a) || x.memberId === m?.id),
    payments,
    permissions: {
      staff: isStaff(a),
      admin: isAdmin(a),
      customer: isCustomer,
      performer: isPerformer,
      prepay,
    },
  };
}
export async function conversation(a: Actor, id: string, beforeId?: string) {
  const access = await orderAccess(a, id);
  need(
    isStaff(a) || access.isCustomer || (access.isPerformer && access.o.paidAt),
  );
  const team = isStaff(a) || access.isPerformer;
  const [before] = beforeId
    ? await db
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.id, beforeId),
            eq(s.messages.orderId, id),
            team ? undefined : eq(s.messages.internal, false),
          ),
        )
    : [];
  need(!beforeId || before, "NOT_FOUND", 404);
  const rows = await db
    .select({
      id: s.messages.id,
      body: s.messages.body,
      kind: s.messages.kind,
      links: s.messages.links,
      internal: s.messages.internal,
      createdAt: s.messages.createdAt,
      author: s.user.name,
      authorId: s.messages.authorId,
    })
    .from(s.messages)
    .innerJoin(s.user, eq(s.user.id, s.messages.authorId))
    .where(
      and(
        eq(s.messages.orderId, id),
        team ? undefined : eq(s.messages.internal, false),
        before
          ? sql`(${s.messages.createdAt},${s.messages.id}) < (${before.createdAt},${before.id})`
          : undefined,
      ),
    )
    .orderBy(desc(s.messages.createdAt), desc(s.messages.id))
    .limit(200);
  return rows.reverse();
}
// The order lock serializes actions on one order; the member lock prevents two orders taking the same slot.
export async function pick(
  tx: Tx,
  a: Actor | null,
  o: typeof s.orders.$inferSelect,
  manual?: string,
  replaceApproved = false,
) {
  need(!o.paidAt, "PAID_ASSIGNMENT_LOCKED", 409);
  const attempts = await tx
    .select()
    .from(s.assignments)
    .where(eq(s.assignments.orderId, o.id));
  const candidates = await tx
    .select({ m: s.members })
    .from(s.members)
    .innerJoin(s.specializations, eq(s.specializations.memberId, s.members.id))
    .innerJoin(s.user, eq(s.user.id, s.members.userId))
    .innerJoin(
      s.userRoles,
      and(eq(s.userRoles.userId, s.user.id), eq(s.userRoles.role, "performer")),
    )
    .where(
      and(
        eq(s.members.active, true),
        eq(s.members.available, true),
        eq(s.user.disabled, false),
        eq(s.user.emailVerified, true),
        eq(s.specializations.type, o.type),
        sql`${s.members.shareBps} is not null`,
        manual ? eq(s.members.id, manual) : undefined,
      ),
    );
  const target = manual || (!replaceApproved ? o.preferredMemberId : null);
  if (o.type === "OTHER" && !manual) {
    await update(
      tx,
      a,
      o,
      { status: "briefing" },
      "MANUAL_ASSIGNMENT_REQUIRED",
    );
    return;
  }
  let pool = candidates
    .map((x) => x.m)
    .filter(
      (m) =>
        (!target || m.id === target) &&
        (!!manual ||
          !attempts.some(
            (x) =>
              x.memberId === m.id && ["declined", "expired"].includes(x.status),
          )),
    );
  while (pool.length) {
    const i = randomInt(pool.length),
      m = pool.splice(i, 1)[0];
    const locked = await tx.execute(
      sql`select id from members where id=${m.id} and available=true and active=true for update skip locked`,
    );
    if (!locked.rowCount) continue;
    const [busy] = await tx
      .select()
      .from(s.slots)
      .where(eq(s.slots.memberId, m.id));
    if (busy) continue;
    const expiresAt = new Date(Date.now() + 24 * 3600000);
    await tx
      .insert(s.slots)
      .values({ memberId: m.id, orderId: o.id, expiresAt });
    await tx
      .insert(s.assignments)
      .values({ orderId: o.id, memberId: m.id, expiresAt });
    await update(
      tx,
      a,
      o,
      { memberId: m.id, status: "assigning" },
      "ASSIGNMENT_OFFERED",
    );
    await notify(tx, [m.userId!], "ASSIGNMENT_OFFERED / " + o.title, o.id);
    return;
  }
  await update(
    tx,
    a,
    o,
    { memberId: null, status: "briefing" },
    target ? "PREFERRED_UNAVAILABLE" : "NO_AVAILABLE_PERFORMER",
  );
}
export async function action(a: Actor, id: string, input: unknown) {
  const v = z
    .object({
      action: z.string(),
      body: z.string().max(30000).optional(),
      memberId: z.string().optional(),
      replacementApproved: z.boolean().optional(),
      brief: text.optional(),
      deliverables: text.optional(),
      amount: z.number().int().positive().max(1000000000).optional(),
      deadline: z.iso.datetime().optional(),
      links: links.optional(),
      internal: z.boolean().optional(),
      portfolioConsent: z.boolean().optional(),
      quoteId: z.string().optional(),
      proposalId: z.string().optional(),
      termsAccepted: z.boolean().optional(),
      startRequested: z.boolean().optional(),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from orders where id=${id} for update`);
    const { o, m, isCustomer, isPerformer } = await orderAccess(a, id, tx);
    const [q] = await tx
      .select()
      .from(s.quotes)
      .where(and(eq(s.quotes.orderId, id), eq(s.quotes.obsolete, false)));
    if (v.action === "message") {
      need(isStaff(a) || isCustomer || (isPerformer && o.paidAt));
      need(!v.internal || isStaff(a) || (isPerformer && o.paidAt));
      need(v.body?.trim(), "EMPTY_MESSAGE", 400);
      await tx.insert(s.messages).values({
        orderId: id,
        authorId: a.id,
        body: v.body!.trim(),
        internal: !!v.internal,
        links: v.links || [],
      });
      const recipients = v.internal
        ? [
            ...(await staffIds(tx)),
            ...(o.paidAt && m?.userId ? [m.userId] : []),
          ]
        : await audience(tx, o);
      await notify(
        tx,
        recipients.filter((x) => x !== a.id),
        "NEW_MESSAGE / " + o.title,
        id,
        true,
      );
      return;
    }
    if (v.action === "read") {
      need(isStaff(a) || isCustomer || (isPerformer && o.paidAt));
      await tx
        .insert(s.reads)
        .values({ userId: a.id, orderId: id })
        .onConflictDoUpdate({
          target: [s.reads.userId, s.reads.orderId],
          set: { readAt: new Date() },
        });
      await tx
        .update(s.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(s.notifications.userId, a.id),
            eq(s.notifications.orderId, id),
          ),
        );
      return;
    }
    if (v.action === "consent") {
      need(isCustomer);
      await update(
        tx,
        a,
        o,
        {
          portfolioConsent: !!v.portfolioConsent,
          portfolioConsentAt: v.portfolioConsent ? new Date() : null,
        },
        "PORTFOLIO_PERMISSION",
      );
      if (!v.portfolioConsent)
        await tx
          .update(s.portfolio)
          .set({ published: false })
          .where(eq(s.portfolio.orderId, id));
      return;
    }
    if (v.action === "assign") {
      need(isStaff(a));
      need(
        ["application", "briefing"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      need(!o.memberId, "ALREADY_ASSIGNED", 409);
      need(
        !o.preferredMemberId ||
          !v.memberId ||
          v.memberId === o.preferredMemberId ||
          v.replacementApproved,
        "REPLACEMENT_CONSENT_REQUIRED",
        400,
      );
      if (v.replacementApproved) {
        need(o.preferredMemberId && v.memberId, "INVALID_REPLACEMENT", 400);
        await tx
          .update(s.messages)
          .set({ kind: "replacement_superseded" })
          .where(
            and(
              eq(s.messages.orderId, id),
              eq(s.messages.kind, "replacement_proposal"),
            ),
          );
        await tx.insert(s.messages).values({
          orderId: id,
          authorId: a.id,
          body: v.memberId!,
          kind: "replacement_proposal",
        });
        await notify(
          tx,
          [o.customerId],
          "REPLACEMENT_PROPOSAL / " + o.title,
          id,
        );
        return;
      }
      await pick(tx, a, o, v.memberId);
      return;
    }
    if (v.action === "release_assignment") {
      need(isStaff(a));
      need(
        !o.paidAt &&
          o.memberId &&
          ["assigning", "briefing", "quoted", "awaiting_payment"].includes(
            o.status,
          ),
        "INVALID_STATE",
        409,
      );
      need(v.body?.trim(), "REASON_REQUIRED", 400);
      const [pending] = await tx
        .select()
        .from(s.payments)
        .where(
          and(eq(s.payments.orderId, id), eq(s.payments.status, "pending")),
        );
      need(!pending, "PAYMENT_PENDING", 409);
      await tx
        .update(s.assignments)
        .set({ status: "released" })
        .where(
          and(
            eq(s.assignments.orderId, id),
            sql`${s.assignments.status} in ('accepted','offered')`,
          ),
        );
      await tx
        .update(s.quotes)
        .set({ obsolete: true })
        .where(eq(s.quotes.orderId, id));
      await tx.delete(s.slots).where(eq(s.slots.orderId, id));
      await update(
        tx,
        a,
        o,
        { memberId: null, status: "briefing" },
        "ASSIGNMENT_RELEASED",
        { reason: v.body },
      );
      if (m?.userId)
        await notify(tx, [m.userId], "ASSIGNMENT_RELEASED / " + o.title, id);
      return;
    }
    if (v.action === "approve_replacement") {
      need(isCustomer);
      need(
        !o.memberId && ["application", "briefing"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      const [proposal] = await tx
        .select()
        .from(s.messages)
        .where(
          and(
            eq(s.messages.orderId, id),
            eq(s.messages.kind, "replacement_proposal"),
            eq(s.messages.id, v.proposalId || ""),
          ),
        )
        .orderBy(desc(s.messages.createdAt));
      need(proposal, "NO_REPLACEMENT", 400);
      await tx
        .update(s.messages)
        .set({ kind: "replacement_approved" })
        .where(eq(s.messages.id, proposal.id));
      await tx
        .update(s.orders)
        .set({ preferredMemberId: proposal.body })
        .where(eq(s.orders.id, id));
      await log(tx, a, "REPLACEMENT_APPROVED", id);
      await pick(
        tx,
        a,
        { ...o, preferredMemberId: proposal.body },
        proposal.body,
      );
      return;
    }
    if (v.action === "accept_assignment" || v.action === "decline_assignment") {
      need(isPerformer);
      need(o.status === "assigning", "INVALID_STATE", 409);
      const [assignment] = await tx
        .select()
        .from(s.assignments)
        .where(
          and(
            eq(s.assignments.orderId, id),
            eq(s.assignments.memberId, m!.id),
            eq(s.assignments.status, "offered"),
          ),
        );
      need(
        assignment && assignment.expiresAt > new Date(),
        "ASSIGNMENT_EXPIRED",
        409,
      );
      const accepted = v.action === "accept_assignment";
      await tx
        .update(s.assignments)
        .set({ status: accepted ? "accepted" : "declined" })
        .where(eq(s.assignments.id, assignment.id));
      if (accepted) {
        await tx
          .update(s.slots)
          .set({ expiresAt: new Date(Date.now() + 7 * 86400000) })
          .where(eq(s.slots.orderId, id));
        await update(tx, a, o, { status: "briefing" }, "ASSIGNMENT_ACCEPTED");
      } else {
        await tx.delete(s.slots).where(eq(s.slots.orderId, id));
        await update(
          tx,
          a,
          o,
          { memberId: null, status: "briefing" },
          "ASSIGNMENT_DECLINED",
        );
        await pick(tx, a, { ...o, memberId: null });
      }
      return;
    }
    if (v.action === "quote" || v.action === "amend") {
      need(isStaff(a));
      need(m && m.shareBps !== null, "PERFORMER_REQUIRED", 400);
      const amendment = v.action === "amend";
      need(
        amendment
          ? !!o.paidAt &&
              [
                "paid_waiting_start",
                "in_progress",
                "review",
                "revision",
                "payment_review",
              ].includes(o.status)
          : !o.paidAt && o.status === "briefing",
        "INVALID_STATE",
        409,
      );
      const [slot] = await tx
        .select()
        .from(s.slots)
        .where(eq(s.slots.orderId, id));
      need(slot || amendment, "ASSIGNMENT_EXPIRED", 409);
      if (!amendment) {
        const [accepted] = await tx
          .select()
          .from(s.assignments)
          .where(
            and(
              eq(s.assignments.orderId, id),
              eq(s.assignments.memberId, m!.id),
              eq(s.assignments.status, "accepted"),
            ),
          );
        need(accepted, "PERFORMER_REQUIRED", 409);
      }
      need(
        v.brief && v.deliverables && v.deadline && v.amount,
        "QUOTE_INCOMPLETE",
        400,
      );
      need(new Date(v.deadline!) > new Date(), "DEADLINE_PAST", 400);
      if (amendment)
        need(q && v.amount === q.amount, "USE_ADDITIONAL_APPLICATION", 400);
      const [pending] = await tx
        .select()
        .from(s.payments)
        .where(
          and(eq(s.payments.orderId, id), eq(s.payments.status, "pending")),
        );
      need(!pending, "PAYMENT_PENDING", 409);
      if (q)
        await tx
          .update(s.quotes)
          .set({ obsolete: true })
          .where(eq(s.quotes.id, q.id));
      const expiresAt = new Date(Date.now() + 7 * 86400000);
      const [newQuote] = await tx
        .insert(s.quotes)
        .values({
          orderId: id,
          memberId: m!.id,
          brief: v.brief!,
          deliverables: v.deliverables!,
          amount: v.amount!,
          shareBps: amendment ? q.shareBps : m!.shareBps!,
          deadline: new Date(v.deadline!),
          expiresAt,
          amendment,
          startRequested: amendment ? q.startRequested : false,
          termsVersion,
          termsSnapshot: offers[o.language as "ru" | "en"],
        })
        .returning();
      if (!amendment)
        await tx
          .update(s.slots)
          .set({ expiresAt })
          .where(eq(s.slots.orderId, id));
      await update(
        tx,
        a,
        o,
        amendment ? {} : { status: "quoted" },
        amendment ? "AMENDMENT_PROPOSED" : "QUOTE_CREATED",
        { quoteId: newQuote.id },
      );
      return;
    }
    if (v.action === "reject_amendment") {
      need(isCustomer);
      need(q?.amendment && !q.acceptedAt, "INVALID_STATE", 409);
      await tx
        .update(s.quotes)
        .set({ obsolete: true })
        .where(eq(s.quotes.id, q.id));
      const [previous] = await tx
        .select()
        .from(s.quotes)
        .where(
          and(
            eq(s.quotes.orderId, id),
            sql`${s.quotes.acceptedAt} is not null`,
          ),
        )
        .orderBy(desc(s.quotes.createdAt));
      need(previous, "INVALID_STATE", 409);
      await tx
        .update(s.quotes)
        .set({ obsolete: false })
        .where(eq(s.quotes.id, previous.id));
      await log(tx, a, "AMENDMENT_REJECTED", id);
      return;
    }
    if (v.action === "accept_quote") {
      need(isCustomer);
      need(v.termsAccepted, "TERMS_REQUIRED", 400);
      need(
        q && q.id === v.quoteId && q.expiresAt > new Date() && !q.acceptedAt,
        "QUOTE_EXPIRED",
        409,
      );
      if (!q.amendment) {
        need(o.status === "quoted", "INVALID_STATE", 409);
        const [slot] = await tx
          .select()
          .from(s.slots)
          .where(eq(s.slots.orderId, id));
        need(slot, "ASSIGNMENT_EXPIRED", 409);
      }
      await tx
        .update(s.quotes)
        .set({
          acceptedAt: new Date(),
          startRequested: q.amendment ? q.startRequested : !!v.startRequested,
        })
        .where(eq(s.quotes.id, q.id));
      await update(
        tx,
        a,
        o,
        {
          brief: q.brief,
          ...(!q.amendment ? { status: "awaiting_payment" as const } : {}),
        },
        q.amendment ? "AMENDMENT_ACCEPTED" : "QUOTE_ACCEPTED",
      );
      return;
    }
    if (v.action === "start_work") {
      need(
        o.paidAt && o.status === "paid_waiting_start" && q?.acceptedAt,
        "INVALID_STATE",
        409,
      );
      need(isCustomer || isStaff(a));
      if (isStaff(a) && !isCustomer)
        need(v.body?.trim(), "REASON_REQUIRED", 400);
      if (isCustomer)
        await tx
          .update(s.quotes)
          .set({ startRequested: true })
          .where(eq(s.quotes.id, q.id));
      await update(
        tx,
        a,
        o,
        { status: "in_progress" },
        "WORK_START_AUTHORIZED",
        { reason: isCustomer ? "separate_client_request" : v.body },
      );
      return;
    }
    if (v.action === "preview" || v.action === "final") {
      need(isPerformer || isStaff(a));
      need(
        o.paidAt && ["in_progress", "review", "revision"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      need(v.body?.trim() || v.links?.length, "DELIVERY_REQUIRED", 400);
      await tx.insert(s.messages).values({
        orderId: id,
        authorId: a.id,
        body: v.body || "",
        kind: v.action,
        links: v.links || [],
      });
      await update(
        tx,
        a,
        o,
        { status: v.action === "final" ? "review" : o.status },
        v.action === "final" ? "FINAL_DELIVERED" : "PREVIEW_DELIVERED",
      );
      return;
    }
    if (v.action === "defect") {
      need(isCustomer);
      need(
        o.paidAt &&
          ["review", "in_progress", "revision", "completed"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      need(v.body?.trim(), "EMPTY_MESSAGE", 400);
      await tx
        .insert(s.messages)
        .values({ orderId: id, authorId: a.id, body: v.body!, kind: "defect" });
      await log(tx, a, "DEFECT_REPORTED", id);
      await notify(
        tx,
        await audience(tx, o),
        "DEFECT_REPORTED / " + o.title,
        id,
      );
      return;
    }
    if (v.action === "correction") {
      need(isStaff(a));
      need(
        o.paidAt && ["review", "in_progress", "revision"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      need(v.body?.trim(), "REASON_REQUIRED", 400);
      await update(tx, a, o, { status: "revision" }, "CORRECTION_REQUESTED", {
        reason: v.body,
      });
      return;
    }
    if (v.action === "revision") {
      need(isCustomer);
      need(
        o.paidAt && ["review", "in_progress"].includes(o.status),
        "INVALID_STATE",
        409,
      );
      need(q && o.revisionRounds < q.includedRounds, "REVISION_LIMIT", 409);
      need(v.body?.trim(), "EMPTY_MESSAGE", 400);
      await tx.insert(s.messages).values({
        orderId: id,
        authorId: a.id,
        body: v.body!,
        kind: "revision",
      });
      await update(
        tx,
        a,
        o,
        { status: "revision", revisionRounds: o.revisionRounds + 1 },
        "REVISION_REQUESTED",
      );
      return;
    }
    if (v.action === "complete") {
      need(isCustomer || isAdmin(a));
      need(
        o.status === "review" && o.paidAt && q?.acceptedAt,
        "INVALID_STATE",
        409,
      );
      need(isCustomer || v.body?.trim(), "REASON_REQUIRED", 400);
      const [originalPayment] = await tx
        .select()
        .from(s.payments)
        .where(and(eq(s.payments.orderId, id), eq(s.payments.status, "paid")));
      need(originalPayment, "PAYMENT_REQUIRED", 409);
      await tx
        .insert(s.ledger)
        .values({
          memberId: q.memberId,
          orderId: id,
          amount: share(q.amount, q.shareBps),
          reason: "completion",
          test: originalPayment.test,
          key: "completion:" + id,
        })
        .onConflictDoNothing();
      await tx.delete(s.slots).where(eq(s.slots.orderId, id));
      await update(
        tx,
        a,
        o,
        { status: "completed", completedAt: new Date() },
        "ORDER_COMPLETED",
        { reason: v.body || "client_acceptance" },
      );
      return;
    }
    if (v.action === "cancel_request") {
      need(isCustomer || isStaff(a));
      need(
        !["completed", "canceled", "refunded", "cancel_requested"].includes(
          o.status,
        ),
        "INVALID_STATE",
        409,
      );
      need(v.body?.trim(), "REASON_REQUIRED", 400);
      await tx.insert(s.messages).values({
        orderId: id,
        authorId: a.id,
        body: v.body!,
        kind: "cancellation",
      });
      await update(
        tx,
        a,
        o,
        { status: "cancel_requested" },
        "CANCELLATION_REQUESTED",
      );
      return;
    }
    if (v.action === "cancel") {
      need(isStaff(a));
      need(!o.paidAt, "REFUND_REQUIRED", 409);
      need(v.body?.trim(), "REASON_REQUIRED", 400);
      const [p] = await tx
        .select()
        .from(s.payments)
        .where(
          and(eq(s.payments.orderId, id), eq(s.payments.status, "pending")),
        );
      need(!p, "PAYMENT_PENDING", 409);
      await tx.delete(s.slots).where(eq(s.slots.orderId, id));
      await update(tx, a, o, { status: "canceled" }, "ORDER_CANCELED", {
        reason: v.body,
      });
      return;
    }
    throw new AppError("UNKNOWN_ACTION", 400);
  });
}
