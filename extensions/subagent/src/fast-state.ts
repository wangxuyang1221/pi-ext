import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The Fast extension responds synchronously with promises; emit itself does not await listeners. */
export async function readFastState(events: ExtensionAPI["events"]): Promise<boolean> {
  const request: { promises: Promise<boolean>[] } = { promises: [] };
  events.emit("pi-fast-mode:get-state", request);
  const responses = await Promise.all(request.promises);
  if (responses.length > 1) throw new Error("Multiple Fast Mode extensions responded.");
  return responses[0] ?? false;
}
