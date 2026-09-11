import type { IncomingMessage, ServerResponse } from "node:http";
type ServerState = Awaited<
  ReturnType<typeof import("../server/vercel-runtime").createVercelServer>
>;
let server: Promise<ServerState> | undefined;
function getServer() {
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
    await app(req, res);
  } catch (error) {
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "INITIALIZATION_FAILED";
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
          detail:
            error instanceof Error && code !== "INITIALIZATION_FAILED"
              ? error.message
              : "Backend initialization failed. Check server logs using the error code.",
        }),
      );
    } else res.end();
  }
}
