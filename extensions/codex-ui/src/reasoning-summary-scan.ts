type Phase = "indent" | "opening" | "title" | "closing" | "trailing" | "ignored";

/** Incrementally recognize standalone **titles** using source offsets, not retained text. */
export class SummaryScanner {
  private phase: Phase = "indent";
  private start = -1;
  private end = -1;
  private committedStart = -1;
  private committedEnd = -1;

  clone(): SummaryScanner { return Object.assign(new SummaryScanner(), this); }

  /** Append only a suffix whose prefix the caller has verified against the prior snapshot. */
  append(text: string, offset = 0): void {
    for (let i = offset; i < text.length; i++) {
      const char = text[i]!;
      if (char === "\n") {
        if (this.phase === "trailing" && this.end > this.start) {
          this.committedStart = this.start; this.committedEnd = this.end;
        }
        this.phase = "indent"; this.start = -1; this.end = -1;
        continue;
      }
      switch (this.phase) {
        case "indent":
          if (char !== " " && char !== "\t") this.phase = char === "*" ? "opening" : "ignored";
          break;
        case "opening":
          this.phase = char === "*" ? "title" : "ignored";
          this.start = i + 1;
          break;
        case "title":
          if (char === "*") { this.end = i; this.phase = "closing"; }
          else if (char === "\r") this.phase = "ignored";
          break;
        case "closing":
          this.phase = char === "*" ? "trailing" : "ignored";
          break;
        case "trailing":
          if (char !== " " && char !== "\t" && char !== "\r") this.phase = "ignored";
          break;
        case "ignored": {
          const next = text.indexOf("\n", i);
          if (next < 0) return;
          i = next - 1;
          break;
        }
      }
    }
  }

  getTitle(text: string): string | undefined {
    const pending = this.phase === "trailing" && this.end > this.start;
    const start = pending ? this.start : this.committedStart;
    const end = pending ? this.end : this.committedEnd;
    return start >= 0 ? text.slice(start, end) : undefined;
  }
}
