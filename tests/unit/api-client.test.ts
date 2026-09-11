import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../../src/api";
afterEach(() => vi.unstubAllGlobals());
it("accepts a successful JSON API response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ mode: "DEMO" })),
  );
  await expect(api("/state")).resolves.toEqual({ mode: "DEMO" });
});
it("rejects a 200 HTML fallback instead of accepting it as state", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>fallback</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      ),
  );
  await expect(api("/state")).rejects.toThrow(
    "API returned an unexpected response (200)",
  );
});
it("shows sanitized backend initialization errors without a JSON parse failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            error: "AKRE backend unavailable",
            detail: "Backend initialization failed.",
          },
          { status: 503 },
        ),
      ),
  );
  await expect(api("/state")).rejects.toMatchObject({
    status: 503,
    message: "AKRE backend unavailable: Backend initialization failed.",
  });
});
it("rejects malformed JSON and plain-text platform errors meaningfully", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{bad", {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("FUNCTION_INVOCATION_FAILED", { status: 500 }),
      ),
  );
  await expect(api("/state")).rejects.toBeInstanceOf(ApiError);
  await expect(api("/state")).rejects.toMatchObject({
    status: 500,
    message: "FUNCTION_INVOCATION_FAILED",
  });
});
