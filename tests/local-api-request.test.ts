import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let readLocalJsonRequest: typeof import("@/lib/local-api-request").readLocalJsonRequest;

beforeAll(async () => {
  ({ readLocalJsonRequest } = await import("@/lib/local-api-request"));
});

function localRequest(body = "{}", headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/feed/sync", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

describe("readLocalJsonRequest", () => {
  it("accepts a same-origin JSON request from a loopback address", async () => {
    await expect(readLocalJsonRequest(localRequest('{"creators":[]}'), 1_024))
      .resolves.toEqual({ creators: [] });
  });

  it("accepts Next's localhost URL normalization when Host and Origin still match", async () => {
    const request = new Request("http://localhost:3000/api/feed/sync", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: "{}",
    });

    await expect(readLocalJsonRequest(request, 1_024)).resolves.toEqual({});
  });

  it("rejects cross-origin requests", async () => {
    const request = localRequest("{}", { origin: "https://example.com" });

    await expect(readLocalJsonRequest(request, 1_024)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects non-JSON requests", async () => {
    const request = localRequest("{}", { "content-type": "text/plain" });

    await expect(readLocalJsonRequest(request, 1_024)).rejects.toMatchObject({ status: 415 });
  });

  it("enforces the streamed request size instead of trusting Content-Length", async () => {
    const request = localRequest('{"value":"too large"}');

    await expect(readLocalJsonRequest(request, 8)).rejects.toMatchObject({ status: 413 });
  });
});
