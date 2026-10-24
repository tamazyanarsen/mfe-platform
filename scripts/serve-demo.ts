import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { DEMO_DIR, demoBase } from "./build-demo";

/**
 * Локальный сервер для .demo/, который ведёт себя как GitHub Pages: сайт под префиксом пути,
 * каталог отдаёт index.html, неизвестный путь — 404.html со статусом 404.
 *
 *   bun run serve:demo   # http://localhost:4173/mfe-platform/
 */
const base = demoBase();
const port = Number(process.env.PORT ?? 4173);

const file = (path: string) => {
  const target = normalize(join(DEMO_DIR, path));
  if (!target.startsWith(DEMO_DIR)) return null;
  if (existsSync(target) && statSync(target).isDirectory()) {
    const index = join(target, "index.html");
    return existsSync(index) ? index : null;
  }
  return existsSync(target) ? target : null;
};

Bun.serve({
  port,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(base)) return new Response("Not found", { status: 404 });
    const found = file(decodeURIComponent(pathname.slice(base.length)));
    if (found) return new Response(Bun.file(found));
    return new Response(Bun.file(join(DEMO_DIR, "404.html")), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log(`demo: http://localhost:${port}${base}`);
