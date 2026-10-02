import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/server/db";
import { files } from "../src/server/db/schema";

export async function largeUpload(
  base: string,
  orderId: string,
  cookie: string,
) {
  const limit = 1024 ** 3;
  async function send(size: number) {
    const boundary = "restatic-streaming-test";
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large-source.txt"\r\nContent-Type: text/plain\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;
    async function* chunks() {
      yield Buffer.from(prefix);
      const block = Buffer.alloc(256 * 1024, "a");
      for (let sent = 0; sent < size; sent += block.length)
        yield block.subarray(0, Math.min(block.length, size - sent));
      yield Buffer.from(suffix);
    }
    return fetch(`${base}/api/orders/${orderId}/files/?kind=source`, {
      method: "POST",
      headers: {
        cookie,
        Origin: base,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Readable.from(chunks()) as any,
      duplex: "half",
    } as RequestInit);
  }
  const accepted = await send(limit);
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const file = await accepted.json();
  assert.equal(file.size, limit);
  const suffix = await fetch(base + file.src, {
    headers: { cookie, Range: "bytes=-32" },
  });
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 32);
  const oversized = await send(limit + 1);
  assert.equal(oversized.status, 413, await oversized.text());
  await db.delete(files).where(eq(files.id, file.id));
  await unlink(resolve(process.env.DATA_DIR!, file.id));
  console.log(
    "PASS: streamed 1 GiB accepted, 1 GiB + 1 byte rejected, private suffix range served",
  );
}
