import { need } from "./security";

/** Bound decoded bodies too, including requests without Content-Length. Uploads stream separately. */
export async function boundedText(request: Request, limit = 100_000) {
  need(
    Number(request.headers.get("content-length") || 0) <= limit,
    "BODY_TOO_LARGE",
    413,
  );
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        need(false, "BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}
