import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { type Actor, need, orderAccess, isAdmin } from "../security";
import { required, testMode } from "../env";
import { notify, staffIds } from "../mail";
import { log } from "./orders";
import { money, share } from "../../shared/types";
const algorithm = () => process.env.ROBOKASSA_HASH || "sha256";
export const digest = (value: string) =>
  createHash(algorithm()).update(value).digest("hex");
function password(n: 1 | 2, test: boolean) {
  return required(`ROBOKASSA_${test ? "TEST_" : ""}PASSWORD${n}`);
}
export function validResult(params: URLSearchParams, test: boolean) {
  const extra = [...params.entries()]
    .filter(([k]) => k.startsWith("Shp_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const expected = digest(
    [
      params.get("OutSum"),
      params.get("InvId"),
      password(2, test),
      ...extra,
    ].join(":"),
  );
  const supplied = params.get("SignatureValue")?.toLowerCase() || "";
  return (
    /^[a-f0-9]+$/.test(supplied) &&
    supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  );
}
export function receipt(title: string, amount: number, final = false) {
  return {
    sno: "usn_income",
    items: [
      {
        name: title.slice(0, 128),
        quantity: 1,
        sum: amount / 100,
        payment_method: final ? "full_payment" : "full_prepayment",
        payment_object: "service",
        tax: required("ROBOKASSA_VAT"),
      },
    ],
  };
}
export async function checkout(a: Actor, id: string) {
  need(
    process.env.ROBOKASSA_LOGIN &&
      process.env.ROBOKASSA_VAT &&
      process.env[`ROBOKASSA_${testMode ? "TEST_" : ""}PASSWORD1`] &&
      process.env[`ROBOKASSA_${testMode ? "TEST_" : ""}PASSWORD2`],
    "PAYMENT_SETUP_REQUIRED",
    503,
  );
  const login = required("ROBOKASSA_LOGIN");
  if (!testMode)
    need(
      process.env.PAYMENTS_LIVE_READY === "true",
      "PAYMENT_SETUP_REQUIRED",
      503,
    );
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from orders where id=${id} for update`);
    const { o, isCustomer } = await orderAccess(a, id, tx);
    need(isCustomer);
    need(o.status === "awaiting_payment" && !o.paidAt, "INVALID_STATE", 409);
    const [q] = await tx
      .select()
      .from(s.quotes)
      .where(and(eq(s.quotes.orderId, id), eq(s.quotes.obsolete, false)));
    need(q?.acceptedAt && q.expiresAt > new Date(), "QUOTE_EXPIRED", 409);
    const [slot] = await tx
      .select()
      .from(s.slots)
      .where(eq(s.slots.orderId, id));
    need(slot, "ASSIGNMENT_EXPIRED", 409);
    await tx
      .insert(s.payments)
      .values({ orderId: id, quoteId: q.id, amount: q.amount, test: testMode })
      .onConflictDoNothing();
    const [p] = await tx
      .select()
      .from(s.payments)
      .where(eq(s.payments.quoteId, q.id));
    need(p.status === "pending", "ALREADY_PAID", 409);
    const out = (p.amount / 100).toFixed(2),
      rec = encodeURIComponent(
        JSON.stringify(receipt(`${o.type}: ${o.title}`, p.amount)),
      ),
      shp = `Shp_order=${id}`;
    const signature = digest(
      [login, out, String(p.id), rec, password(1, p.test), shp].join(":"),
    );
    const params = {
      MerchantLogin: login,
      OutSum: out,
      InvId: String(p.id),
      Description: `RE:STATIC ${o.title}`.slice(0, 100),
      Receipt: rec,
      SignatureValue: signature,
      Email: a.email,
      Culture: o.language,
      Shp_order: id,
      ...(p.test ? { IsTest: "1" } : {}),
    };
    await log(tx, a, "PAYMENT_STARTED", id, { paymentId: p.id, test: p.test });
    return { url: "https://auth.robokassa.ru/Merchant/Index.aspx", params };
  });
}
export async function result(params: URLSearchParams) {
  const id = Number(params.get("InvId"));
  need(Number.isSafeInteger(id) && id > 0, "INVALID_PAYMENT", 400);
  const [p] = await db.select().from(s.payments).where(eq(s.payments.id, id));
  need(p, "INVALID_PAYMENT", 400);
  need(validResult(params, p.test), "INVALID_SIGNATURE", 400);
  need(money(params.get("OutSum") || "") === p.amount, "AMOUNT_MISMATCH", 400);
  need(params.get("Shp_order") === p.orderId, "INVALID_PAYMENT", 400);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from orders where id=${p.orderId} for update`,
    );
    const [locked] = await tx
      .select()
      .from(s.payments)
      .where(eq(s.payments.id, id));
    if (locked.status === "paid" || locked.status === "refunded") return;
    const [o] = await tx
      .select()
      .from(s.orders)
      .where(eq(s.orders.id, p.orderId));
    const [q] = await tx
      .select()
      .from(s.quotes)
      .where(eq(s.quotes.id, p.quoteId));
    const [slot] = await tx
      .select()
      .from(s.slots)
      .where(eq(s.slots.orderId, o.id));
    const review =
      q.obsolete ||
      !slot ||
      slot.memberId !== q.memberId ||
      o.status !== "awaiting_payment";
    await tx
      .update(s.payments)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(s.payments.id, id));
    await tx
      .update(s.orders)
      .set({
        paidAt: new Date(),
        status: review
          ? "payment_review"
          : q.startRequested
            ? "in_progress"
            : "paid_waiting_start",
        updatedAt: new Date(),
      })
      .where(eq(s.orders.id, o.id));
    if (slot)
      await tx
        .update(s.slots)
        .set({ expiresAt: null })
        .where(eq(s.slots.orderId, o.id));
    await log(
      tx,
      null,
      review ? "PAYMENT_REVIEW_REQUIRED" : "PAYMENT_CONFIRMED",
      o.id,
      { paymentId: id, test: p.test },
    );
    const [m] = o.memberId
      ? await tx.select().from(s.members).where(eq(s.members.id, o.memberId))
      : [];
    await notify(
      tx,
      [o.customerId, ...(await staffIds(tx)), ...(m?.userId ? [m.userId] : [])],
      review ? "PAYMENT_REVIEW_REQUIRED" : "PAYMENT_CONFIRMED",
      o.id,
    );
  });
  return `OK${id}`;
}
export async function recordRefund(
  a: Actor,
  orderId: string,
  amount: number,
  reference: string,
) {
  need(isAdmin(a));
  need(
    Number.isSafeInteger(amount) && amount > 0 && reference.trim(),
    "INVALID_REFUND",
    400,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from orders where id=${orderId} for update`);
    const { o } = await orderAccess(a, orderId, tx);
    const [p] = await tx
      .select()
      .from(s.payments)
      .where(
        and(eq(s.payments.orderId, orderId), eq(s.payments.status, "paid")),
      );
    need(p, "PAYMENT_REQUIRED", 409);
    need(amount <= p.amount - p.refundAmount, "INVALID_REFUND", 400);
    const [q] = await tx
      .select()
      .from(s.quotes)
      .where(eq(s.quotes.id, p.quoteId));
    await tx.execute(
      sql`select id from members where id=${q.memberId} for update`,
    );
    const total = p.refundAmount + amount;
    const [credited] = await tx
      .select()
      .from(s.ledger)
      .where(eq(s.ledger.key, "completion:" + orderId));
    if (credited) {
      const previous = share(p.refundAmount, q.shareBps),
        next = share(total, q.shareBps);
      await tx
        .insert(s.ledger)
        .values({
          memberId: q.memberId,
          orderId,
          amount: -(next - previous),
          reason: "refund",
          test: p.test,
          key: `refund:${p.id}:${total}`,
        });
    }
    await tx
      .update(s.payments)
      .set({
        refundAmount: total,
        refundReference: reference,
        status: total === p.amount ? "refunded" : "paid",
      })
      .where(eq(s.payments.id, p.id));
    await tx.delete(s.slots).where(eq(s.slots.orderId, orderId));
    await tx
      .update(s.orders)
      .set({
        status: total === p.amount ? "refunded" : "canceled",
        updatedAt: new Date(),
      })
      .where(eq(s.orders.id, orderId));
    await log(tx, a, "REFUND_RECORDED", orderId, { amount, reference });
    await notify(
      tx,
      [o.customerId, ...(await staffIds(tx))],
      "REFUND_RECORDED",
      orderId,
    );
  });
}

export async function recheckReceipt(a: Actor, id: number) {
  need(isAdmin(a));
  const [r] = await db.select().from(s.receipts).where(eq(s.receipts.id, id));
  need(r && ["failed", "submitted"].includes(r.status), "INVALID_STATE", 409);
  await db.transaction(async (tx) => {
    await tx
      .update(s.receipts)
      .set({ status: "submitted", availableAt: new Date() })
      .where(eq(s.receipts.id, id));
    await log(tx, a, "RECEIPT_RECHECK_REQUESTED", undefined, { receiptId: id });
  });
}
