// Turns the built SPA shell (dist/index.html) into one static HTML file per
// route, each with its own head tags and server-rendered body, plus
// sitemap.xml and 404.html. Run after `vite build` (see the build script).
//
//   /         -> dist/index.html
//   /strava   -> dist/strava.html   (served for /strava by html_handling)
//   not found -> dist/404.html      (served by not_found_handling "404-page")
//
// The body comes from src/entry-server.tsx through Vite's SSR loader, so the
// HTML crawlers see is the same React tree the browser hydrates.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createServer } from "vite";
import type * as SeoModule from "../src/seo";
import type * as EntryServer from "../src/entry-server";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const lastmodFile = join(root, "seo-lastmod.json");

const HEAD_MARKER = "<!--seo-head-->";
const EMPTY_APP = '<div id="app"></div>';

const server = await createServer({
  root,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});

try {
  const { PUBLIC_PATHS, NOT_FOUND_PATH, SITE_URL, headTags }: typeof SeoModule =
    await server.ssrLoadModule("/src/seo.ts");
  const { render }: typeof EntryServer = await server.ssrLoadModule("/src/entry-server.tsx");

  const template = await readFile(join(dist, "index.html"), "utf8");
  if (!template.includes(HEAD_MARKER) || !template.includes(EMPTY_APP)) {
    throw new Error(`dist/index.html lost ${HEAD_MARKER} or ${EMPTY_APP}; the build changed it`);
  }

  // The Latin subset serves every Indonesian page; fetch it before the CSS finishes.
  const font = (await readdir(join(dist, "assets"))).find((f) =>
    /^plus-jakarta-sans-latin-wght-normal-.*\.woff2$/.test(f),
  );
  const fontPreload = font
    ? `\n    <link rel="preload" href="/assets/${font}" as="font" type="font/woff2" crossorigin />`
    : "";

  const previous: Record<string, { hash: string; lastmod: string }> = JSON.parse(
    await readFile(lastmodFile, "utf8").catch(() => "{}"),
  );
  const next: typeof previous = {};
  const today = new Date().toISOString().slice(0, 10);

  const pages = [...PUBLIC_PATHS, NOT_FOUND_PATH];
  for (const path of pages) {
    const head = headTags(path);
    const body = render(path);
    const html = template
      .replace(HEAD_MARKER, () => head + fontPreload)
      .replace(EMPTY_APP, () => `<div id="app">${body}</div>`);
    const file = path === "/" ? "index.html" : `${path.slice(1)}.html`;
    await writeFile(join(dist, file), html);

    // lastmod moves only when what a crawler sees on the page changes.
    const hash = createHash("sha256").update(head).update(body).digest("hex").slice(0, 16);
    const old = previous[path];
    next[path] = { hash, lastmod: old?.hash === hash ? old.lastmod : today };
  }

  const urls = PUBLIC_PATHS.map(
    (path) => `  <url><loc>${SITE_URL}${path}</loc><lastmod>${next[path]!.lastmod}</lastmod></url>`,
  );
  await writeFile(
    join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
  );

  // The 404 page is not in the sitemap, so its entry only keeps hashes comparable.
  const json = `${JSON.stringify(next, null, 2)}\n`;
  if (json !== JSON.stringify(previous, null, 2) + "\n") await writeFile(lastmodFile, json);
  console.log(`prerendered ${pages.length} pages, sitemap with ${urls.length} urls`);
} finally {
  await server.close();
}
