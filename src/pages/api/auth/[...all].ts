import type { APIRoute } from "astro";
import { auth } from "../../../server/auth";
export const ALL: APIRoute = ({ request, clientAddress }) => {
  // Astro uses trailing slashes; Better Auth's internal routes do not.
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/$/, "");
  const normalized = new Request(url, request);
  normalized.headers.set("x-restatic-client-ip", clientAddress);
  return auth.handler(normalized);
};
