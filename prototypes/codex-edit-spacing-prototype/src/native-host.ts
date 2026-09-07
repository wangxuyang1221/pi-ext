// PROTOTYPE: Preload through Node's native ESM loader, before Pi loads extensions.
// Jiti may create separate class identities; patch the classes used by the CLI.
import { installReplyLayout } from "./reply-layout.js";

Object.defineProperty(globalThis, Symbol.for("pi.edit-spacing-lab.installReplyLayout"), {
  value: installReplyLayout,
  configurable: true,
});
