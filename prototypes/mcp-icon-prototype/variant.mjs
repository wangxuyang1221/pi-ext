export const VARIANTS = { "3": "⇄", "4": "::", chevron: "»", command: "⌘", wave: "⌁" };

export function variantTheme(theme, variant) {
  if (!VARIANTS[variant]) throw new Error(`Unknown icon variant: ${variant}`);
  // Replace the glyph before the production renderer measures the title.
  return new Proxy(theme, {
    get(target, key) {
      if (key === "fg") return (tone, value) => {
        const marker = value === "⏺" || value === "⌕";
        const color = marker && ["chevron", "command", "wave"].includes(variant) && tone === "success" ? "muted" : tone;
        return target.fg(color, marker ? VARIANTS[variant] : value);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
