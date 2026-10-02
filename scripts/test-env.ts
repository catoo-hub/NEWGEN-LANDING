import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const source = await readFile(".env", "utf8");
const entries = Object.fromEntries(
  source
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const url = new URL(entries.DATABASE_URL);
url.pathname = "/restatic_test";
Object.assign(entries, {
  APP_URL: "http://127.0.0.1:4322",
  DATABASE_URL: url.href,
  DATA_DIR: "./storage/test",
  OWNER_EMAIL: "owner@restatic.test",
  ADMIN_INITIAL_PASSWORD: "",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: "noreply@restatic.test",
  ROBOKASSA_TEST: "true",
  ROBOKASSA_LOGIN: "restatic-local-test",
  ROBOKASSA_VAT: "none",
  ROBOKASSA_TEST_PASSWORD1: randomBytes(24).toString("hex"),
  ROBOKASSA_TEST_PASSWORD2: randomBytes(24).toString("hex"),
  ROBOKASSA_PASSWORD1: "",
  ROBOKASSA_PASSWORD2: "",
  PAYMENTS_LIVE_READY: "false",
});
await writeFile(
  ".env.test",
  Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Prepared isolated local test database, Mailpit and simulated payment credentials.",
);
