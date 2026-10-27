import type { Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import historicalModels from "./pi-1.3-models.json" with { type: "json" };

// Frozen Pi 1.3 catalog entries keep historical identities and non-vision replay
// testable after catalog removal. They do not add supported production models.
export function getTestModel(provider: string, id: string): Model<any> {
  const model = getBuiltinModels(provider as Parameters<typeof getBuiltinModels>[0]).find(model => model.id === id)
    ?? historicalModels.find(model => model.provider === provider && model.id === id);
  if (!model) throw new Error(`Missing test model: ${provider}/${id}`);
  return structuredClone(model) as Model<any>;
}
