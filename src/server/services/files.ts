import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, unlink, stat } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import {
  type Actor,
  need,
  isAdmin,
  isStaff,
  orderAccess,
  AppError,
} from "../security";
import { dataDir } from "../env";
const maxSize = 1024 * 1024 * 1024;
const allowed: Record<string, string[]> = {
  ".mp4": ["video/mp4"],
  ".mov": ["video/quicktime"],
  ".webm": ["video/webm"],
  ".mp3": ["audio/mpeg"],
  ".wav": ["audio/wav", "audio/x-wav"],
  ".ogg": ["audio/ogg", "audio/opus"],
  ".m4a": ["audio/mp4", "audio/x-m4a"],
  ".flac": ["audio/flac"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".pdf": ["application/pdf"],
  ".zip": ["application/zip"],
  ".7z": ["application/x-7z-compressed"],
  ".rar": ["application/x-rar-compressed"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ],
  ".txt": ["text/plain"],
};
export function range(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]))
    throw new AppError("INVALID_RANGE", 416);
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(size - 1, Number(match[2]))
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start < 0 ||
    end < start
  )
    throw new AppError("INVALID_RANGE", 416);
  return { start, end };
}
export async function upload(
  a: Actor,
  request: Request,
  orderId: string | null,
  kind: string,
) {
  need(
    ["source", "preview", "final", "cover"].includes(kind),
    "INVALID_FILE_KIND",
    400,
  );
  if (orderId) {
    const access = await orderAccess(a, orderId);
    need(
      isStaff(a) ||
        (access.isCustomer && kind === "source") ||
        (access.isPerformer &&
          access.o.paidAt &&
          (kind === "preview" || kind === "final")),
      "FORBIDDEN",
    );
    need(
      !["completed", "canceled", "refunded"].includes(access.o.status),
      "ORDER_CLOSED",
      409,
    );
  } else need(isAdmin(a));
  need(request.body, "EMPTY_UPLOAD", 400);
  const directory = resolve(dataDir);
  await mkdir(directory, { recursive: true });
  const id = crypto.randomUUID(),
    path = resolve(directory, id);
  let name = "",
    mime = "",
    size = 0,
    count = 0,
    truncated = false;
  let task: Promise<void> | undefined;
  const parser = Busboy({
    headers: Object.fromEntries(request.headers),
    limits: { fileSize: maxSize + 1, files: 1, fields: 0 },
  });
  parser.on("filesLimit", () => {
    truncated = true;
  });
  parser.on("file", (_, stream, info) => {
    count++;
    name = basename(info.filename)
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 200);
    stream.on("limit", () => {
      truncated = true;
    });
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
    });
    task = pipeline(stream, createWriteStream(path, { flags: "wx" }));
    task.catch(() => {});
  });
  let received = 0;
  const budget = new Transform({
    transform(chunk, _, callback) {
      received += chunk.length;
      callback(
        received > maxSize + 131072
          ? new AppError("FILE_TOO_LARGE_OR_EMPTY", 413)
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as any), budget, parser);
    if (task) await task;
    need(
      count === 1 && size > 0 && size <= maxSize && !truncated,
      "FILE_TOO_LARGE_OR_EMPTY",
      413,
    );
    const handle = await open(path, "r");
    const head = Buffer.alloc(Math.min(size, 8192));
    await handle.read(head, 0, head.length, 0);
    await handle.close();
    const type = await fileTypeFromBuffer(head);
    const ext = extname(name).toLowerCase();
    mime =
      type?.mime || (ext === ".txt" && !head.includes(0) ? "text/plain" : "");
    need(allowed[ext]?.includes(mime), "UNSUPPORTED_FILE", 400);
    await db.transaction(async (tx) => {
      if (orderId) {
        await tx.execute(
          sql`select id from orders where id=${orderId} for update`,
        );
        const { o, isCustomer, isPerformer } = await orderAccess(
          a,
          orderId,
          tx,
        );
        need(
          !["completed", "canceled", "refunded"].includes(o.status),
          "ORDER_CLOSED",
          409,
        );
        need(
          isStaff(a) ||
            (isCustomer && kind === "source") ||
            (isPerformer &&
              o.paidAt &&
              (kind === "preview" || kind === "final")),
        );
        const [{ total }] = await tx
          .select({
            total: sql<number>`coalesce(sum(${s.files.size}),0)::bigint`,
          })
          .from(s.files)
          .where(eq(s.files.orderId, orderId));
        need(Number(total) + size <= 20 * maxSize, "ORDER_STORAGE_LIMIT", 413);
      }
      await tx
        .insert(s.files)
        .values({
          id,
          orderId,
          uploaderId: a.id,
          name,
          path: id,
          mime,
          size,
          kind,
        });
    });
    return {
      id,
      name,
      mime,
      size,
      src: `/api/files/${id}/`,
      publicSrc: `/api/public-media/${id}/`,
    };
  } catch (e) {
    if (task) await task.catch(() => {});
    await unlink(path).catch(() => {});
    throw e;
  }
}
export async function serve(
  request: Request,
  id: string,
  a?: Actor,
  publicMedia = false,
) {
  const [f] = await db.select().from(s.files).where(eq(s.files.id, id));
  need(f, "NOT_FOUND", 404);
  if (publicMedia) {
    const [p] = await db
      .select()
      .from(s.portfolio)
      .where(
        and(
          eq(s.portfolio.published, true),
          or(
            eq(s.portfolio.src, `/api/public-media/${id}/`),
            eq(s.portfolio.poster, `/api/public-media/${id}/`),
          ),
        ),
      );
    need(p, "NOT_FOUND", 404);
    if (f.orderId) {
      const [o] = await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.id, f.orderId));
      need(o?.portfolioConsent && p.orderId === o.id, "NOT_FOUND", 404);
    }
  } else {
    need(a);
    if (f.orderId) {
      const access = await orderAccess(a, f.orderId);
      need(
        isStaff(a) ||
          access.isCustomer ||
          (access.isPerformer && access.o.paidAt),
      );
    } else need(isAdmin(a));
  }
  const path = resolve(dataDir, f.path);
  const size = (await stat(path)).size;
  let r;
  try {
    r = range(request.headers.get("range"), size);
  } catch {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  const headers: Record<string, string> = {
    "Content-Type": f.mime,
    "Accept-Ranges": "bytes",
    "Content-Length": String(r ? r.end - r.start + 1 : size),
    "Cache-Control": publicMedia ? "public, max-age=60" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${request.headers.get("sec-fetch-dest") === "document" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  };
  if (r) headers["Content-Range"] = `bytes ${r.start}-${r.end}/${size}`;
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(createReadStream(path, r || {})) as any),
    { status: r ? 206 : 200, headers },
  );
}
