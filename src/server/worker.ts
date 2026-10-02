import { and, desc, eq, inArray, lte, sql, isNull } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, pool } from "./db";
import * as s from "./db/schema";
import { baseUrl, required } from "./env";
import { digest, receipt } from "./services/payments";
import { notify, staffIds } from "./mail";
import { log, pick } from "./services/orders";
export async function expire() {
  const due = await db
    .select()
    .from(s.slots)
    .where(lte(s.slots.expiresAt, new Date()));
  for (const slot of due)
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from orders where id=${slot.orderId} for update`,
      );
      const [current] = await tx
        .select()
        .from(s.slots)
        .where(eq(s.slots.orderId, slot.orderId));
      if (!current?.expiresAt || current.expiresAt > new Date()) return;
      const [o] = await tx
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, slot.orderId));
      if (o.paidAt) {
        await tx
          .update(s.slots)
          .set({ expiresAt: null })
          .where(eq(s.slots.orderId, o.id));
        return;
      }
      await tx
        .update(s.assignments)
        .set({ status: o.status === "assigning" ? "expired" : "released" })
        .where(
          and(
            eq(s.assignments.orderId, o.id),
            inArray(s.assignments.status, ["offered", "accepted"]),
          ),
        );
      await tx
        .update(s.quotes)
        .set({ obsolete: true })
        .where(eq(s.quotes.orderId, o.id));
      await tx
        .update(s.payments)
        .set({ status: "expired" })
        .where(
          and(eq(s.payments.orderId, o.id), eq(s.payments.status, "pending")),
        );
      await tx.delete(s.slots).where(eq(s.slots.orderId, o.id));
      await tx
        .update(s.orders)
        .set({ memberId: null, status: "briefing", updatedAt: new Date() })
        .where(eq(s.orders.id, o.id));
      await log(tx, null, "ASSIGNMENT_EXPIRED", o.id);
      await notify(
        tx,
        [o.customerId, ...(await staffIds(tx))],
        "ASSIGNMENT_EXPIRED",
        o.id,
      );
      if (o.status === "assigning")
        await pick(tx, null, { ...o, memberId: null, status: "briefing" });
    });
  const amendments = await db
    .select()
    .from(s.quotes)
    .where(
      and(
        eq(s.quotes.amendment, true),
        eq(s.quotes.obsolete, false),
        isNull(s.quotes.acceptedAt),
        lte(s.quotes.expiresAt, new Date()),
      ),
    );
  for (const q of amendments)
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from orders where id=${q.orderId} for update`,
      );
      const [current] = await tx
        .select()
        .from(s.quotes)
        .where(eq(s.quotes.id, q.id));
      if (current.obsolete || current.acceptedAt) return;
      const [previous] = await tx
        .select()
        .from(s.quotes)
        .where(
          and(
            eq(s.quotes.orderId, q.orderId),
            sql`${s.quotes.acceptedAt} is not null`,
          ),
        )
        .orderBy(sql`${s.quotes.createdAt} desc`);
      if (!previous) return;
      await tx
        .update(s.quotes)
        .set({ obsolete: true })
        .where(eq(s.quotes.id, q.id));
      await tx
        .update(s.quotes)
        .set({ obsolete: false })
        .where(eq(s.quotes.id, previous.id));
      await log(tx, null, "AMENDMENT_EXPIRED", q.orderId);
    });
  // Client reminders are deduplicated per day; they never accept an order.
  const reviews = await db
    .select()
    .from(s.orders)
    .where(
      and(
        eq(s.orders.status, "review"),
        lte(s.orders.updatedAt, new Date(Date.now() - 3 * 86400000)),
      ),
    );
  for (const o of reviews)
    await db.transaction(async (tx) => {
      await notify(
        tx,
        [o.customerId],
        `REVIEW_REMINDER / ${o.title}`,
        o.id,
        false,
        `review:${o.id}:${new Date().toISOString().slice(0, 10)}`,
      );
    });
  const agreedQuotes = db
    .selectDistinctOn([s.quotes.orderId], {
      orderId: s.quotes.orderId,
      deadline: s.quotes.deadline,
    })
    .from(s.quotes)
    .where(sql`${s.quotes.acceptedAt} is not null`)
    .orderBy(s.quotes.orderId, desc(s.quotes.createdAt))
    .as("agreed_quotes");
  const overdue = await db
    .select({ o: s.orders })
    .from(s.orders)
    .innerJoin(agreedQuotes, eq(agreedQuotes.orderId, s.orders.id))
    .where(
      and(
        inArray(s.orders.status, ["in_progress", "revision"]),
        lte(agreedQuotes.deadline, new Date()),
      ),
    );
  for (const { o } of overdue)
    await db.transaction(async (tx) => {
      const [m] = o.memberId
        ? await tx.select().from(s.members).where(eq(s.members.id, o.memberId))
        : [];
      await notify(
        tx,
        [...(await staffIds(tx)), ...(m?.userId ? [m.userId] : [])],
        `DEADLINE_REMINDER / ${o.title}`,
        o.id,
        false,
        `deadline:${o.id}:${new Date().toISOString().slice(0, 10)}`,
      );
    });
}
export async function deliverMail() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: required("SMTP_PASSWORD"),
          },
        }
      : {}),
  });
  const due = await db
    .select()
    .from(s.mailQueue)
    .where(
      and(isNull(s.mailQueue.sentAt), lte(s.mailQueue.availableAt, new Date())),
    )
    .limit(100);
  const groups = new Map<string, typeof due>();
  for (const row of due) {
    if (row.notificationId) {
      const [n] = await db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.id, row.notificationId));
      if (n?.readAt) {
        await db
          .update(s.mailQueue)
          .set({ sentAt: new Date() })
          .where(eq(s.mailQueue.id, row.id));
        continue;
      }
    }
    const key = row.notificationId ? row.to : row.id;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const group of groups.values())
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: group[0].to,
        subject:
          group.length > 1
            ? "RE:STATIC — новые события / Updates"
            : group[0].subject,
        text: group.map((r) => r.body).join("\n\n"),
      });
      await db
        .update(s.mailQueue)
        .set({ sentAt: new Date(), lastError: null })
        .where(
          inArray(
            s.mailQueue.id,
            group.map((r) => r.id),
          ),
        );
    } catch (e) {
      for (const row of group)
        await db
          .update(s.mailQueue)
          .set({
            attempts: row.attempts + 1,
            lastError: "SMTP_DELIVERY_FAILED",
            availableAt: new Date(
              Date.now() +
                Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7)),
            ),
          })
          .where(eq(s.mailQueue.id, row.id));
      console.error("SMTP delivery failed");
    }
  transport.close();
}
export async function fiscalize() {
  const completed = await db
    .select({ p: s.payments })
    .from(s.payments)
    .innerJoin(s.orders, eq(s.orders.id, s.payments.orderId))
    .where(
      and(eq(s.orders.status, "completed"), eq(s.payments.status, "paid")),
    );
  for (const { p } of completed)
    await db
      .insert(s.receipts)
      .values({ paymentId: p.id, status: p.test ? "test" : "pending" })
      .onConflictDoNothing();
  const due = await db
    .select()
    .from(s.receipts)
    .where(
      and(
        eq(s.receipts.status, "pending"),
        lte(s.receipts.availableAt, new Date()),
      ),
    );
  for (const r of due)
    try {
      const [p] = await db
        .select()
        .from(s.payments)
        .where(eq(s.payments.id, r.paymentId));
      const [o] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, p.orderId));
      const [u] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.id, o.customerId));
      const payload = {
        merchantId: required("ROBOKASSA_LOGIN"),
        id: String(r.id),
        originId: String(p.id),
        operation: "sell",
        url: baseUrl,
        total: p.amount / 100,
        ...receipt(`${o.type}: ${o.title}`, p.amount, true),
        client: { email: u.email },
        payments: [{ type: 2, sum: p.amount / 100 }],
      };
      const body = Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/=/g, "");
      const signature = Buffer.from(
        digest(body + required("ROBOKASSA_PASSWORD1")),
      )
        .toString("base64")
        .replace(/=/g, "");
      const response = await fetch(
        "https://ws.roboxchange.com/RoboFiscal/Receipt/Attach",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `${body}.${signature}`,
          signal: AbortSignal.timeout(30000),
        },
      );
      const json = await response.json();
      if (
        !response.ok ||
        !["0", "1", "2", "3"].includes(String(json.ResultCode))
      )
        throw new Error("Receipt failed");
      await db
        .update(s.receipts)
        .set({
          status:
            String(json.ResultCode) === "2"
              ? "registered"
              : String(json.ResultCode) === "3"
                ? "failed"
                : "submitted",
          lastError:
            String(json.ResultCode) === "3"
              ? "RECEIPT_REGISTRATION_FAILED"
              : null,
          availableAt: new Date(Date.now() + 60000),
        })
        .where(eq(s.receipts.id, r.id));
    } catch {
      await db
        .update(s.receipts)
        .set({
          attempts: r.attempts + 1,
          lastError: "RECEIPT_SUBMISSION_FAILED",
          availableAt: new Date(
            Date.now() +
              Math.min(3600000, 60000 * 2 ** Math.min(r.attempts, 6)),
          ),
        })
        .where(eq(s.receipts.id, r.id));
    }
  const submitted = await db
    .select()
    .from(s.receipts)
    .where(
      and(
        eq(s.receipts.status, "submitted"),
        lte(s.receipts.availableAt, new Date()),
      ),
    );
  for (const r of submitted)
    try {
      const payload = {
        merchantId: required("ROBOKASSA_LOGIN"),
        id: String(r.id),
      };
      const body = Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/=/g, "");
      const signature = Buffer.from(
        digest(body + required("ROBOKASSA_PASSWORD1")),
      )
        .toString("base64")
        .replace(/=/g, "");
      const response = await fetch(
        "https://ws.roboxchange.com/RoboFiscal/Receipt/Status",
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: `${body}.${signature}`,
          signal: AbortSignal.timeout(30000),
        },
      );
      const json = await response.json();
      if (
        !response.ok ||
        String(json.Code) !== "0" ||
        !Array.isArray(json.Statuses)
      )
        throw new Error("Invalid fiscal status");
      const codes = json.Statuses.map((v: { Code: string }) => v.Code);
      const failed = codes.some((v: string) =>
        ["Fail", "NotProvided"].includes(v),
      );
      await db
        .update(s.receipts)
        .set({
          status: failed
            ? "failed"
            : codes.includes("Done")
              ? "registered"
              : "submitted",
          lastError: failed ? "RECEIPT_REGISTRATION_FAILED" : null,
          availableAt: new Date(Date.now() + 60000),
        })
        .where(eq(s.receipts.id, r.id));
    } catch {
      await db
        .update(s.receipts)
        .set({
          attempts: r.attempts + 1,
          lastError: "RECEIPT_STATUS_FAILED",
          availableAt: new Date(Date.now() + 300000),
        })
        .where(eq(s.receipts.id, r.id));
    }
}
export async function tick() {
  const connection = await pool.connect();
  try {
    const { rows } = await connection.query(
      "select pg_try_advisory_lock(884431) as locked",
    );
    if (!rows[0].locked) return;
    try {
      await expire();
      await deliverMail();
      await fiscalize();
    } finally {
      await connection.query("select pg_advisory_unlock(884431)");
    }
  } finally {
    connection.release();
  }
}
