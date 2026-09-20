import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { ReadGroups, type ReadMember, type ReadView } from "./read-groups.js";
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

  constructor(private readonly groups: ReadGroups, private readonly view: ReadView) {}

  update(expanded: boolean, theme: Theme): void {
    if (this.expanded !== expanded || this.theme !== theme) this.invalidate();
    this.expanded = expanded; this.theme = theme;
  }

  render(width: number): string[] {
    const member = this.groups.resolve(this.view);
    if (this.member !== member || this.group !== member.group || this.version !== member.group.version) {
      this.member = member; this.group = member.group; this.version = member.group.version;
      this.lines.setRenderer(columns => renderReadGroup(member, this.expanded, this.theme!, columns), { linesAlreadyFit: true });
    }
    return this.lines.render(width);
  }

  invalidate(): void { this.lines.invalidate(); }
}
