/** Track the first closed **title** using offsets, without retaining cumulative reasoning. */
export class ReasoningTitle {
  private length = 0;
  private opening = -1;
  private stars = 0;
  private finished = false;
  private title: string | undefined;

  reset(): void {
    this.length = 0; this.opening = -1; this.stars = 0;
    this.finished = false; this.title = undefined;
  }

  read(text: string, delta?: string): string | undefined {
    // Provider delta events append. A non-append snapshot must start a fresh scan.
    if (delta === undefined || text.length !== this.length + delta.length || !text.endsWith(delta)) this.reset();
    const start = this.length;
    this.length = text.length;
    if (this.finished) return this.title;
    for (let index = start; index < text.length; index++) {
      if (text.charCodeAt(index) === 42) {
        this.stars++;
        if (this.stars >= 2) {
          const end = index - 1;
          if (this.opening >= 0 && end > this.opening) {
            this.title = text.slice(this.opening, end).replace(/\s+/gu, " ").trim() || undefined;
            this.finished = true;
            return this.title;
          }
          this.opening = index + 1;
        }
      } else {
        if (this.stars === 1) this.opening = -1;
        this.stars = 0;
      }
    }
    return undefined;
  }
}
