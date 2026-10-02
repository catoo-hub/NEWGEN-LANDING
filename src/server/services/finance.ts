import { and, eq, sql, desc } from "drizzle-orm";
import { db, type Tx } from "../db";
import * as s from "../db/schema";
import {
  type Actor,
  need,
  myMember,
  isAdmin,
  encrypt,
  decrypt,
} from "../security";
import { testMode } from "../env";
import { share } from "../../shared/types";
import { log } from "./orders";
import { notify, staffIds } from "../mail";
export async function balance(
  memberId: string,
  tx: Tx | typeof db = db,
  test = testMode,
) {
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(${s.ledger.amount}),0)::bigint` })
    .from(s.ledger)
    .where(and(eq(s.ledger.memberId, memberId), eq(s.ledger.test, test)));
  const rows = await tx
    .select()
    .from(s.withdrawals)
    .where(
      and(
        eq(s.withdrawals.memberId, memberId),
        eq(s.withdrawals.status, "requested"),
        eq(s.withdrawals.test, test),
      ),
    );
  const reserved = rows.reduce((v, r) => v + r.amount, 0);
  return {
    total: Number(total),
    reserved,
    available: Number(total) - reserved,
  };
}
export async function finances(a: Actor) {
  const m = await myMember(a),
    b = await balance(m.id);
  const ledger = await db
    .select()
    .from(s.ledger)
    .where(and(eq(s.ledger.memberId, m.id), eq(s.ledger.test, testMode)))
    .orderBy(desc(s.ledger.createdAt));
  const withdrawals = await db
    .select()
    .from(s.withdrawals)
    .where(
      and(eq(s.withdrawals.memberId, m.id), eq(s.withdrawals.test, testMode)),
    )
    .orderBy(desc(s.withdrawals.createdAt));
  const pending = await db
    .select({ q: s.quotes, o: s.orders })
    .from(s.quotes)
    .innerJoin(s.orders, eq(s.orders.id, s.quotes.orderId))
    .innerJoin(
      s.payments,
      and(
        eq(s.payments.orderId, s.orders.id),
        eq(s.payments.test, testMode),
        eq(s.payments.status, "paid"),
      ),
    )
    .where(
      and(
        eq(s.quotes.memberId, m.id),
        eq(s.quotes.obsolete, false),
        sql`${s.orders.paidAt} is not null`,
        sql`${s.orders.status} not in ('completed','canceled','refunded')`,
      ),
    );
  return {
    ...b,
    test: testMode,
    expected: pending.reduce((v, { q }) => v + share(q.amount, q.shareBps), 0),
    paidOut: -ledger
      .filter((r) => r.reason === "withdrawal")
      .reduce((v, r) => v + r.amount, 0),
    ledger,
    withdrawals: withdrawals.map(({ details, ...r }) => r),
  };
}
export async function requestWithdrawal(
  a: Actor,
  amount: number,
  details: string,
) {
  need(
    Number.isSafeInteger(amount) &&
      amount > 0 &&
      amount <= 1000000000 &&
      details.trim().length >= 5 &&
      details.length <= 2000,
    "INVALID_WITHDRAWAL",
    400,
  );
  return db.transaction(async (tx) => {
    const m = await myMember(a, tx);
    await tx.execute(sql`select id from members where id=${m.id} for update`);
    const b = await balance(m.id, tx);
    need(amount <= b.available, "INSUFFICIENT_BALANCE", 409);
    const [w] = await tx
      .insert(s.withdrawals)
      .values({
        memberId: m.id,
        amount,
        test: testMode,
        details: encrypt(details.trim()),
      })
      .returning();
    await log(tx, a, "WITHDRAWAL_REQUESTED", undefined, { id: w.id, amount });
    await notify(tx, await staffIds(tx), "WITHDRAWAL_REQUESTED");
    return { id: w.id };
  });
}
export async function decideWithdrawal(
  a: Actor,
  id: string,
  decision: "paid" | "rejected",
  reference: string,
) {
  need(isAdmin(a));
  need(reference.trim(), "REASON_REQUIRED", 400);
  return db.transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(s.withdrawals)
      .where(eq(s.withdrawals.id, id));
    need(initial, "NOT_FOUND", 404);
    await tx.execute(
      sql`select id from members where id=${initial.memberId} for update`,
    );
    const [w] = await tx
      .select()
      .from(s.withdrawals)
      .where(eq(s.withdrawals.id, id));
    need(w.status === "requested", "WITHDRAWAL_ALREADY_DECIDED", 409);
    if (decision === "paid") {
      const b = await balance(w.memberId, tx, w.test);
      need(b.total >= b.reserved, "INSUFFICIENT_BALANCE", 409);
      await tx
        .insert(s.ledger)
        .values({
          memberId: w.memberId,
          amount: -w.amount,
          reason: "withdrawal",
          test: w.test,
          key: "withdrawal:" + w.id,
        });
    }
    await tx
      .update(s.withdrawals)
      .set({
        status: decision,
        reference,
        decidedBy: a.id,
        decidedAt: new Date(),
      })
      .where(eq(s.withdrawals.id, id));
    await log(tx, a, "WITHDRAWAL_" + decision.toUpperCase(), undefined, {
      id,
      reference,
    });
    const [m] = await tx
      .select()
      .from(s.members)
      .where(eq(s.members.id, w.memberId));
    if (m.userId)
      await notify(tx, [m.userId], "WITHDRAWAL_" + decision.toUpperCase());
  });
}
export async function adminFinances(a: Actor) {
  need(isAdmin(a));
  const list = await db
    .select({ w: s.withdrawals, name: s.members.name })
    .from(s.withdrawals)
    .innerJoin(s.members, eq(s.members.id, s.withdrawals.memberId))
    .orderBy(desc(s.withdrawals.createdAt))
    .limit(200);
  const payments = await db
    .select()
    .from(s.payments)
    .orderBy(desc(s.payments.createdAt))
    .limit(200);
  const receipts = await db
    .select()
    .from(s.receipts)
    .orderBy(desc(s.receipts.createdAt))
    .limit(200);
  return {
    withdrawals: list.map(({ w, name }) => ({
      ...w,
      name,
      details: decrypt(w.details),
    })),
    payments,
    receipts,
  };
}
