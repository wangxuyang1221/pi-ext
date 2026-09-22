export const STYLES = ['before', 'after', 'neutral', 'soft', 'quiet'];
export const LABELS = { before: 'Before', after: 'After', neutral: 'Neutral text', soft: 'Soft green', quiet: 'Quiet metadata' };

// Change only success text in result bodies; title markers keep the shared theme.
export function resultTheme(style, theme) {
  if (!['neutral', 'soft', 'quiet'].includes(style)) return theme;
  return new Proxy(theme, { get(target, key) {
    if (key === 'fg') return (tone, text) => {
      if (tone !== 'success') return target.fg(tone, text);
      if (style === 'quiet') return target.fg('dim', text);
      return style === 'neutral' ? target.fg('text', text) : `\x1b[38;2;143;184;155m${text}\x1b[39m`;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
