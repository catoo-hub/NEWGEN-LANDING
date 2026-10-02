import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";
import { orderStatuses, workTypes, roles } from "../../shared/types";
const time = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const created = () => time("created_at").notNull().defaultNow();
export const workType = pgEnum("work_type", workTypes);
export const orderStatus = pgEnum("order_status", orderStatuses);
export const role = pgEnum("role", roles);
export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: created(),
  updatedAt: time("updated_at").notNull().defaultNow(),
  disabled: boolean("disabled").notNull().default(false),
  language: text("language").notNull().default("ru"),
});
export const session = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [index("session_user").on(t.userId)],
);
export const account = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: time("access_token_expires_at"),
    refreshTokenExpiresAt: time("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user").on(t.userId)],
);
export const verification = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: time("expires_at").notNull(),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier").on(t.identifier)],
);
export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: role("role").notNull(),
  },
  (t) => [uniqueIndex("user_role_unique").on(t.userId, t.role)],
);
export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    link: text("link").notNull(),
    userId: text("user_id")
      .unique()
      .references(() => user.id),
    active: boolean("active").notNull().default(true),
    available: boolean("available").notNull().default(false),
    shareBps: integer("share_bps"),
    position: integer("position").notNull().default(0),
    createdAt: created(),
  },
  (t) => [check("share_range", sql`${t.shareBps} between 0 and 10000`)],
);
export const specializations = pgTable(
  "specializations",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    type: workType("type").notNull(),
  },
  (t) => [uniqueIndex("member_type").on(t.memberId, t.type)],
);
export const rates = pgTable(
  "rates",
  {
    type: workType("type").primaryKey(),
    amount: integer("amount"),
    descriptionRu: text("description_ru").notNull().default(""),
    descriptionEn: text("description_en").notNull().default(""),
  },
  (t) => [check("rate_positive", sql`${t.amount} is null or ${t.amount} > 0`)],
);
export const orders = pgTable(
  "orders",
  {
    id: id(),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    type: workType("type").notNull(),
    title: text("title").notNull(),
    country: text("country").notNull().default(""),
    brief: text("brief").notNull(),
    description: text("description").notNull().default(""),
    music: text("music").notNull().default(""),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    preferredMemberId: text("preferred_member_id").references(() => members.id),
    memberId: text("member_id").references(() => members.id),
    status: orderStatus("status").notNull().default("application"),
    language: text("language").notNull(),
    paidAt: time("paid_at"),
    completedAt: time("completed_at"),
    revisionRounds: integer("revision_rounds").notNull().default(0),
    portfolioConsent: boolean("portfolio_consent").notNull().default(false),
    portfolioConsentAt: time("portfolio_consent_at"),
    createdAt: created(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_customer").on(t.customerId, t.createdAt),
    index("order_member").on(t.memberId),
    index("order_status").on(t.status, t.updatedAt),
  ],
);
export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    brief: text("brief").notNull(),
    deliverables: text("deliverables").notNull(),
    amount: integer("amount").notNull(),
    shareBps: integer("share_bps").notNull(),
    deadline: time("deadline").notNull(),
    expiresAt: time("expires_at").notNull(),
    includedRounds: integer("included_rounds").notNull().default(2),
    acceptedAt: time("accepted_at"),
    startRequested: boolean("start_requested").notNull().default(false),
    obsolete: boolean("obsolete").notNull().default(false),
    amendment: boolean("amendment").notNull().default(false),
    termsVersion: text("terms_version").notNull(),
    termsSnapshot: jsonb("terms_snapshot").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("quote_order").on(t.orderId),
    check("quote_amount", sql`${t.amount} > 0`),
    check("quote_share", sql`${t.shareBps} between 0 and 10000`),
    uniqueIndex("quote_current")
      .on(t.orderId)
      .where(sql`not ${t.obsolete}`),
  ],
);
export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    status: text("status").notNull().default("offered"),
    expiresAt: time("expires_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("assignment_order").on(t.orderId),
    index("assignment_member").on(t.memberId),
  ],
);
export const slots = pgTable("slots", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => members.id),
  orderId: text("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  expiresAt: time("expires_at"),
  createdAt: created(),
});
export const messages = pgTable(
  "messages",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false),
    kind: text("kind").notNull().default("message"),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    createdAt: created(),
  },
  (t) => [index("message_order").on(t.orderId, t.createdAt)],
);
export const files = pgTable(
  "files",
  {
    id: id(),
    orderId: text("order_id").references(() => orders.id),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("file_order").on(t.orderId),
    index("file_uploader").on(t.uploaderId),
  ],
);
export const payments = pgTable(
  "payments",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("pending"),
    test: boolean("test").notNull(),
    paidAt: time("paid_at"),
    refundAmount: integer("refund_amount").notNull().default(0),
    refundReference: text("refund_reference"),
    createdAt: created(),
  },
  (t) => [
    index("payment_order").on(t.orderId),
    uniqueIndex("payment_quote").on(t.quoteId),
  ],
);
export const ledger = pgTable(
  "ledger",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    orderId: text("order_id").references(() => orders.id),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    test: boolean("test").notNull().default(false),
    key: text("key").notNull().unique(),
    createdAt: created(),
  },
  (t) => [index("ledger_member").on(t.memberId)],
);
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    amount: integer("amount").notNull(),
    details: text("details").notNull(),
    test: boolean("test").notNull().default(false),
    status: text("status").notNull().default("requested"),
    reference: text("reference"),
    decidedBy: text("decided_by").references(() => user.id),
    createdAt: created(),
    decidedAt: time("decided_at"),
  },
  (t) => [
    index("withdrawal_member").on(t.memberId),
    check("withdrawal_amount", sql`${t.amount} > 0`),
  ],
);
export const portfolio = pgTable(
  "portfolio",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    platform: text("platform").notNull(),
    url: text("url").notNull(),
    src: text("src").notNull(),
    poster: text("poster").notNull(),
    duration: integer("duration_ms").notNull().default(0),
    memberId: text("member_id").references(() => members.id),
    orderId: text("order_id").references(() => orders.id),
    published: boolean("published").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    index("portfolio_member").on(t.memberId),
    index("portfolio_order").on(t.orderId),
  ],
);
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    email: text("email").notNull(),
    memberId: text("member_id").references(() => members.id),
    roles: jsonb("roles").$type<string[]>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    usedAt: time("used_at"),
    createdAt: created(),
  },
  (t) => [index("invitation_member").on(t.memberId)],
);
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orderId: text("order_id").references(() => orders.id),
    body: text("body").notNull(),
    readAt: time("read_at"),
    createdAt: created(),
  },
  (t) => [index("notification_user").on(t.userId, t.createdAt)],
);
export const mailQueue = pgTable(
  "mail_queue",
  {
    id: id(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    notificationId: text("notification_id").references(() => notifications.id, {
      onDelete: "cascade",
    }),
    dedupeKey: text("dedupe_key").unique(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: time("available_at").notNull().defaultNow(),
    sentAt: time("sent_at"),
    lastError: text("last_error"),
    createdAt: created(),
  },
  (t) => [index("mail_due").on(t.sentAt, t.availableAt)],
);
export const audit = pgTable(
  "audit",
  {
    id: id(),
    actorId: text("actor_id").references(() => user.id),
    orderId: text("order_id").references(() => orders.id),
    action: text("action").notNull(),
    details: jsonb("details").notNull().default({}),
    createdAt: created(),
  },
  (t) => [
    index("audit_order").on(t.orderId, t.createdAt),
    index("audit_actor").on(t.actorId),
  ],
);
export const reads = pgTable(
  "reads",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    readAt: time("read_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("read_user_order").on(t.userId, t.orderId)],
);
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const receipts = pgTable("receipts", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedAlwaysAsIdentity({ startWith: 1000000000 }),
  paymentId: bigint("payment_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => payments.id),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: time("available_at").notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: created(),
});
