import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import { baseUrl } from "./env";
import { enqueueMail } from "./mail";
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  baseURL: baseUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await enqueueMail(
        user.email,
        "RE:STATIC — восстановление доступа / Reset password",
        url,
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueMail(
        user.email,
        "RE:STATIC — подтвердите почту / Verify email",
        url,
      );
    },
  },
  user: {
    additionalFields: {
      language: { type: "string", defaultValue: "ru", input: true },
      disabled: { type: "boolean", defaultValue: false, input: false },
    },
  },
  session: { cookieCache: { enabled: false } },
  rateLimit: { enabled: true, storage: "database" },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-restatic-client-ip"] },
    useSecureCookies: baseUrl.startsWith("https:"),
  },
});
