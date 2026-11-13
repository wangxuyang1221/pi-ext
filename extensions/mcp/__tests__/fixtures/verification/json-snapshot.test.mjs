import assert from "node:assert/strict";
import fs from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { writeJsonSnapshot } from "./json-snapshot.mjs";

function fixture(t) {
  fs.mkdirSync(resolve(".tmp"), { recursive: true });
  const root = fs.mkdtempSync(resolve(".tmp/mcp-snapshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: join(root, "http-requests.json") };
}

for (const existing of [false, true]) {
  test(`publishes a complete snapshot without exposing partial bytes (${existing ? "replacement" : "first write"})`, t => {
    const { root, file } = fixture(t);
    const previous = { requests: [{ method: "initialize" }] };
    const next = { requests: [{ method: "initialize" }, { method: "tools/call" }] };
    if (existing) fs.writeFileSync(file, JSON.stringify(previous));
    const originalWrite = fs.writeFileSync;
    const observe = () => {
      if (existing) assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), previous);
      else assert.equal(fs.existsSync(file), false);
    };
    t.mock.method(fs, "writeFileSync", (path, data) => {
      originalWrite(path, "");
      observe();
      originalWrite(path, data.slice(0, 5));
      observe();
      originalWrite(path, data);
      observe();
    });
    writeJsonSnapshot(file, next);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), next);
    assert.deepEqual(fs.readdirSync(root), ["http-requests.json"]);
  });
}

for (const operation of ["writeFileSync", "renameSync"]) {
  test(`preserves the published snapshot and propagates ${operation} failures`, t => {
    const { root, file } = fixture(t);
    const previous = { requests: [{ method: "initialize" }] };
    fs.writeFileSync(file, JSON.stringify(previous));
    const failure = Object.assign(new Error("Synthetic snapshot failure"), { code: "EIO" });
    t.mock.method(fs, operation, () => { throw failure; });
    assert.throws(() => writeJsonSnapshot(file, { requests: [] }), error => error === failure);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), previous);
    assert.deepEqual(fs.readdirSync(root), ["http-requests.json"]);
  });
}
