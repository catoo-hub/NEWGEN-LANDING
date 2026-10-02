// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  trailingSlash: "always",
  output: "server",
  // Our API checks Origin; Better Auth checks its own requests. Robokassa callbacks use signatures.
  security: { checkOrigin: false },
  adapter: node({ mode: "standalone", bodySizeLimit: 1024 ** 3 + 262144 }),
  vite: {
    plugins: [tailwindcss()],
  },
});
