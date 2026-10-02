// Preserve streaming uploads longer than Node's default five-minute request timeout.
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { startServer } = await import("../dist/server/entry.mjs");
const { server: wrapper } = startServer();
wrapper.server.requestTimeout = 60 * 60 * 1000;
wrapper.server.headersTimeout = 60_000;
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  wrapper.server.close(() => process.exit(0));
  setTimeout(() => {
    wrapper.server.closeAllConnections();
    process.exit(0);
  }, 20_000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
