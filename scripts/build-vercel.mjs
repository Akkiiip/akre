import { build } from "esbuild";
import { builtinModules } from "node:module";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(".vercel/output");
const functionDir = resolve(output, "functions/api.func");
await mkdir(functionDir, { recursive: true });
const result = await build({
  entryPoints: ["api/[...path].ts"],
  outfile: resolve(functionDir, "index.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  metafile: true,
  sourcemap: false,
  logLevel: "info",
});
// A missing server file must fail the build, not the first production request.
const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
for (const value of Object.values(result.metafile.outputs))
  for (const item of value.imports)
    if (item.external && !builtins.has(item.path))
      throw new Error(`Unexpected external runtime dependency: ${item.path}`);
await writeFile(
  resolve(functionDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs24.x",
      handler: "index.cjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
    },
    null,
    2,
  ),
);
await cp("dist", resolve(output, "static"), { recursive: true });
await writeFile(
  resolve(output, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/api(?:/.*)?", dest: "/api" },
        { handle: "filesystem" },
        {
          src: "/(?:radar|products|suppliers|store|content|experiments|analytics|settings)/?",
          dest: "/index.html",
        },
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Vercel artifact: Node 24, bundled API, Vite static assets, explicit API-first routing.",
);
