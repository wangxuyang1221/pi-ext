import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { normalizeOutputPad, padOutputLines, resolveOutputPad } from "./layout.js";
import type { ReadMember } from "./read-groups.js";
import { renderReadGroup } from "./read-group-layout.js";
import { ResponsiveLinesComponent } from "./responsive-lines.js";

/** A replaceable row view. Check source versions before any width-only cache. */
export class ReadViewComponent implements Component {
  private readonly lines = new ResponsiveLinesComponent();
  private member?: ReadMember;
  private group?: ReadMember["group"];
  private version = -1;
  private expanded = false;
  private theme?: Theme;
  private outputPad = 0;
  private renderedPad = -1;

  constructor(private readonly current: () => ReadMember) {}

  update(expanded: boolean, theme: Theme, outputPad = 0): void {
    const normalizedPad = normalizeOutputPad(outputPad);
    if (this.expanded !== expanded || this.theme !== theme || this.outputPad !== normalizedPad) {
      this.invalidate();
    }
    this.expanded = expanded;
    this.theme = theme;
    this.outputPad = normalizedPad;
  }

  render(width: number): string[] {
    const member = this.current();
    if (
      this.member !== member
      || this.group !== member.group
      || this.version !== member.group.version
      || this.renderedPad !== this.outputPad
    ) {
      this.member = member;
      this.group = member.group;
      this.version = member.group.version;
      this.renderedPad = this.outputPad;
      const outputPad = this.outputPad;
      this.lines.setRenderer((columns) => {
        const pad = resolveOutputPad(columns, outputPad);
        return padOutputLines(
          renderReadGroup(member, this.expanded, this.theme!, columns - pad * 2),
          columns,
          pad,
        );
      }, { linesAlreadyFit: true });
    }
    return this.lines.render(width);
  }

  invalidate(): void { this.lines.invalidate(); }
}
