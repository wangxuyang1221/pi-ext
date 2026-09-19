import { expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import * as processTools from "../../../scripts/codex-compact-quality-process.mjs";

test("waits through an indeterminate permission result and confirms group disappearance before success", async () => {
  let probes = 0;
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    expect(pid).toBe(-90001);
    if (signal === "SIGKILL" || probes++ === 0) throw Object.assign(new Error("Permission state is indeterminate"), { code: "EPERM" });
    throw Object.assign(new Error("Group disappeared"), { code: "ESRCH" });
  });
  try {
    await expect(processTools.stopProcessGroup({ pid: 90001, exitCode: null, signalCode: null }, { graceMs: 0, killWaitMs: 200 })).resolves.toMatchObject({ groupStopped: true });
    expect(probes).toBe(2);
  } finally { kill.mockRestore(); }
});

test("never treats persistent permission errors as verified cleanup", async () => {
  const error = Object.assign(new Error("Permission state stays unknown"), { code: "EPERM" });
  const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw error; });
  try {
    await expect(processTools.stopProcessGroup({ pid: 90001, exitCode: 0, signalCode: null }, { graceMs: 0, killWaitMs: 10 })).rejects.toMatchObject({ message: "Owned process group cleanup not verified", cause: error });
    expect(kill.mock.calls.filter(([, signal]) => signal === 0).length).toBeGreaterThanOrEqual(1);
  } finally { kill.mockRestore(); }
});

function connect(port: number) {
  return new Promise<void>((resolve, reject) => { const socket = net.connect(port, "127.0.0.1"); socket.once("connect", () => { socket.destroy(); resolve(); }); socket.once("error", reject); });
}

test("stops the entire owned group and releases a listening descendant after the parent exits", async () => {
  expect(typeof processTools.stopProcessGroup).toBe("function");
  const descendant = 'const net=require("node:net");const server=net.createServer();server.listen(0,"127.0.0.1",()=>console.log(JSON.stringify({port:server.address().port})));';
  const parent = `require("node:child_process").spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore","inherit","inherit"]});setTimeout(()=>process.exit(0),100);`;
  const child = spawn(process.execPath, ["-e", parent], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
  try {
    const [bytes] = await once(child.stdout!, "data", { signal: AbortSignal.timeout(3000) });
    const port = JSON.parse(bytes.toString()).port;
    await connect(port);
    const result = await processTools.stopProcessGroup(child, { graceMs: 200, killWaitMs: 3000 });
    expect(result.groupStopped).toBe(true);
    await expect(connect(port)).rejects.toThrow();
    expect(() => process.kill(-child.pid!, 0)).toThrow();
  } finally {
    await processTools.stopProcessGroup(child, { graceMs: 0, killWaitMs: 3000 });
  }
});
