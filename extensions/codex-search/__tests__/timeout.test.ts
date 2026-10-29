import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { classifyError, createTransport, runResponsesSearch, runStandaloneCommands } from "../src/codex.ts";

// Production requests accept a caller-owned signal; there is no built-in deadline setting.
describe.each(["responses", "standalone"] as const)("%s client deadline", mode => {
  it("aborts a held HTTP body on a real timer and permits a subsequent request", async () => {
    const deadline = new AbortController();
    const requests: Array<{ path: string; body: unknown }> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clientClosed = false;
    let closeObserved!: () => void;
    const connectionClosed = new Promise<void>(resolve => { closeObserved = resolve; });
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push({ path: request.url!, body: JSON.parse(Buffer.concat(chunks).toString()) });
      response.setHeader("content-type", mode === "responses" ? "text/event-stream" : "application/json");
      if (requests.length === 1) {
        response.once("close", () => { clientClosed = true; closeObserved(); });
        response.flushHeaders();
        // Start the actual caller deadline only after the connection and request exist.
        timer = setTimeout(() => deadline.abort(new DOMException("Client deadline elapsed", "TimeoutError")), 50);
        return;
      }
      response.end(mode === "responses"
        ? 'event: response.output_text.delta\ndata: {"delta":"Recovered response"}\n\nevent: response.completed\ndata: {"response":{}}\n\n'
        : JSON.stringify({ output: "Recovered standalone response" }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    // A regression that drops the caller signal must fail without leaving a held connection.
    const watchdog = setTimeout(() => server.closeAllConnections(), 2000);
    const port = (server.address() as import("node:net").AddressInfo).port;
    const transport = createTransport({ token: "fixture", accountId: "fixture", baseUrl: `http://127.0.0.1:${port}` });
    const run = (signal?: AbortSignal) => mode === "responses"
      ? runResponsesSearch({ query: "held-query", model: "fixture", transport, externalWebAccess: true, signal })
      : runStandaloneCommands({ model: "fixture", transport, sessionId: "deadline-session", open: [{ refId: "https://example.test/docs" }], freshness: "live", signal });
    try {
      await expect(run(deadline.signal)).rejects.toSatisfy((error: unknown) => classifyError(error) === "timeout");
      expect(deadline.signal.aborted).toBe(true);
      expect(deadline.signal.reason.name).toBe("TimeoutError");
      await connectionClosed;
      expect(clientClosed).toBe(true);
      expect(requests).toHaveLength(1);
      const recovered = await run();
      expect(recovered.text).toContain("Recovered");
      expect(requests).toHaveLength(2);
      console.log(JSON.stringify({ fixture: "search-client-deadline", mode, port, clientClosed, timerTriggered: deadline.signal.aborted, requests }));
    } finally {
      if (timer) clearTimeout(timer);
      clearTimeout(watchdog);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(server.listening).toBe(false);
    }
  });
});
