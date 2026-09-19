import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const continuationTools = [
  { type: "function", name: "read_file", description: "读取当前工作区内的文本文件。path 必须使用相对路径，不使用历史记录中的绝对路径。", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }, strict: true },
  { type: "function", name: "replace_text", description: "替换允许修改文件中的唯一一段原文。path 必须使用当前工作区内的相对路径；old_text 必须非空且恰好出现一次。", parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"], additionalProperties: false }, strict: true },
];

export const creationContinuationTools = [
  ...continuationTools,
  { type: "function", name: "write_file", description: "在当前工作区内新建明确获准的文本文件。path 必须使用相对路径，不覆盖已有文件；单个文件最多 2 MiB。允许创建该文件所需的父目录。", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false }, strict: true },
  { type: "function", name: "copy_file", description: "将当前工作区内的一个文件逐字节复制到明确获准的新路径。source_path 和 path 都必须使用相对路径，不覆盖目标；单个文件最多 2 MiB。", parameters: { type: "object", properties: { source_path: { type: "string" }, path: { type: "string" } }, required: ["source_path", "path"], additionalProperties: false }, strict: true },
];

const isWorkspacePath = value => typeof value === "string" && !path.isAbsolute(value)
  && !/[\\\\:\u0000-\u001f\u007f]/.test(value) && !value.split("/").some(part => !part || part === "." || part === "..");

/** Validates the opt-in creation scope without changing existing default tool definitions. */
export function validateCreatePaths(allowedPaths, createPaths = []) {
  if (!Array.isArray(allowedPaths) || !Array.isArray(createPaths)
    || new Set(createPaths).size !== createPaths.length
    || createPaths.some(name => !isWorkspacePath(name) || !allowedPaths.includes(name))) throw new Error("Invalid creation permissions");
}

function readableWorkspaceFile(root, relativePath) {
  if (!isWorkspacePath(relativePath)) throw new Error("Forbidden path");
  const absolute = fs.realpathSync(path.join(root, relativePath));
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative !== relativePath) throw new Error("Forbidden path or symlink");
  const info = fs.statSync(absolute);
  if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) throw new Error("Unsupported file or hard link");
  return absolute;
}

function createScopedFile(root, relativePath, content) {
  const directories = [], absolute = path.join(root, relativePath);
  let descriptor, createdFile = false;
  try {
    let parent = root;
    for (const part of relativePath.split("/").slice(0, -1)) {
      parent = path.join(parent, part);
      try {
        const info = fs.lstatSync(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Forbidden parent directory");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        fs.mkdirSync(parent); directories.push(parent);
      }
      if (fs.realpathSync(parent) !== parent) throw new Error("Forbidden parent symlink");
    }
    descriptor = fs.openSync(absolute, "wx", 0o600); createdFile = true;
    fs.writeFileSync(descriptor, content);
    fs.closeSync(descriptor); descriptor = undefined;
  } catch (error) {
    const cleanupErrors = [];
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
    if (createdFile) { try { fs.unlinkSync(absolute); } catch (cleanupError) { cleanupErrors.push(cleanupError); } }
    for (const directory of directories.reverse()) {
      try { fs.rmdirSync(directory); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "File creation failed; rollback incomplete");
    throw error;
  }
}

/** Controlled file operations only; no model-supplied code or shell is executed. */
export class WorkspaceTools {
  constructor(root, allowedPaths, { createPaths = [] } = {}) {
    validateCreatePaths(allowedPaths, createPaths);
    this.root = fs.realpathSync(root);
    this.allowed = new Set(allowedPaths);
    this.creatable = new Set(createPaths);
    this.events = [];
  }
  execute(name, args) {
    const event = { name, arguments: args };
    this.events.push(event);
    try {
      if (!["read_file", "replace_text", ...(this.creatable.size ? ["write_file", "copy_file"] : [])].includes(name)) throw new Error("Unknown tool");
      if (!args || !isWorkspacePath(args.path)) throw new Error("Forbidden path");
      if (name === "write_file" || name === "copy_file") {
        if (!this.creatable.has(args.path) || !this.allowed.has(args.path)) throw new Error("Forbidden creation scope");
        let content;
        if (name === "copy_file") content = fs.readFileSync(readableWorkspaceFile(this.root, args.source_path));
        else {
          if (typeof args.content !== "string" || Buffer.byteLength(args.content) > 2 * 1024 * 1024) throw new Error("Invalid or oversized file content");
          content = args.content;
        }
        createScopedFile(this.root, args.path, content);
        event.status = "ok";
        return name === "copy_file" ? "File copied." : "File created.";
      }
      const absolute = readableWorkspaceFile(this.root, args.path);
      const text = fs.readFileSync(absolute, "utf8");
      if (name === "read_file") { event.status = "ok"; return text; }
      if (!this.allowed.has(args.path)) throw new Error("Forbidden modification scope");
      if (typeof args.old_text !== "string" || !args.old_text || typeof args.new_text !== "string") throw new Error("Invalid replacement");
      const index = text.indexOf(args.old_text);
      if (index < 0 || text.lastIndexOf(args.old_text) !== index) throw new Error("Replacement must match exactly once");
      const replacement = text.slice(0, index) + args.new_text + text.slice(index + args.old_text.length);
      if (Buffer.byteLength(replacement) > 2 * 1024 * 1024) throw new Error("Replacement is too large");
      fs.writeFileSync(absolute, replacement);
      event.status = "ok";
      return "Replacement applied.";
    } catch (error) {
      event.status = "error"; event.message = error.message;
      return JSON.stringify({ error: error.message });
    }
  }
}

export function fingerprintWorkspace(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Workspace snapshots must not contain symlinks");
      if (!entry.isFile()) throw new Error("Unsupported workspace object");
      return [path.relative(root, absolute), createHash("sha256").update(`file:${fs.statSync(absolute).mode & 0o7777}:`).update(fs.readFileSync(absolute)).digest("hex")];
    }).sort(([a], [b]) => a.localeCompare(b)));
}
