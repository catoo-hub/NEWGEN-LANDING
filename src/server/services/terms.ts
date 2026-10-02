import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { type Actor, isStaff, need, orderAccess } from "../security";

export async function orderTerms(a: Actor, orderId: string, quoteId: string) {
  const { o, isCustomer, isPerformer } = await orderAccess(a, orderId);
  need(isCustomer || isStaff(a) || (isPerformer && o.paidAt));
  const [q] = await db
    .select()
    .from(s.quotes)
    .where(and(eq(s.quotes.id, quoteId), eq(s.quotes.orderId, orderId)));
  need(q, "NOT_FOUND", 404);
  const ru = o.language === "ru";
  const text = (r: string, e: string) => (ru ? r : e);
  const snapshot = q.termsSnapshot as {
    title: string;
    sections: { title: string; paragraphs: string[] }[];
  };
  const document = [
    `RE:STATIC — ${text("условия заказа", "order terms")}`,
    `${text("Заказ", "Order")}: ${o.id} / ${o.title}`,
    `${text("Страна клиента", "Client country")}: ${o.country}`,
    `${text("Отдельный запрос начать после оплаты", "Separate request to start after payment")}: ${q.startRequested ? text("да", "yes") : text("нет", "no")}`,
    `${text("Предложение", "Quote")}: ${q.id}`,
    `${text("Редакция оферты", "Terms version")}: ${q.termsVersion}`,
    `${text("Подтверждено клиентом", "Accepted by the client")}: ${q.acceptedAt?.toISOString() || text("ещё не подтверждено", "not yet accepted")}`,
    `${text("Стоимость", "Price")}: ${(q.amount / 100).toFixed(2)} RUB`,
    `${text("Срок", "Deadline")}: ${q.deadline.toISOString()}`,
    `${text("Включённых раундов правок", "Included revision rounds")}: ${q.includedRounds}`,
    `${text("Техническое задание", "Brief")}\n${q.brief}`,
    `${text("Состав результата", "Deliverables")}\n${q.deliverables}`,
    snapshot.title,
    ...snapshot.sections.map((section) =>
      [section.title, ...section.paragraphs].join("\n\n"),
    ),
  ].join("\n\n");
  return new Response(document, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="restatic-order-${o.id}-terms.txt"`,
      "Cache-Control": "private, no-store",
    },
  });
}
