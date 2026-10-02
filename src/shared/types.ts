export const workTypes = [
  "AMV",
  "GMV",
  "GFX",
  "LOGO",
  "VIDEO_CLIPS",
  "OTHER",
] as const;
export type WorkType = (typeof workTypes)[number];
export const roles = ["customer", "performer", "moderator", "admin"] as const;
export type Role = (typeof roles)[number];
export const orderStatuses = [
  "application",
  "briefing",
  "assigning",
  "quoted",
  "awaiting_payment",
  "paid_waiting_start",
  "in_progress",
  "review",
  "revision",
  "completed",
  "cancel_requested",
  "canceled",
  "payment_review",
  "refunded",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export interface Quote {
  id: string;
  orderId: string;
  brief: string;
  deliverables: string;
  amount: number;
  shareBps?: number;
  memberId: string;
  obsolete: boolean;
  amendment: boolean;
  createdAt: string;
  termsVersion: string;
  startRequested: boolean;
  deadline: string;
  expiresAt: string;
  acceptedAt: string | null;
  includedRounds: number;
}
export interface Payment {
  id: number;
  orderId: string;
  quoteId: string;
  amount: number;
  status: "pending" | "paid" | "refunded" | "expired";
  paidAt: string | null;
  test: boolean;
  refundAmount: number;
}
export interface Withdrawal {
  id: string;
  amount: number;
  status: "requested" | "paid" | "rejected";
  test: boolean;
  createdAt: string;
  reference: string | null;
  name?: string;
  details?: string;
}
export const terminal = ["completed", "canceled", "refunded"];
export function share(amount: number, bps: number) {
  return Number((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
}
export function money(value: string) {
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(value)) throw new Error("Invalid amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.slice(2).replace(/0/g, ""))
    throw new Error("Fractional kopecks");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
