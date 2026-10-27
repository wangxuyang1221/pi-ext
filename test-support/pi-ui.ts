import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const unexpected = (): never => { throw new Error("Unexpected UI interaction in fixture"); };

/** Supply the complete host interface; tests explicitly opt into interactive operations. */
export function createTestUi(overrides: Partial<ExtensionUIContext> = {}): ExtensionUIContext {
  const theme = getThemeByName("dark");
  if (!theme) throw new Error("Missing built-in dark theme");
  return {
    select: unexpected, confirm: unexpected, input: unexpected, editor: unexpected, custom: unexpected,
    notify() {}, onTerminalInput: () => () => {}, setStatus() {}, setWorkingMessage() {}, setWorkingVisible() {},
    setWorkingIndicator() {}, setHiddenThinkingLabel() {}, setWidget() {}, setFooter() {}, setHeader() {}, setTitle() {},
    pasteToEditor() {}, setEditorText() {}, getEditorText: () => "", addAutocompleteProvider() {}, setEditorComponent() {},
    getEditorComponent: () => undefined, theme, getAllThemes: () => [], getTheme: getThemeByName,
    setTheme: () => ({ success: true }), getToolsExpanded: () => false, setToolsExpanded() {}, ...overrides,
  };
}
