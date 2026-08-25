// PROTOTYPE: Three Pi TUI visual directions, switchable with ?variant=codex|claude|hybrid.

type VariantKey = "codex" | "claude" | "hybrid";

type PrototypeState = {
  variant: VariantKey;
  inspectHooks: boolean;
  expandedTools: Record<VariantKey, boolean>;
  drafts: Record<VariantKey, string>;
  submitted: Record<VariantKey, boolean>;
};

const variants: Array<{ key: VariantKey; name: string; note: string }> = [
  { key: "codex", name: "Codex / Pi Workbench", note: "Pi-native transcript, delegated edit renderer, extension footer" },
  { key: "claude", name: "Claude / Pi Conversation", note: "Pi wordmark, fixed message shell, custom mode footer" },
  { key: "hybrid", name: "Hybrid / Pi Session Shell", note: "Supported custom surfaces with a non-reflowing overlay" },
];

const initialVariant = getVariantFromUrl();
const state: PrototypeState = {
  variant: initialVariant,
  inspectHooks: new URLSearchParams(location.search).get("hooks") === "1",
  expandedTools: { codex: true, claude: true, hybrid: true },
  drafts: { codex: "", claude: "", hybrid: "" },
  submitted: { codex: false, claude: false, hybrid: false },
};

function getAppRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("Missing #app");
  return element;
}

const app = getAppRoot();

function getVariantFromUrl(): VariantKey {
  const value = new URLSearchParams(location.search).get("variant");
  return value === "claude" || value === "hybrid" ? value : "codex";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setUrlState(): void {
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  if (state.inspectHooks) params.set("hooks", "1");
  else params.delete("hooks");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function currentVariantIndex(): number {
  return variants.findIndex((variant) => variant.key === state.variant);
}

function cycleVariant(direction: -1 | 1): void {
  const nextIndex = (currentVariantIndex() + direction + variants.length) % variants.length;
  state.variant = variants[nextIndex].key;
  setUrlState();
  render();
}

function renderCodex(): string {
  const expanded = state.expandedTools.codex;
  const draft = escapeHtml(state.drafts.codex);
  return `
    <section class="terminal-view codex-view" aria-label="Codex-inspired Pi interface">
      <div class="terminal-scroll codex-transcript">
        <header class="codex-header" data-hook="EXACT · setHeader + width-aware cell layout">
          <div class="codex-brand"><strong class="pi-wordmark">pi</strong> <span class="muted">v0.84.3 · Codex profile</span></div>
          <div class="codex-header-grid">
            <span class="muted">model:</span><span><strong>gpt-5.6-luna medium</strong> <span class="magenta">fast</span></span><span class="cyan">/model</span><span class="muted">to change</span>
            <span class="muted">directory:</span><strong>~/Code/t3code/pi-ext</strong><span></span><span></span>
          </div>
        </header>

        <div class="codex-system-row" data-hook="NATIVE · Pi status row"><span class="bullet">•</span><span>Model changed to <strong>gpt-5.6-luna medium</strong></span></div>
        <p class="codex-tip"><strong>Tip:</strong> Press <span class="key">ctrl+o</span> to expand tool output without leaving the flow.</p>

        <div class="codex-user native-user" data-hook="NATIVE · UserMessageComponent; same-color › via MarkdownTransformer">
          <span>› Build three terminal themes that fit my Ghostty setup, then compare the tradeoffs.</span>
        </div>

        <div class="native-list-message codex-answer" data-hook="EXACT · MarkdownTransformer '- ' + mdListBullet">
          <span class="md-list-marker">-</span>
          <div>I’ll inspect the Pi extension hooks and your Ghostty palette, then keep the prototype focused on surfaces that can actually be reproduced.</div>
        </div>

        <button class="tool-cluster codex-tool-toggle" type="button" data-toggle-tool aria-expanded="${expanded}" data-hook="EXACT · custom inspect_workspace renderer; expanded from Pi Ctrl+O">
          <span class="bullet">•</span><strong>Inspect workspace</strong><span class="tool-count">4 reads</span><span class="chevron">${expanded ? "⌄" : "›"}</span>
        </button>
        ${expanded ? `
          <div class="codex-tool-lines">
            <div><span class="tree">├</span><span>Read <span class="cyan">~/.config/ghostty/config.ghostty</span></span></div>
            <div><span class="tree">├</span><span>Read <span class="cyan">docs/tui.md</span></span></div>
            <div><span class="tree">├</span><span>Search <span class="muted">setFooter · setEditorComponent · renderDiff</span></span></div>
            <div><span class="tree">└</span><span>Read <span class="cyan">extensions/mcp/src/index.ts</span></span></div>
          </div>
        ` : ""}

        <div class="codex-edit-block" data-hook="DELEGATED · register edit + createEditTool execution + renderShell:self">
          <div class="codex-section-title">
            <span class="bullet">•</span><strong>Edited</strong> <span class="path">styles.css</span>
            <span>(<span class="success">+3</span> <span class="danger">−1</span>)</span>
          </div>
          <div class="codex-diff">
            <div class="diff-context"><span>118</span><span>.terminal-view {</span></div>
            <div class="diff-removed"><span>119</span><span>- background: #111111;</span></div>
            <div class="diff-added"><span>119</span><span>+ background: rgba(41, 41, 41, 0.85);</span></div>
            <div class="diff-added"><span>120</span><span>+ backdrop-filter: blur(50px);</span></div>
            <div class="diff-context"><span>121</span><span>}</span></div>
          </div>
        </div>

        <div class="native-list-message codex-answer final" data-hook="EXACT · MarkdownTransformer '- ' + mdListBullet">
          <span class="md-list-marker">-</span>
          <div><strong>Prototype ready.</strong><p>The interface stays flat and quiet. Cyan identifies actions, while status segments keep model, path, context, and extension state visible.</p></div>
        </div>
        ${state.submitted.codex ? `<div class="codex-user native-user codex-submitted"><span>› ${draft || "Open the visual comparison."}</span></div>` : ""}
      </div>

      <div class="codex-bottom">
        <div class="codex-composer" data-hook="EXACT · setEditorComponent + ANSI cell background">
          <span class="composer-prompt">›</span>
          <div class="composer-input" contenteditable="true" role="textbox" aria-label="Codex composer" data-composer data-placeholder="Ask Codex to do anything" spellcheck="false">${draft}</div>
        </div>
        <footer class="codex-footer" data-hook="EXACT · setFooter + FooterDataProvider statuses">
          <span class="codex-model">gpt-5.6-luna medium</span>
          <span class="codex-fast">fast</span><span class="status-separator">·</span>
          <span class="codex-path">~/Code/t3code/pi-ext</span><span class="status-separator">·</span>
          <span class="codex-context">Context 72% left</span><span class="status-separator">·</span>
          <span class="codex-weekly">weekly 76% left</span>
        </footer>
      </div>
    </section>
  `;
}

function renderClaude(): string {
  const expanded = state.expandedTools.claude;
  const draft = escapeHtml(state.drafts.claude);
  return `
    <section class="terminal-view claude-view" aria-label="Claude-inspired Pi interface">
      <div class="terminal-scroll claude-transcript">
        <header class="claude-header" data-hook="EXACT · setHeader + width-aware Unicode frame">
          <div class="claude-header-label"><strong class="pi-wordmark">pi</strong> <span>v0.84.3 · Claude profile</span></div>
          <div class="claude-welcome-left">
            <strong>Welcome, hack!</strong>
            <pre class="pi-cell-logo" aria-label="Pi cell logo">███  █
███  █
█    █</pre>
            <div class="muted">Opus 5 (1M context) · high effort</div>
            <div class="muted">~/Code/t3code/pi-ext</div>
          </div>
          <div class="claude-welcome-right">
            <section>
              <strong>Tips for getting started</strong>
              <div>Use <span class="key">/settings</span> to choose a theme and <span class="key">/model</span> to switch models</div>
            </section>
            <section>
              <strong>Active custom surfaces</strong>
              <div>Header, editor, and footer are replaced by this profile</div>
              <div>Read and edit keep official execution through delegated tools</div>
              <div class="muted"><em>/reload to refresh extensions</em></div>
            </section>
          </div>
        </header>

        <div class="claude-user native-user" data-hook="NATIVE · UserMessageComponent; same-color › via MarkdownTransformer">
          <span>› Build three terminal themes that fit my Ghostty setup, then compare the tradeoffs.</span>
        </div>

        <div class="native-list-message claude-message" data-hook="EXACT · MarkdownTransformer '- ' + mdListBullet">
          <span class="md-list-marker">-</span>
          <div>I’ll map the available Pi surfaces first, then build the prototype against your actual font, opacity, and ANSI palette.</div>
        </div>

        <div class="claude-thought muted" data-hook="EXACT · hideThinkingBlock + global static setHiddenThinkingLabel"><span>*</span> <em>Cogitated</em></div>

        <button class="tool-cluster claude-tool-toggle" type="button" data-toggle-tool aria-expanded="${expanded}" data-hook="DELEGATED · register read + createReadTool execution; expanded from Pi Ctrl+O">
          <span class="claude-action-dot">●</span><strong>Read</strong><span class="muted">(~/.config/ghostty/config.ghostty)</span><span class="chevron">${expanded ? "⌄" : "›"}</span>
        </button>
        ${expanded ? `
          <div class="claude-tool-tree">
            <div><span class="tree">⎿</span> Read <strong>74 lines</strong></div>
            <div><span class="tree">⎿</span> Background <span class="cyan">#292929</span> · opacity 85% · blur 50</div>
          </div>
        ` : ""}

        <div class="claude-tool-call" data-hook="DELEGATED · register edit + createEditTool execution + renderShell:self">
          <div><span class="claude-action-dot">●</span><strong>Update</strong><span class="muted">(styles.css)</span></div>
          <div class="claude-diff">
            <div class="diff-removed"><span>119</span><span>- background: #111111;</span></div>
            <div class="diff-added"><span>119</span><span>+ background: rgba(41, 41, 41, 0.85);</span></div>
            <div class="diff-added"><span>120</span><span>+ backdrop-filter: blur(50px);</span></div>
          </div>
          <div class="claude-result muted">⎿ Updated 1 file · 2 additions, 1 removal</div>
        </div>

        <div class="native-list-message claude-message final" data-hook="EXACT · MarkdownTransformer '- ' + mdListBullet">
          <span class="md-list-marker">-</span>
          <div>The three directions are ready. This version keeps Pi’s native transcript and reserves the warm accent for the custom header and active tools.</div>
        </div>
        ${state.submitted.claude ? `<div class="claude-user native-user claude-submitted"><span>› ${draft || "Open the visual comparison."}</span></div>` : ""}
      </div>

      <div class="claude-bottom">
        <div class="claude-effort" data-hook="EXACT · aboveEditor widget"><span>●</span> high · <span>/effort</span></div>
        <div class="claude-composer" data-hook="EXACT · setEditorComponent + character border lines">
          <span class="composer-prompt">›</span>
          <div class="composer-input" contenteditable="true" role="textbox" aria-label="Claude composer" data-composer data-placeholder="How should Pi continue?" spellcheck="false">${draft}</div>
        </div>
        <footer class="claude-footer" data-hook="EXACT · setFooter">
          <span class="permission-mode"><strong>›› auto mode on</strong></span>
          <span class="muted">(shift+tab to cycle)</span>
          <span class="muted">· ← 1 agent</span>
        </footer>
      </div>
    </section>
  `;
}

function renderHybrid(): string {
  const expanded = state.expandedTools.hybrid;
  const draft = escapeHtml(state.drafts.hybrid);
  return `
    <section class="terminal-view hybrid-view" aria-label="Hybrid Pi interface">
      <header class="hybrid-header" data-hook="EXACT · setHeader + manually aligned cell columns">
        <div class="hybrid-brand"><strong class="pi-wordmark">pi</strong><span class="muted">v0.84.3 · Hybrid profile</span><span class="hybrid-text-badge">[priority]</span></div>
        <div class="hybrid-header-center"><span class="status-glyph">●</span> session ready</div>
        <div class="hybrid-header-right"><span>pi-ext</span><span class="muted">main*</span></div>
      </header>

      <div class="hybrid-body">
        <div class="terminal-scroll hybrid-transcript">
          <div class="hybrid-user native-user" data-hook="NATIVE · UserMessageComponent; same-color › via MarkdownTransformer">
            <span>› Build three terminal themes that fit my Ghostty setup, then compare the tradeoffs.</span>
          </div>

          <div class="hybrid-quote" data-hook="EXACT · assistant Markdown blockquote + mdQuote tokens">
            <span class="quote-border">│</span>
            <div><strong>Mapped customization surface</strong><p>Header, editor, and footer can be replaced. Tool rows, widgets, overlays, and semantic colors cover the rest of this prototype.</p></div>
          </div>

          <button class="hybrid-tool-card" type="button" data-toggle-tool aria-expanded="${expanded}" data-hook="EXACT · custom inspect_workspace renderer; expanded from Pi Ctrl+O">
            <span class="hybrid-tool-icon">⌘</span>
            <span><strong>Inspect</strong><small>Ghostty config + Pi TUI contracts</small></span>
            <span class="tool-metric">4 reads</span><span class="chevron">${expanded ? "⌄" : "›"}</span>
          </button>
          ${expanded ? `
            <div class="hybrid-tool-details">
              <div><span class="success">✓</span><span>Ghostty palette</span><span class="muted">#292929 · 85% · blur 50</span></div>
              <div><span class="success">✓</span><span>Pi replacement points</span><span class="muted">header · editor · footer</span></div>
              <div><span class="success">✓</span><span>Pi additive hooks</span><span class="muted">tools · widgets · overlays</span></div>
            </div>
          ` : ""}

          <div class="hybrid-change" data-hook="DELEGATED · register edit + createEditTool execution + renderShell:self">
            <div class="hybrid-change-head"><span><span class="orange">✻</span> Applied visual baseline</span><span class="muted">styles.css</span></div>
            <div class="hybrid-diff-grid">
              <span class="line-no">119</span><span class="diff-removed">background: #111111;</span>
              <span class="line-no">119</span><span class="diff-added">background: rgba(41, 41, 41, 0.85);</span>
              <span class="line-no">120</span><span class="diff-added">backdrop-filter: blur(50px);</span>
            </div>
          </div>

          <div class="native-list-message hybrid-answer" data-hook="EXACT · MarkdownTransformer '- ' + mdListBullet">
            <span class="md-list-marker">-</span><div><strong>Three directions, one implementation path.</strong><p>Keep Codex’s restraint, Claude’s readable action trace, and let Pi own the session controls.</p></div>
          </div>
          ${state.submitted.hybrid ? `<div class="hybrid-user native-user hybrid-submitted"><span>› ${draft || "Open the visual comparison."}</span></div>` : ""}
        </div>

        <aside class="hybrid-rail" data-hook="EXACT · persistent nonCapturing overlay; covers base cells">
          <div class="rail-title"><span>SESSION</span><span class="status-glyph">●</span></div>
          <div class="context-meter"><span>CTX</span><span class="meter-bar">[████░░░░]</span><span>29%</span></div>
          <div class="rail-section">
            <span class="rail-label">PLAN</span>
            <div class="rail-plan"><span class="done">✓</span><span>Inspect</span></div>
            <div class="rail-plan"><span class="done">✓</span><span>Prototype</span></div>
            <div class="rail-plan active"><span>●</span><span>Compare</span></div>
          </div>
          <div class="rail-section">
            <span class="rail-label">CHANGED</span>
            <div>styles.css <span class="success">+312</span></div>
            <div>main.ts <span class="success">+248</span></div>
          </div>
          <div class="rail-section rail-hooks">
            <span class="rail-label">CONNECTED</span>
            <div>MCP <span>4/4</span></div>
            <div>tools <span>23</span></div>
          </div>
        </aside>
      </div>

      <div class="hybrid-bottom">
        <div class="hybrid-composer" data-hook="EXACT · setEditorComponent + cell-aligned tags">
          <span class="pi-mark">π</span>
          <div class="composer-input" contenteditable="true" role="textbox" aria-label="Hybrid composer" data-composer data-placeholder="Describe the next change" spellcheck="false">${draft}</div>
          <span class="composer-tag">[PLAN]</span>
          <span class="composer-tag warm">[HIGH]</span>
        </div>
        <footer class="hybrid-footer" data-hook="EXACT · setFooter + FooterDataProvider statuses">
          <span>~/Code/t3code/pi-ext</span><span class="branch">main*</span>
          <span class="footer-separator">│</span><span>gpt-5.6-sol</span><span class="cyan">high</span>
          <span class="footer-spacer"></span>
          <span>MCP 4/4</span><span>23 tools</span><span class="permission-mode">full access</span><span>$1.560</span>
        </footer>
      </div>
    </section>
  `;
}

function renderTerminalContent(): string {
  if (state.variant === "claude") return renderClaude();
  if (state.variant === "hybrid") return renderHybrid();
  return renderCodex();
}

function renderSwitcher(): string {
  const current = variants[currentVariantIndex()];
  return `
    <nav class="prototype-switcher" aria-label="Prototype variants">
      <button type="button" data-cycle="-1" aria-label="Previous variant">←</button>
      <div class="variant-copy">
        <strong>${current.name}</strong>
        <span>${current.note}</span>
      </div>
      <div class="variant-dots" aria-hidden="true">
        ${variants.map((variant) => `<span class="${variant.key === state.variant ? "active" : ""}"></span>`).join("")}
      </div>
      <button type="button" class="hook-toggle ${state.inspectHooks ? "active" : ""}" data-hooks>
        ${state.inspectHooks ? "Hide Pi hooks" : "Show Pi hooks"}
      </button>
      <button type="button" data-cycle="1" aria-label="Next variant">→</button>
    </nav>
  `;
}

function render(): void {
  const current = variants[currentVariantIndex()];
  const terminalTitle = state.variant === "codex" ? "π Pi · Codex profile" : state.variant === "claude" ? "π Pi · Claude profile" : "π Pi · Hybrid profile";
  app.innerHTML = `
    <main class="prototype-page variant-${state.variant} ${state.inspectHooks ? "is-inspecting" : ""}">
      <div class="wallpaper" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="prototype-caption">
        <span>THROWAWAY UI PROTOTYPE</span>
        <span class="state-readout">variant=${state.variant} · hooks=${state.inspectHooks ? "on" : "off"} · Ghostty 128×36</span>
      </div>
      <section class="ghostty-window" aria-label="Ghostty terminal approximation">
        <div class="ghostty-titlebar">
          <div class="traffic-lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="ghostty-tab" data-hook="EXACT · setTitle"><span>${terminalTitle}</span></div>
          <div class="window-action">⤢</div>
        </div>
        <div class="ghostty-screen">${renderTerminalContent()}</div>
      </section>
      <div class="variant-mobile-label"><strong>${current.name}</strong><span>${current.note}</span></div>
      ${renderSwitcher()}
    </main>
  `;

  bindInteractions();
}

function bindInteractions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-cycle]").forEach((button) => {
    button.addEventListener("click", () => cycleVariant(button.dataset.cycle === "-1" ? -1 : 1));
  });

  document.querySelector<HTMLButtonElement>("[data-hooks]")?.addEventListener("click", () => {
    state.inspectHooks = !state.inspectHooks;
    setUrlState();
    render();
  });

  document.querySelector<HTMLButtonElement>("[data-toggle-tool]")?.addEventListener("click", () => {
    state.expandedTools[state.variant] = !state.expandedTools[state.variant];
    render();
  });

  const composer = document.querySelector<HTMLElement>("[data-composer]");
  composer?.addEventListener("input", () => {
    state.drafts[state.variant] = composer.textContent ?? "";
  });
  composer?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      state.drafts[state.variant] = composer.textContent ?? "";
      state.submitted[state.variant] = true;
      render();
    }
  });
}

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable='true']")) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
  if (event.key.toLowerCase() === "h") {
    state.inspectHooks = !state.inspectHooks;
    setUrlState();
    render();
  }
});

window.addEventListener("popstate", () => {
  state.variant = getVariantFromUrl();
  render();
});

render();
