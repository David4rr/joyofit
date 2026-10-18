import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { headTags, normalizePath } from "./src/seo.ts";

/**
 * Fills index.html's <!--seo-head--> for the dev server, which serves one
 * shell for every URL. The build leaves the marker for scripts/prerender.ts,
 * which writes each route's head and body.
 */
function devSeoHead(): Plugin {
  return {
    name: "joyofit-dev-seo-head",
    apply: "serve",
    transformIndexHtml(html, ctx) {
      const path = normalizePath((ctx.originalUrl ?? "/").split(/[?#]/)[0]!);
      return html.replace("<!--seo-head-->", () => headTags(path));
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), devSeoHead()],
});
