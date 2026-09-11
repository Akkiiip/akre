// Native Node test host for the generated function; no tsx, TS loader or app imports.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
const require = createRequire(import.meta.url);
const output = resolve(process.env.AKRE_TEST_OUTPUT ?? ".vercel/output");
const handler = require(
  process.env.AKRE_TEST_HANDLER ?? join(output, "functions/api.func/index.cjs"),
).default;
const manifest = JSON.parse(
  await readFile(join(output, "config.json"), "utf8"),
);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    // Simulate HTTPS termination for same-origin browser writes on the loopback HTTP test host only.
    if (
      process.env.AKRE_TEST_TLS_PROXY === "1" &&
      req.headers.origin === `http://${req.headers.host}`
    )
      req.headers.origin = `https://${req.headers.host}`;
    if (new RegExp(`^${manifest.routes[0].src}$`).test(pathname)) {
      await handler(req, res);
      return;
    }
    let file = resolve(output, "static", "." + decodeURIComponent(pathname));
    const staticRoot = resolve(output, "static");
    if (
      file !== staticRoot &&
      !file.startsWith(staticRoot + (process.platform === "win32" ? "\\" : "/"))
    ) {
      res.writeHead(404).end();
      return;
    }
    let exists = await stat(file)
      .then((s) => s.isFile())
      .catch(() => false);
    if (
      !exists &&
      (pathname === "/" ||
        new RegExp(`^${manifest.routes[2].src}$`).test(pathname))
    )
      file = join(staticRoot, "index.html");
    const body = await readFile(file).catch(() => null);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(body);
  } catch (error) {
    console.error(error);
    res
      .writeHead(500, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Test host failed" }));
  }
});
server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const port = server.address().port;
  process.send?.({ port });
  console.log(`Artifact test host listening on ${port}`);
});
