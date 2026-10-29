/** Count JSON syntax and decoded string units without retaining the input. */
export class JsonUnits {
  private quoted = false;
  private escaped = false;
  private unicode = 0;

  push(text: string): number {
    let units = 0;
    for (let index = 0; index < text.length; index++) units += this.consume(text[index]!);
    return units;
  }

  private consume(char: string): number {
    if (this.unicode) { this.unicode--; return this.unicode === 0 ? 1 : 0; }
    if (this.escaped) return this.consumeEscape(char);
    if (this.quoted && char === "\\") { this.escaped = true; return 0; }
    if (char === '"') this.quoted = !this.quoted;
    return !this.quoted && /\s/u.test(char) ? 0 : 1;
  }
  private consumeEscape(char: string): number {
    this.escaped = false;
    if (char === "u") { this.unicode = 4; return 0; }
    return 1;
  }
}

/** Match streamed arguments without counting serialization whitespace or escapes twice. */
export function argumentUnits(args: Record<string, unknown>): number {
  return new JsonUnits().push(JSON.stringify(args));
}
