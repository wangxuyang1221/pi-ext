import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, rmdir } from "node:fs/promises";
import { join, extname, dirname, resolve, basename } from "node:path";

export interface ContentReference { bundleId: string; digest: string; attachments: Array<{ name: string; digest: string }> }
export interface PreparedGoal { objective: string; content?: ContentReference }
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Validate metadata before using any component as a path. */
export function validateContent(value: ContentReference): void {
  if (!value || !UUID.test(value.bundleId) || !/^[a-f0-9]{64}$/.test(value.digest)
    || !Array.isArray(value.attachments) || value.attachments.length > 32
    || value.attachments.some(image => !image || !/^image-\d+\.(png|jpg|jpeg|gif|webp)$/.test(image.name) || !/^[a-f0-9]{64}$/.test(image.digest))
    || new Set(value.attachments.map(image => image.name)).size !== value.attachments.length) throw new Error("Invalid goal content reference.");
}
const IMAGE_NAME = /^pi-clipboard-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|jpeg|gif|webp)$/;
async function checkDirectories(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await checkDirectories(parent);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Goal content rejects symbolic link directories.");
}
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
async function readRegular(path: string, limit = MAX_IMAGE_BYTES): Promise<Buffer> {
  await checkDirectories(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("Goal content requires a regular file.");
    if (info.size > limit) throw new Error("Goal content exceeds the file size limit.");
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > info.size || count > limit) throw new Error("Goal content changed during reading or exceeds the file size limit.");
    return buffer.subarray(0, count);
  } finally { await file.close(); }
}

interface CreatedFile { path: string; ino: number; dev: number }
async function writeSynced(path: string, data: string | Buffer, created: CreatedFile[]): Promise<void> {
  const file = await open(path, "wx", 0o600);
  try {
    const info = await file.stat();
    created.push({ path, ino: info.ino, dev: info.dev });
    await file.writeFile(data);
    await file.sync();
  } finally { await file.close(); }
}
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const file = await open(path, "r");
  try { await file.sync(); } finally { await file.close(); }
}
function isImage(bytes: Buffer, extension: string): boolean {
  switch (extension) {
    case ".png": return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case ".jpg": case ".jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case ".gif": return /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"));
    case ".webp": return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    default: return false;
  }
}

/** Immutable content packages keep edits independent of inherited snapshots. */
export class GoalContent {
  private readonly drafts = new WeakMap<PreparedGoal, { directory: string; ino: number; dev: number; files: CreatedFile[] }>();
  constructor(readonly root: string, readonly temporaryRoot: string) {}
  objectivePath(reference: ContentReference): string { validateContent(reference); return join(this.root, reference.bundleId, "objective.txt"); }
  private reference(content: ContentReference): string { return `Read the full goal objective from ${JSON.stringify(this.objectivePath(content))}.`; }
  /** Recognize native paste filenames without opening any candidate file. */
  candidates(objective: string): string[] {
    if (Buffer.byteLength(objective) > MAX_TEXT_BYTES) throw new Error("Goal objective exceeds the 1 MiB text limit.");
    const prefix = join(resolve(this.temporaryRoot), "pi-clipboard-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![^\\s\\"'\\\x60(])${prefix}[a-f0-9-]+\\.(?:png|jpg|jpeg|gif|webp)(?=$|[\\s\\"'\\\x60),])`, "g");
    return [...new Set(objective.match(pattern) ?? [])].filter(path => IMAGE_NAME.test(basename(path)));
  }
  async prepare(objective: string, selected: string[], previous?: PreparedGoal): Promise<PreparedGoal> {
    if (!objective.trim()) throw new Error("Goal objective must not be empty.");
    if (Buffer.byteLength(objective) > MAX_TEXT_BYTES || selected.length > 32) throw new Error("Goal content limit: 1 MiB objective, 32 attachments, 20 MiB per image.");
    for (const source of selected) {
      if (dirname(source) !== resolve(this.temporaryRoot) || !IMAGE_NAME.test(basename(source)) || !objective.includes(source)) throw new Error("Only explicitly selected native paste image paths are accepted.");
      const info = await lstat(source);
      if (info.isSymbolicLink()) throw new Error("Goal content rejects source symlinks.");
    }
    const retained = previous ? (await this.attachments(previous)).filter(path => objective.includes(path)) : [];
    const sources = [...new Set([...selected, ...retained])];
    if (sources.length > 32) throw new Error("Goal attachment count exceeds the limit of 32.");
    if ([...objective].length <= 4000 && !sources.length) return { objective, content: undefined };
    const content: ContentReference = { bundleId: randomUUID(), digest: digest(objective), attachments: [] };
    await checkDirectories(dirname(this.root));
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await checkDirectories(this.root);
    await mkdir(join(this.root, content.bundleId), { mode: 0o700 });
    const directory = join(this.root, content.bundleId);
    const info = await lstat(directory);
    const draft = { directory, ino: info.ino, dev: info.dev, files: [] as CreatedFile[] };
    const prepared: PreparedGoal = { objective: "", content };
    this.drafts.set(prepared, draft);
    try {
      for (const source of sources) {
        const bytes = await readRegular(retained.includes(source) ? source : join(await realpath(this.temporaryRoot), basename(source)));
        if (!isImage(bytes, extname(source))) throw new Error("Selected paste file is not a supported image.");
        const name = `image-${content.attachments.length}${extname(source)}`;
        const destination = join(directory, name);
        await writeSynced(destination, bytes, draft.files);
        content.attachments.push({ name, digest: digest(bytes) });
        objective = objective.replaceAll(source, destination);
      }
      if (Buffer.byteLength(objective) > MAX_TEXT_BYTES) throw new Error("Goal content exceeds the text size limit after attachment expansion.");
      content.digest = digest(objective);
      await writeSynced(this.objectivePath(content), objective, draft.files);
      await syncDirectory(directory);
      await syncDirectory(this.root);
      prepared.objective = this.reference(content);
      if ([...prepared.objective].length > 4000) throw new Error("Goal content reference exceeds the 4000 character limit.");
      return prepared;
    } catch (error) { await this.discard(prepared); throw error; }
  }
  /** Delete only files created by this instance for this exact uncommitted draft. */
  async discard(prepared: PreparedGoal): Promise<void> {
    const draft = this.drafts.get(prepared);
    if (!draft) return;
    this.drafts.delete(prepared);
    try {
      await checkDirectories(draft.directory);
      const info = await lstat(draft.directory);
      if (info.ino !== draft.ino || info.dev !== draft.dev) return;
      for (const file of draft.files) {
        const current = await lstat(file.path).catch(() => undefined);
        if (current?.isFile() && current.ino === file.ino && current.dev === file.dev) await unlink(file.path).catch(() => {});
      }
      await rmdir(draft.directory);
    } catch { /* Leave uncertain files for explicit repair, never recurse. */ }
  }
  async attachments(goal: PreparedGoal): Promise<string[]> {
    await this.expand(goal);
    return goal.content?.attachments.map(image => join(this.root, goal.content!.bundleId, image.name)) ?? [];
  }
  async expand(goal: PreparedGoal): Promise<string> {
    if (!goal.content) return goal.objective;
    if (goal.objective !== this.reference(goal.content)) throw new Error("Invalid goal content reference.");
    const text = (await readRegular(this.objectivePath(goal.content), MAX_TEXT_BYTES)).toString("utf8");
    if (digest(text) !== goal.content.digest) throw new Error("Goal content checksum mismatch.");
    for (const image of goal.content.attachments) {
      const bytes = await readRegular(join(this.root, goal.content.bundleId, image.name));
      if (digest(bytes) !== image.digest) throw new Error("Goal attachment checksum mismatch.");
    }
    return text;
  }
}
