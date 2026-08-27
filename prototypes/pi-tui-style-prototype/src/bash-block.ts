// PROTOTYPE: Three Bash tool block directions, switchable with ?variant=a|b|c.

export {};

type VariantKey = "a" | "b" | "c";

interface Variant {
  key: VariantKey;
  name: string;
  note: string;
  implementation: string;
}

interface PrototypeState {
  variant: VariantKey;
  expanded: boolean;
  boundaries: boolean;
}

const variants: Variant[] = [
  {
    key: "a",
    name: "Quiet native",
    note: "Keep Pi's success shell and make the built-in hierarchy calmer.",
    implementation: "default shell · custom renderCall + renderResult",
  },
  {
    key: "b",
    name: "Command receipt",
    note: "Separate status, command, output, and hidden-line metadata.",
    implementation: "default shell · structured inner components",
  },
  {
    key: "c",
    name: "Inline rail",
    note: "Remove the card fill and treat Bash as a lightweight transcript event.",
    implementation: "renderShell: self · custom framing",
  },
];

const command = "printf 'Required headings:\\n'; rg '^## (Handoff Position|Current Goal or Problem|Evolution|Agreed Decisions and Constraints|Established Facts and Required Context|Current Assumptions|Continuation Point)$' handoff/handoff-20260825-180824.md; printf '\\nStatus:\\n'; git status --short --branch";

const outputLines = [
  "Required headings:",
  "## Handoff Position",
  "## Current Goal or Problem",
  "## Evolution",
  "## Agreed Decisions and Constraints",
  "## Established Facts and Required Context",
  "## Current Assumptions",
  "## Continuation Point",
  "",
  "Status:",
  "## main...origin/main",
  "?? .pi/",
  "?? .scratch/",
  "?? AGENTS.md",
  "?? docs/",
  "?? handoff/",
];

const params = new URLSearchParams(location.search);
const requestedVariant = params.get("variant")?.toLowerCase();
const state: PrototypeState = {
  variant: requestedVariant === "b" || requestedVariant === "c" ? requestedVariant : "a",
  expanded: params.get("expanded") === "1",
  boundaries: params.get("boundaries") === "1",
};

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("Prototype mount point not found");
  return element;
}

const app = getAppRoot();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentVariant(): Variant {
  return variants.find((variant) => variant.key === state.variant) ?? variants[0];
}

function currentVariantIndex(): number {
  return variants.findIndex((variant) => variant.key === state.variant);
}

function visibleOutput(): { lines: string[]; hidden: number } {
  if (state.expanded) return { lines: outputLines, hidden: 0 };
  const lines = outputLines.slice(-5);
  return { lines, hidden: outputLines.length - lines.length };
}

function boundary(label: string): string {
  return state.boundaries
    ? `<span class="boundary-tag" aria-hidden="true">${escapeHtml(label)}</span>`
    : "";
}

function renderOutputLines(className: string): string {
  const { lines } = visibleOutput();
  return `<pre class="${className}">${lines.map(escapeHtml).join("\n")}</pre>`;
}

function renderVariantA(): string {
  const { hidden } = visibleOutput();
  return `
    <section class="bash-event variant-a-block" data-toggle-expanded tabindex="0" aria-label="Toggle Bash output">
      ${boundary("default shell")}
      <div class="a-call">
        ${boundary("renderCall")}
        <span class="shell-prompt">$</span>
        <span class="command-text">${escapeHtml(command)}</span>
        <span class="timeout">(timeout 30s)</span>
      </div>
      <div class="a-result">
        ${boundary("renderResult")}
        ${hidden > 0 ? `<div class="a-fold"><span class="ellipsis">…</span> ${hidden} earlier visual lines <span class="key">ctrl+o</span> to expand</div>` : ""}
        ${renderOutputLines("a-output")}
        <div class="a-duration">Took 0.0s</div>
      </div>
    </section>
  `;
}

function renderVariantB(): string {
  const { hidden } = visibleOutput();
  return `
    <section class="bash-event variant-b-block" data-toggle-expanded tabindex="0" aria-label="Toggle Bash output">
      ${boundary("default shell")}
      <div class="b-summary">
        ${boundary("renderCall")}
        <span class="b-status">✓</span>
        <strong>Bash</strong>
        <span class="b-state">completed</span>
        <span class="b-meta">0.0s · 30s limit</span>
      </div>
      <div class="b-command">
        <span class="shell-prompt">$</span>
        <span class="command-text">${escapeHtml(command)}</span>
      </div>
      <div class="b-result">
        ${boundary("renderResult")}
        ${renderOutputLines("b-output")}
      </div>
      <div class="b-footer">
        <span>${hidden > 0 ? `${hidden} earlier visual lines hidden` : `${outputLines.length} visual lines`}</span>
        <span><span class="key">ctrl+o</span> ${state.expanded ? "collapse" : "expand"}</span>
      </div>
    </section>
  `;
}

function renderVariantC(): string {
  const { hidden } = visibleOutput();
  return `
    <section class="bash-event variant-c-block" data-toggle-expanded tabindex="0" aria-label="Toggle Bash output">
      ${boundary("self shell")}
      <div class="c-rail" aria-hidden="true"></div>
      <div class="c-body">
        <div class="c-summary">
          ${boundary("renderCall")}
          <span><span class="c-status">✓</span> bash</span>
          <span class="c-meta">0.0s · 30s limit</span>
        </div>
        <div class="c-command">
          <span class="shell-prompt">$</span>
          <span class="command-text">${escapeHtml(command)}</span>
        </div>
        <div class="c-result">
          ${boundary("renderResult")}
          ${hidden > 0 ? `<div class="c-fold">${hidden} earlier visual lines hidden · <span class="key">ctrl+o</span> to expand</div>` : ""}
          ${renderOutputLines("c-output")}
        </div>
      </div>
    </section>
  `;
}

function renderBashEvent(): string {
  if (state.variant === "b") return renderVariantB();
  if (state.variant === "c") return renderVariantC();
  return renderVariantA();
}

function renderSwitcher(): string {
  const variant = currentVariant();
  return `
    <nav class="prototype-switcher" aria-label="Bash block prototype variants">
      <button type="button" class="arrow-button" data-cycle="-1" aria-label="Previous variant">←</button>
      <div class="variant-copy">
        <strong>${state.variant.toUpperCase()} · ${escapeHtml(variant.name)}</strong>
        <span>${escapeHtml(variant.note)}</span>
      </div>
      <div class="variant-dots" aria-label="Choose variant">
        ${variants.map((item) => `<button type="button" class="dot ${item.key === state.variant ? "active" : ""}" data-variant="${item.key}" aria-label="Variant ${item.key.toUpperCase()}"></button>`).join("")}
      </div>
      <button type="button" class="state-button ${state.expanded ? "active" : ""}" data-action="expanded">${state.expanded ? "Expanded" : "Collapsed"}</button>
      <button type="button" class="state-button ${state.boundaries ? "active" : ""}" data-action="boundaries">Boundaries</button>
      <button type="button" class="arrow-button" data-cycle="1" aria-label="Next variant">→</button>
    </nav>
  `;
}

function render(): void {
  const variant = currentVariant();
  app.innerHTML = `
    <main class="prototype-page variant-${state.variant}">
      <div class="wallpaper" aria-hidden="true"><span></span><span></span></div>
      <header class="prototype-caption">
        <span>THROWAWAY PROTOTYPE · PI BASH TOOL BLOCK</span>
        <span class="state-readout">variant=${state.variant} · expanded=${state.expanded ? "yes" : "no"} · ${escapeHtml(variant.implementation)}</span>
      </header>
      <section class="ghostty-window" aria-label="Ghostty terminal preview">
        <div class="ghostty-titlebar">
          <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="window-title">π · pi-ext</div>
          <div></div>
        </div>
        <div class="terminal-screen">
          <div class="transcript">
            <div class="assistant-copy">I’ll verify the handoff structure and current worktree state before wrapping up.</div>
            ${renderBashEvent()}
            <div class="assistant-copy after-tool"><span class="assistant-marker">•</span> The required sections are present. The tracked worktree is clean.</div>
          </div>
          <div class="composer"><span class="composer-prompt">›</span><span class="composer-placeholder">Ask Pi to do anything</span><span class="fake-cursor"></span></div>
          <div class="footer"><span class="footer-warning">gpt-5.6-sol high</span><span>·</span><span class="footer-success">~/Code/t3code/pi-ext</span><span>·</span><span class="footer-warning">Context 86% left</span><span>·</span><span>MCP 4/4 · 23 tools</span><span>·</span><span>full access</span><span class="fast">fast</span></div>
        </div>
      </section>
      <aside class="variant-note">
        <strong>${state.variant.toUpperCase()} · ${escapeHtml(variant.name)}</strong>
        <span>${escapeHtml(variant.implementation)}</span>
      </aside>
      ${renderSwitcher()}
    </main>
  `;
}

function updateUrl(): void {
  const next = new URL(location.href);
  next.searchParams.set("variant", state.variant);
  next.searchParams.set("expanded", state.expanded ? "1" : "0");
  if (state.boundaries) next.searchParams.set("boundaries", "1");
  else next.searchParams.delete("boundaries");
  history.replaceState(null, "", next);
}

function setVariant(key: VariantKey): void {
  state.variant = key;
  updateUrl();
  render();
}

function cycleVariant(direction: number): void {
  const index = (currentVariantIndex() + direction + variants.length) % variants.length;
  setVariant(variants[index].key);
}

function toggleExpanded(): void {
  state.expanded = !state.expanded;
  updateUrl();
  render();
}

app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const cycleButton = target.closest<HTMLElement>("[data-cycle]");
  if (cycleButton) {
    cycleVariant(Number(cycleButton.dataset.cycle));
    return;
  }

  const variantButton = target.closest<HTMLElement>("[data-variant]");
  if (variantButton?.dataset.variant) {
    setVariant(variantButton.dataset.variant as VariantKey);
    return;
  }

  const actionButton = target.closest<HTMLElement>("[data-action]");
  if (actionButton?.dataset.action === "expanded") {
    toggleExpanded();
    return;
  }
  if (actionButton?.dataset.action === "boundaries") {
    state.boundaries = !state.boundaries;
    updateUrl();
    render();
    return;
  }

  if (target.closest("[data-toggle-expanded]")) toggleExpanded();
});

app.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && (event.target as HTMLElement).matches("[data-toggle-expanded]")) {
    event.preventDefault();
    toggleExpanded();
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input, textarea, [contenteditable='true']")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

window.addEventListener("popstate", () => location.reload());

updateUrl();
render();
