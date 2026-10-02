export const baseUrl = process.env.APP_URL || "http://localhost:4321";
export const testMode = process.env.ROBOKASSA_TEST !== "false";
export const dataDir = process.env.DATA_DIR || "./storage";
export const termsVersion = "2026-10-03-cabinet-v1";
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
