export const STYLES = ['after'];
export const LABELS = { after: 'Approved style' };

// Success text uses the approved green; title markers keep the shared theme.
export function resultTheme(theme) {
  return new Proxy(theme, { get(target, key) {
    if (key === 'fg') return (tone, text) => tone === 'success'
      ? `\x1b[38;2;70;232;124m${text}\x1b[39m`
      : target.fg(tone, text);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
