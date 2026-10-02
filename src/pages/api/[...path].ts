import type { APIRoute } from "astro";
import { ZodError, z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../../server/db";
import * as s from "../../server/db/schema";
import { actor, AppError, need, sameOrigin } from "../../server/security";
import {
  catalog,
  adminData,
  availability,
  saveCatalog,
  invite,
  claim,
} from "../../server/services/catalog";
import {
  createOrder,
  listOrders,
  detail,
  conversation,
  action,
} from "../../server/services/orders";
import {
  checkout,
  result,
  recordRefund,
  recheckReceipt,
} from "../../server/services/payments";
import {
  finances,
  requestWithdrawal,
  decideWithdrawal,
  adminFinances,
} from "../../server/services/finance";
import { boundedText } from "../../server/body";
import { orderTerms } from "../../server/services/terms";
import { upload, serve } from "../../server/services/files";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export const ALL: APIRoute = async ({ request, params }) => {
  const path = (params.path || "").split("/").filter(Boolean),
    method = request.method;
  try {
    if (path[0] === "health") {
      await db.execute("select 1");
      return json({ status: "ok" });
    }
    if (path[0] === "catalog" && method === "GET") return json(await catalog());
    need(
      process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET,
      "SETUP_REQUIRED",
      503,
    );
    if (
      path.join("/") === "payments/result" &&
      (method === "POST" || method === "GET")
    ) {
      const p =
        method === "POST"
          ? new URLSearchParams(await boundedText(request, 32_000))
          : new URL(request.url).searchParams;
      return new Response(await result(p), {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (path[0] === "public-media" && ["GET", "HEAD"].includes(method))
      return await serve(request, path[1], undefined, true);
    const a = await actor(request);
    if (!["GET", "HEAD"].includes(method)) sameOrigin(request);
    const body = async () => JSON.parse((await boundedText(request)) || "{}");
    if (path[0] === "me" && method === "GET") {
      const [m] = await db
        .select()
        .from(s.members)
        .where(eq(s.members.userId, a.id));
      return json({ ...a, member: m || null });
    }
    if (path[0] === "orders") {
      if (!path[1] && method === "GET")
        return json(
          await listOrders(
            a,
            new URL(request.url).searchParams.get("mode") || "customer",
          ),
        );
      if (!path[1] && method === "POST")
        return json(await createOrder(a, await body()), 201);
      if (path[1] && !path[2] && method === "GET")
        return json(await detail(a, path[1]));
      if (path[1] && !path[2] && method === "POST") {
        await action(a, path[1], await body());
        return json({ ok: true });
      }
      if (path[2] === "messages" && method === "GET")
        return json(
          await conversation(
            a,
            path[1],
            new URL(request.url).searchParams.get("before") || undefined,
          ),
        );
      if (path[2] === "terms" && method === "GET")
        return await orderTerms(
          a,
          path[1],
          new URL(request.url).searchParams.get("quote") || "",
        );
      if (path[2] === "checkout" && method === "POST")
        return json(await checkout(a, path[1]));
      if (path[2] === "refund" && method === "POST") {
        const v = z
          .object({
            amount: z.number().int().positive(),
            reference: z.string().min(1).max(1000),
          })
          .parse(await body());
        await recordRefund(a, path[1], v.amount, v.reference);
        return json({ ok: true });
      }
      if (path[2] === "files" && method === "POST")
        return json(
          await upload(
            a,
            request,
            path[1],
            new URL(request.url).searchParams.get("kind") || "source",
          ),
          201,
        );
    }
    if (path[0] === "files" && ["GET", "HEAD"].includes(method))
      return await serve(request, path[1], a);
    if (path[0] === "media-upload" && method === "POST")
      return json(await upload(a, request, null, "cover"), 201);
    if (path[0] === "availability" && method === "POST") {
      const v = z.object({ available: z.boolean() }).parse(await body());
      await availability(a, v.available);
      return json({ ok: true });
    }
    if (path[0] === "finance" && method === "GET")
      return json(await finances(a));
    if (path[0] === "withdrawals" && method === "POST") {
      const v = z
        .object({
          amount: z.number().int().positive(),
          details: z.string().min(5).max(2000),
        })
        .parse(await body());
      return json(await requestWithdrawal(a, v.amount, v.details), 201);
    }
    if (path[0] === "notifications" && method === "GET")
      return json(
        await db
          .select()
          .from(s.notifications)
          .where(eq(s.notifications.userId, a.id))
          .orderBy(desc(s.notifications.createdAt))
          .limit(100),
      );
    if (path[0] === "notifications" && method === "POST") {
      await db
        .update(s.notifications)
        .set({ readAt: new Date() })
        .where(eq(s.notifications.userId, a.id));
      return json({ ok: true });
    }
    if (path[0] === "claim" && method === "POST") {
      const v = z
        .object({ token: z.string().min(32).max(100) })
        .parse(await body());
      await claim(a, v.token);
      return json({ ok: true });
    }
    if (path[0] === "admin") {
      if (path[1] === "data" && method === "GET")
        return json(await adminData(a));
      if (path[1] === "finance" && method === "GET")
        return json(await adminFinances(a));
      if (path[1] === "receipts" && method === "POST") {
        const v = z
          .object({ id: z.number().int().positive() })
          .parse(await body());
        await recheckReceipt(a, v.id);
        return json({ ok: true });
      }
      if (path[1] === "invite" && method === "POST") {
        await invite(a, await body());
        return json({ ok: true });
      }
      if (path[1] === "withdrawals" && method === "POST") {
        const v = z
          .object({
            id: z.string(),
            decision: z.enum(["paid", "rejected"]),
            reference: z.string().min(1).max(1000),
          })
          .parse(await body());
        await decideWithdrawal(a, v.id, v.decision, v.reference);
        return json({ ok: true });
      }
      if (method === "POST") {
        await saveCatalog(a, path[1], await body());
        return json({ ok: true });
      }
    }
    throw new AppError("NOT_FOUND", 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.code }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error: "VALIDATION_ERROR",
          fields: e.issues.map((v) => v.path.join(".")),
        },
        400,
      );
    if (e instanceof SyntaxError) return json({ error: "INVALID_JSON" }, 400);
    console.error(
      "API request failed",
      e instanceof Error ? e.name : "UnknownError",
    );
    return json({ error: "SERVER_ERROR" }, 500);
  }
};
