import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { normalizeOutputPad, padOutputLines, resolveOutputPad } from "./layout.js";
import type { ReadMember } from "./read-groups.js";
import type { GroupLayout } from "./native-tools.js";
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
  private expandKeys = "ctrl+o";
  private renderedExpandKeys = "";

  constructor(private readonly current: () => ReadMember, private readonly renderGroup: GroupLayout["read"]) {}

  update(expanded: boolean, theme: Theme, outputPad = 0, expandKeys = "ctrl+o"): void {
    const normalizedPad = normalizeOutputPad(outputPad);
    if (
      this.expanded !== expanded
      || this.theme !== theme
      || this.outputPad !== normalizedPad
      || this.expandKeys !== expandKeys
    ) {
      this.invalidate();
    }
    this.expanded = expanded;
    this.theme = theme;
    this.outputPad = normalizedPad;
    this.expandKeys = expandKeys;
  }

  render(width: number): string[] {
    const member = this.current();
    if (
      this.member !== member
      || this.group !== member.group
      || this.version !== member.group.version
      || this.renderedPad !== this.outputPad
      || this.renderedExpandKeys !== this.expandKeys
    ) {
      this.member = member;
      this.group = member.group;
      this.version = member.group.version;
      this.renderedPad = this.outputPad;
      this.renderedExpandKeys = this.expandKeys;
      const outputPad = this.outputPad;
      const expandKeys = this.expandKeys;
      this.lines.setRenderer((columns) => {
        const pad = resolveOutputPad(columns, outputPad);
        return padOutputLines(
          this.renderGroup(member, this.expanded, this.theme!, columns - pad * 2, expandKeys),
          columns,
          pad,
        );
      }, { linesAlreadyFit: true });
    }
    return this.lines.render(width);
  }

  invalidate(): void { this.lines.invalidate(); }
}
