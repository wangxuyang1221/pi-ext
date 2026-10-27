import { budgetFetch } from "./pi14-live-budget.mjs";

if (!process.env.PI14_LIVE_STATE) throw new Error("Missing shared live request budget");
// The CLI installs undici globals during setup. Install its dispatcher first so
// later setup detects and preserves our deliberate fetch override.
const { configureHttpDispatcher } = await import(new URL("./core/http-dispatcher.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
configureHttpDispatcher();
globalThis.fetch = budgetFetch(process.env.PI14_LIVE_STATE);
// Every accepted request must pass the fetch ledger. The runner configures SSE;
// disabling WebSocket also prevents uncounted transport fallback in child CLIs.
globalThis.WebSocket = undefined;
