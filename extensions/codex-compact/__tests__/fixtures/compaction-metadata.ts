import { createCompactionHashSnapshot, parseCompactionCatalog } from "../../src/capabilities.js";

export const fixtureSnapshot = createCompactionHashSnapshot(parseCompactionCatalog({ models: [
	{ slug: "gpt-5.5", comp_hash: "2911" },
	{ slug: "gpt-5.4", comp_hash: "2911" },
	{ slug: "gpt-5.4-mini", comp_hash: "2911" },
	{ slug: "gpt-5.6-sol", comp_hash: "3000" },
	{ slug: "gpt-5.6-terra", comp_hash: "3000" },
	{ slug: "gpt-5.6-luna", comp_hash: "3000" },
] }), "https://chatgpt.com/backend-api");

export const resolveFixtureHashes = async () => fixtureSnapshot;
