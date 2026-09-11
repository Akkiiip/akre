import type { IncomingMessage, ServerResponse } from "node:http";
type ServerState = ReturnType<
  typeof import("../server/vercel-runtime").createVercelServer
>;
let server: Promise<ServerState> | undefined;
function getServer() {
  // Literal dynamic import is bundled at build time; initialization errors stay inside the request boundary.
  server ??= import("../server/vercel-runtime")
    .then(({ createVercelServer }) => createVercelServer())
    .catch((error) => {
      server = undefined;
      throw error;
    });
  return server;
}
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const { app } = await getServer();
    app(req, res);
  } catch (error) {
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "INITIALIZATION_FAILED";
    const configuration =
      error instanceof Error &&
      error.name === "Error" &&
      [
        "DURABLE_BACKEND_REQUIRED",
        "INVALID_MODE",
        "INVALID_AUTH_CONFIG",
        "INVALID_ORIGIN",
        "INVALID_DEMO_STORAGE",
      ].includes(code);
    console.error(
      JSON.stringify({
        event: "akre_api_initialization_failed",
        code,
        node: process.version,
      }),
    );
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        JSON.stringify({
          error: "AKRE backend unavailable",
          code,
          detail: configuration
            ? (error as Error).message
            : "Backend initialization failed. Check server logs using the error code.",
        }),
      );
    } else res.end();
  }
}
