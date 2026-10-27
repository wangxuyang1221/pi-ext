// Windows job bootstrap. No command starts before the supervisor assigns this process to its job.
import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const input = createInterface({ input: process.stdin });
input.once("line", line => {
  // Windows PowerShell's UTF-8 StreamWriter can prefix the gate message with a BOM.
  if (line.replace(/^\uFEFF/, "") !== "start") {
    console.error(`Unexpected test supervisor gate message: ${JSON.stringify(line)}`);
    process.exit(1);
  }
  input.close();
  process.stdin.destroy();
  // Keep this owned ancestor alive until the supervisor terminates the entire job.
  setInterval(() => {}, 1000);
  const child = spawn(config.command, config.args, { stdio: ["ignore", "inherit", "inherit"] });
  let recorded = false;
  const done = code => {
    if (recorded) return;
    recorded = true;
    writeFileSync(`${config.resultFile}.tmp`, JSON.stringify({ code }));
    renameSync(`${config.resultFile}.tmp`, config.resultFile);
  };
  child.once("error", error => { console.error(error); done(1); });
  child.once("exit", code => done(code ?? 1));
});
