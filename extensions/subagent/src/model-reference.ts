export const modelReferencePattern = "^[^/\\s]+/\\S+$";
const modelReferenceRegex = new RegExp(modelReferencePattern, "u");

export function validateModelReference(model: unknown): void {
  if (model !== undefined && (typeof model !== "string" || !modelReferenceRegex.test(model))) {
    throw new Error("Model must use provider/model format, for example deepseek/deepseek-flash.");
  }
}
