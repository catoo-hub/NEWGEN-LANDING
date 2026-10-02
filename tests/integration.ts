import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { and, desc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { digest, result } from "../src/server/services/payments";
import { expire, deliverMail, fiscalize } from "../src/server/worker";
import { catalog } from "../src/server/services/catalog";
const base = process.env.APP_URL!,
  connection = new URL(process.env.DATABASE_URL!);
assert(
  connection.pathname.endsWith("_test"),
  "Integration tests require a dedicated *_test database",
);
const adminURL = new URL(connection);
adminURL.pathname = "/postgres";
const admin = new pg.Pool({ connectionString: adminURL.href });
const database = connection.pathname.slice(1);
const exists = await admin.query("select 1 from pg_database where datname=$1", [
  database,
]);
if (!exists.rowCount)
  await admin.query(`create database "${database.replace(/"/g, "")}"`);
await admin.end();
await migrate(db, { migrationsFolder: "./drizzle" });
await db.execute(
  sql`truncate users, members, rates, portfolio, rate_limit restart identity cascade`,
);
await new Promise<void>((resolve, reject) => {
  const p = spawn(
    "node",
    ["--env-file=.env.test", "--import", "tsx", "scripts/seed.ts"],
    { stdio: "inherit" },
  );
  p.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("seed failed")),
  );
});
const server = spawn("node", ["--env-file=.env.test", "scripts/start.mjs"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: "4322" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk;
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk;
});
const cookies = new Map<string, string>();
let checks = 0;
async function call(who: string, path: string, body?: unknown, expected = 200) {
  const [route, query] = path.split("?");
  const response = await fetch(
    base + "/api/" + route + "/" + (query ? "?" + query : ""),
    {
      method: body ? "POST" : "GET",
      headers: {
        ...(cookies.get(who) ? { cookie: cookies.get(who)! } : {}),
        ...(body ? { "Content-Type": "application/json", Origin: base } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  }
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return data;
}
const password = randomBytes(24).toString("base64url");
async function signup(name: string, role?: string) {
  await db.delete(s.rateLimit);
  const email = name + "@restatic.test";
  const r = await fetch(base + "/api/auth/sign-up/email/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name, email, password, language: "ru" }),
  });
  assert.equal(r.status, 200, await r.text());
  const [u] = await db.select().from(s.user).where(eq(s.user.email, email));
  assert(u);
  const [mail] = await db
    .select()
    .from(s.mailQueue)
    .where(eq(s.mailQueue.to, email))
    .orderBy(desc(s.mailQueue.createdAt));
  assert(mail.body.includes("verify-email"));
  const verify = await fetch(mail.body);
  assert(
    [200, 302, 303, 307, 308].includes(verify.status),
    "verify email endpoint",
  );
  if (role)
    await db.insert(s.userRoles).values({ userId: u.id, role: role as any });
  await signin(name, email);
  return u;
}
async function signin(name: string, email: string) {
  const response = await fetch(base + "/api/auth/sign-in/email/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, await response.text());
  cookies.set(
    name,
    response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; "),
  );
  assert(cookies.get(name));
}
async function create(title: string, preferredMemberId?: string, type = "AMV") {
  return call(
    "client",
    "orders",
    {
      title,
      type,
      country: "RU",
      brief: "Create a cinematic edit",
      description: "Test description",
      music: "Original licensed music",
      links: ["https://example.com/materials"],
      language: "ru",
      preferredMemberId,
    },
    201,
  );
}
async function orderAction(
  who: string,
  id: string,
  action: string,
  rest = {},
  expected = 200,
) {
  return call(who, "orders/" + id, { action, ...rest }, expected);
}
async function quote(id: string) {
  await orderAction("mod", id, "quote", {
    brief: "Approved brief",
    deliverables: "MP4, 1080p, two revision rounds",
    amount: 100000,
    deadline: new Date(Date.now() + 10 * 86400000).toISOString(),
  });
  const d = await call("client", "orders/" + id);
  await orderAction("client", id, "accept_quote", {
    quoteId: d.quotes[0].id,
    termsAccepted: true,
    startRequested: true,
  });
  return d.quotes[0];
}
async function pay(id: string) {
  const checkout = await call("client", "orders/" + id + "/checkout", {});
  assert.equal(checkout.params.IsTest, "1");
  const p = new URLSearchParams({
    OutSum: checkout.params.OutSum,
    InvId: checkout.params.InvId,
    Shp_order: id,
  });
  p.set(
    "SignatureValue",
    digest(
      `${p.get("OutSum")}:${p.get("InvId")}:${process.env.ROBOKASSA_TEST_PASSWORD2}:Shp_order=${id}`,
    ),
  );
  const response = await fetch(base + "/api/payments/result/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: p,
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await response.text(), "OK" + p.get("InvId"));
  return p;
}
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health/")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
    if (i === 59) throw new Error(serverOutput);
  }
  const initial = await catalog();
  assert.equal(initial.members.length, 29);
  assert.equal(initial.projects.length, 12);
  const client = await signup("client"),
    stranger = await signup("stranger"),
    mod = await signup("mod", "moderator"),
    owner = await signup("owner", "admin"),
    performer = await signup("performer");
  await call("owner", "admin/invite", {
    email: performer.email,
    memberId: "02",
    roles: ["performer"],
  });
  const [invitation] = await db
    .select()
    .from(s.mailQueue)
    .where(
      and(
        eq(s.mailQueue.to, performer.email),
        sql`${s.mailQueue.subject} like '%invitation%'`,
      ),
    )
    .orderBy(desc(s.mailQueue.createdAt));
  const token = new URL(invitation.body).searchParams.get("invite")!;
  await call("stranger", "claim", { token }, 400);
  await call("performer", "claim", { token });
  await call("performer", "claim", { token }, 400);
  await call("owner", "admin/members", {
    id: "02",
    name: "REVI",
    role: "AMV/Music Editor",
    link: "https://www.instagram.com/zrevisn/",
    active: true,
    shareBps: 7500,
    types: ["AMV"],
    position: 1,
  });
  await call("performer", "availability", { available: true });
  const first = await create("First edit"),
    second = await create("Second edit");
  await Promise.all([
    orderAction("mod", first.id, "assign"),
    orderAction("mod", second.id, "assign"),
  ]);
  const assigned = await db.select().from(s.slots);
  assert.equal(
    assigned.length,
    1,
    "concurrent assignments must not double-book",
  );
  const id = assigned[0].orderId;
  await call("stranger", "orders/" + id, undefined, 403);
  await call("client", "admin/data", undefined, 403);
  const pre = await call("performer", "orders/" + id);
  assert.equal(pre.messages.length, 0);
  assert.equal(pre.permissions.prepay, true);
  await orderAction(
    "performer",
    id,
    "message",
    { body: "Should not reach client" },
    403,
  );
  await orderAction("performer", id, "accept_assignment");
  await quote(id);
  const unpaid = await call("performer", "orders/" + id);
  assert.equal(unpaid.messages.length, 0);
  const params = await pay(id);
  const bad = new URLSearchParams(params);
  bad.set("SignatureValue", "a".repeat(64));
  await assert.rejects(() => result(bad), /INVALID_SIGNATURE/);
  const wrong = new URLSearchParams(params);
  wrong.set("OutSum", "1001.00");
  wrong.set(
    "SignatureValue",
    digest(
      `1001.00:${wrong.get("InvId")}:${process.env.ROBOKASSA_TEST_PASSWORD2}:Shp_order=${id}`,
    ),
  );
  await assert.rejects(() => result(wrong), /AMOUNT_MISMATCH/);
  await Promise.all([result(params), result(params)]);
  assert.equal(
    (await call("client", "orders/" + id)).order.status,
    "in_progress",
  );
  await orderAction("mod", id, "message", {
    body: "Internal rate negotiation",
    internal: true,
  });
  assert(
    !(await call("client", "orders/" + id)).messages.some(
      (m: any) => m.internal,
    ),
  );
  await orderAction("performer", id, "message", {
    body: "Working on your edit",
  });
  const bytes = await readFile("public/videos/cobalt-01.mp4");
  const form = new FormData();
  form.append("file", new Blob([bytes]), "preview.mp4");
  const uploadResponse = await fetch(
    base + `/api/orders/${id}/files/?kind=preview`,
    {
      method: "POST",
      headers: { cookie: cookies.get("performer")!, Origin: base },
      body: form,
    },
  );
  assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
  if (process.env.LARGE_UPLOAD_TEST === "true") {
    const { largeUpload } = await import("./large-upload");
    await largeUpload(base, id, cookies.get("client")!);
  }
  const file = await uploadResponse.json();
  const ranged = await fetch(base + file.src, {
    headers: { cookie: cookies.get("client")!, range: "bytes=20-119" },
  });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
  assert.equal(
    (
      await fetch(base + file.src, {
        headers: { cookie: cookies.get("stranger")! },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + file.src, {
        headers: { cookie: cookies.get("client")!, range: "bytes=9999999999-" },
      })
    ).status,
    416,
  );
  await orderAction("performer", id, "preview", {
    body: "Preview is uploaded",
  });
  await orderAction("client", id, "revision", {
    body: "First consolidated list",
  });
  await orderAction("performer", id, "final", { body: "Final v1" });
  await orderAction("client", id, "revision", { body: "Second list" });
  await orderAction("performer", id, "final", { body: "Final v2" });
  await orderAction("client", id, "revision", { body: "Third list" }, 409);
  const termsResponse = await fetch(
    base +
      `/api/orders/${id}/terms/?quote=${(await call("client", "orders/" + id)).quotes[0].id}`,
    { headers: { cookie: cookies.get("client")! } },
  );
  assert.equal(termsResponse.status, 200);
  assert((await termsResponse.text()).includes("Approved brief"));
  await orderAction("client", id, "defect", {
    body: "Technical mismatch rather than a creative change",
  });
  await orderAction("mod", id, "correction", {
    body: "Fix the confirmed encoding mismatch",
  });
  assert.equal((await call("client", "orders/" + id)).order.revisionRounds, 2);
  await orderAction("performer", id, "final", { body: "Corrected encoding" });
  await orderAction("performer", id, "complete", {}, 403);
  await orderAction("client", id, "complete");
  await orderAction("client", id, "complete", {}, 409);
  const finance = await call("performer", "finance");
  assert.equal(finance.available, 75000);
  const [credited] = await db
    .select()
    .from(s.ledger)
    .where(eq(s.ledger.key, "completion:" + id));
  assert.equal(credited.amount, 75000);
  const payoutResults = await Promise.all([
    call(
      "performer",
      "withdrawals",
      { amount: 60000, details: "SBP +70000000000 Test bank" },
      201,
    )
      .then((v) => ({ ok: true, v }))
      .catch(() => ({ ok: false })),
    call(
      "performer",
      "withdrawals",
      { amount: 60000, details: "SBP +70000000000 Test bank" },
      201,
    )
      .then((v) => ({ ok: true, v }))
      .catch(() => ({ ok: false })),
  ]);
  assert.equal(
    payoutResults.filter((v) => v.ok).length,
    1,
    "concurrent withdrawals must reserve once",
  );
  const [withdrawal] = await db.select().from(s.withdrawals);
  await call(
    "mod",
    "admin/withdrawals",
    { id: withdrawal.id, decision: "paid", reference: "test" },
    403,
  );
  await call("owner", "admin/withdrawals", {
    id: withdrawal.id,
    decision: "paid",
    reference: "TEST TRANSFER",
  });
  await call(
    "owner",
    "admin/withdrawals",
    { id: withdrawal.id, decision: "paid", reference: "duplicate" },
    409,
  );
  assert.equal((await call("performer", "finance")).available, 15000);
  await call("owner", "orders/" + id + "/refund", {
    amount: 10000,
    reference: "TEST ROBOKASSA REFUND",
  });
  assert.equal((await call("performer", "finance")).available, 7500);
  const portfolioOrder = await create("Portfolio permission");
  await orderAction("mod", portfolioOrder.id, "assign");
  await orderAction("performer", portfolioOrder.id, "accept_assignment");
  await quote(portfolioOrder.id);
  await pay(portfolioOrder.id);
  await orderAction("performer", portfolioOrder.id, "final", { body: "Final" });
  await orderAction("client", portfolioOrder.id, "complete");
  const entry = {
    id: "client-work",
    title: "Client portfolio",
    platform: "AMV",
    url: "https://example.com/work",
    src: "/videos/cobalt-01.mp4",
    poster: "/posters/cobalt-01.jpg",
    duration: 1000,
    memberId: "02",
    orderId: portfolioOrder.id,
    published: true,
    position: 12,
  };
  await call("owner", "admin/portfolio", entry, 400);
  await orderAction("client", portfolioOrder.id, "consent", {
    portfolioConsent: true,
  });
  await call("owner", "admin/portfolio", entry);
  assert((await catalog()).projects.some((p) => p.id === "client-work"));
  await orderAction("client", portfolioOrder.id, "consent", {
    portfolioConsent: false,
  });
  assert(!(await catalog()).projects.some((p) => p.id === "client-work"));
  const expirationOrder = await create("Expiration test");
  await orderAction("mod", expirationOrder.id, "assign");
  await db
    .update(s.slots)
    .set({ expiresAt: new Date(0) })
    .where(eq(s.slots.orderId, expirationOrder.id));
  await expire();
  assert.equal(
    (await call("client", "orders/" + expirationOrder.id)).order.status,
    "briefing",
  );
  const late = await create("Late payment");
  await orderAction("mod", late.id, "assign");
  await orderAction("performer", late.id, "accept_assignment");
  await quote(late.id);
  const lateCheckout = await call(
    "client",
    "orders/" + late.id + "/checkout",
    {},
  );
  await db
    .update(s.slots)
    .set({ expiresAt: new Date(0) })
    .where(eq(s.slots.orderId, late.id));
  await expire();
  await call("client", "orders/" + late.id + "/checkout", {}, 409);
  const lateParams = new URLSearchParams({
    InvId: lateCheckout.params.InvId,
    OutSum: lateCheckout.params.OutSum,
    Shp_order: late.id,
  });
  lateParams.set(
    "SignatureValue",
    digest(
      `${lateParams.get("OutSum")}:${lateParams.get("InvId")}:${process.env.ROBOKASSA_TEST_PASSWORD2}:Shp_order=${late.id}`,
    ),
  );
  await result(lateParams);
  assert.equal(
    (await call("client", "orders/" + late.id)).order.status,
    "payment_review",
  );
  await call("owner", "orders/" + late.id + "/refund", {
    amount: 100000,
    reference: "TEST LATE PAYMENT REFUND",
  });
  await result(lateParams);
  assert.equal(
    (await call("client", "orders/" + late.id)).order.status,
    "refunded",
  );
  const decline = await create("Decline assignment");
  await orderAction("mod", decline.id, "assign");
  await orderAction("performer", decline.id, "decline_assignment");
  assert.equal(
    (await call("client", "orders/" + decline.id)).order.memberId,
    null,
  );
  const preferred = await create("Preferred replacement", "03");
  await orderAction("mod", preferred.id, "assign");
  assert.equal(
    (await call("client", "orders/" + preferred.id)).order.memberId,
    null,
  );
  await orderAction("mod", preferred.id, "assign", { memberId: "02" }, 400);
  await orderAction("mod", preferred.id, "assign", {
    memberId: "02",
    replacementApproved: true,
  });
  const replacement = await call("client", "orders/" + preferred.id);
  const proposal = replacement.messages.find(
    (m: any) => m.kind === "replacement_proposal",
  );
  assert(proposal);
  await orderAction("client", preferred.id, "approve_replacement", {
    proposalId: proposal.id,
  });
  await orderAction("performer", preferred.id, "decline_assignment");
  await orderAction(
    "client",
    preferred.id,
    "approve_replacement",
    { proposalId: proposal.id },
    400,
  );
  const wait = await create("Separate start authorization");
  await orderAction("mod", wait.id, "assign");
  await orderAction("performer", wait.id, "accept_assignment");
  await orderAction("mod", wait.id, "quote", {
    brief: "Wait for authorization",
    deliverables: "MP4",
    amount: 100000,
    deadline: new Date(Date.now() + 20 * 86400000).toISOString(),
  });
  const waitDetail = await call("client", "orders/" + wait.id);
  await orderAction("client", wait.id, "accept_quote", {
    quoteId: waitDetail.quotes[0].id,
    termsAccepted: true,
    startRequested: false,
  });
  await pay(wait.id);
  assert.equal(
    (await call("client", "orders/" + wait.id)).order.status,
    "paid_waiting_start",
  );
  await orderAction(
    "performer",
    wait.id,
    "final",
    { body: "Premature work" },
    409,
  );
  await orderAction("client", wait.id, "start_work");
  assert.equal(
    (await call("client", "orders/" + wait.id)).order.status,
    "in_progress",
  );
  await call("owner", "orders/" + wait.id + "/refund", {
    amount: 100000,
    reference: "TEST WAITING START REFUND",
  });
  const other = await create("Manual category", undefined, "OTHER");
  await orderAction("mod", other.id, "assign");
  assert.equal(
    (await call("client", "orders/" + other.id)).order.memberId,
    null,
  );
  await deliverMail();
  await call(
    "owner",
    "admin/users",
    { id: owner.id, disabled: false, roles: ["customer"] },
    400,
  );
  const inbox = await fetch("http://127.0.0.1:8025/api/v1/messages").then((r) =>
    r.json(),
  );
  assert(inbox.total > 0, "queued messages must reach SMTP");
  await fiscalize();
  assert(
    (await db.select().from(s.receipts)).every((r) => r.status === "test"),
  );
  await writeFile(
    "/tmp/restatic-test-fixtures.json",
    JSON.stringify({
      base,
      password,
      emails: {
        client: client.email,
        mod: mod.email,
        owner: owner.email,
        performer: performer.email,
      },
      orderId: portfolioOrder.id,
    }),
  );
  const history = await create("Long conversation");
  await db.insert(s.messages).values(
    Array.from({ length: 450 }, (_, index) => ({
      orderId: history.id,
      authorId: client.id,
      body: `History ${index}`,
      createdAt: new Date(Date.now() - 1000000 + index * 1000),
    })),
  );
  const latest = await call("client", "orders/" + history.id + "/messages");
  assert.equal(latest.length, 200);
  assert.equal(latest.at(-1).body, "History 449");
  const older = await call(
    "client",
    "orders/" + history.id + "/messages?before=" + latest[0].id,
  );
  assert.equal(older.length, 200);
  const earliest = await call(
    "client",
    "orders/" + history.id + "/messages?before=" + older[0].id,
  );
  assert.equal(earliest.length, 50);
  assert.equal(earliest[0].body, "History 0");
  await call("stranger", "orders/" + history.id + "/messages", undefined, 403);
  const wrongOrigin = await fetch(base + "/api/orders/", {
    method: "POST",
    headers: {
      cookie: cookies.get("client")!,
      "Content-Type": "application/json",
      Origin: "https://example.com",
    },
    body: "{}",
  });
  assert.equal(wrongOrigin.status, 403);
  if (process.env.UI_TEST === "true") await import("./ui");
  await db.delete(s.rateLimit);
  const reset = await fetch(base + "/api/auth/request-password-reset/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      email: stranger.email,
      redirectTo: base + "/en/account/?reset=1",
    }),
  });
  assert.equal(reset.status, 200);
  const [resetMail] = await db
    .select()
    .from(s.mailQueue)
    .where(eq(s.mailQueue.to, stranger.email))
    .orderBy(desc(s.mailQueue.createdAt));
  const resetURL = new URL(resetMail.body);
  resetURL.pathname = resetURL.pathname.replace(/\/$/, "") + "/";
  const link = await fetch(resetURL, { redirect: "manual" });
  const resetToken = new URL(
    link.headers.get("location")!,
    base,
  ).searchParams.get("token");
  assert(resetToken);
  const resetPassword = await fetch(base + "/api/auth/reset-password/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      token: resetToken,
      newPassword: password + "changed",
    }),
  });
  assert.equal(resetPassword.status, 200, await resetPassword.text());
  await call("stranger", "me", undefined, 401);
  console.log(
    `PASS: ${checks} API checks, concurrent assignment/payouts, private file ranges, payment signatures, revisions, consent, expiry, SMTP and test receipts`,
  );
} catch (e) {
  console.error(serverOutput.slice(-3000));
  throw e;
} finally {
  server.kill("SIGTERM");
  await pool.end();
}
