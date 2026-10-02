import { db, type Tx } from "./db";
import { mailQueue, notifications, user, userRoles } from "./db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { formatEvent } from "../shared/events";
import { baseUrl } from "./env";
export async function enqueueMail(
  to: string,
  subject: string,
  body: string,
  tx: Tx | typeof db = db,
) {
  await tx.insert(mailQueue).values({ to, subject, body });
}
export async function notify(
  tx: Tx,
  ids: string[],
  body: string,
  orderId?: string,
  delayed = false,
  dedupeKey?: string,
) {
  for (const userId of [...new Set(ids)]) {
    const [u] = await tx.select().from(user).where(eq(user.id, userId));
    if (!u) continue;
    if (dedupeKey) {
      const [existing] = await tx
        .select({ id: mailQueue.id })
        .from(mailQueue)
        .where(eq(mailQueue.dedupeKey, `${dedupeKey}:${userId}`));
      if (existing) continue;
    }
    const [n] = await tx
      .insert(notifications)
      .values({ userId, body, orderId })
      .returning();
    await tx.insert(mailQueue).values({
      to: u.email,
      subject:
        "RE:STATIC — " +
        formatEvent(body, u.language === "en" ? "en" : "ru").slice(0, 100),
      body: `${formatEvent(body, u.language === "en" ? "en" : "ru")}\n${baseUrl}/${u.language === "en" ? "en" : "ru"}/account/${orderId ? "?order=" + orderId : ""}`,
      notificationId: n.id,
      dedupeKey: dedupeKey ? `${dedupeKey}:${userId}` : null,
      availableAt: new Date(Date.now() + (delayed ? 15 * 60 * 1000 : 0)),
    });
  }
}
export async function staffIds(tx: Tx) {
  const rows = await tx
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(user, eq(user.id, userRoles.userId))
    .where(
      and(
        eq(user.disabled, false),
        inArray(userRoles.role, ["admin", "moderator"]),
      ),
    );
  return [...new Set(rows.map((r) => r.id))];
}
