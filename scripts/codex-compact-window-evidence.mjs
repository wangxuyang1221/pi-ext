import fs from "node:fs";
import path from "node:path";

export function copySessionSnapshot(home, sessions, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(sessions, path.join(destination, "sessions"), { recursive: true });
  fs.copyFileSync(path.join(home, "auth.json"), path.join(destination, "auth.json"));
  fs.chmodSync(path.join(destination, "auth.json"), 0o600);
  const cache = path.join(home, "models_cache.json");
  if (fs.existsSync(cache)) fs.copyFileSync(cache, path.join(destination, "models_cache.json"));
}

export function classifyWindowEvidence(rawWindow, lastUsage) {
  const autoLimit = Math.floor(rawWindow * 0.9);
  const effectiveLimit = Math.floor(rawWindow * 0.95);
  return { autoLimit, effectiveLimit, thresholdOnly: Number.isFinite(lastUsage) && lastUsage >= autoLimit && lastUsage < effectiveLimit };
}
