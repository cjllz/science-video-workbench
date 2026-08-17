import type { MaterialAsset, ShotMaterialBinding } from "../shared/video.js";

const variablePattern = /@([\p{L}\p{N}_-]{1,40})/gu;

export interface ResolvedMaterialBinding {
  binding: ShotMaterialBinding;
  material: MaterialAsset;
  providerToken?: string;
}

export interface MaterialResolution {
  prompt: string;
  providerReferences: ResolvedMaterialBinding[];
  localBindings: ResolvedMaterialBinding[];
  unresolved: string[];
}

export function extractMaterialVariables(text: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(variablePattern)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      variables.push(name);
    }
  }
  return variables;
}

function replaceVariable(text: string, name: string, replacement: string): string {
  return text.replaceAll(`@${name}`, replacement);
}

export function resolveMaterialVariables(text: string, bindings: ShotMaterialBinding[], materials: MaterialAsset[]): MaterialResolution {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const bindingByName = new Map(bindings.map((binding) => [binding.variableName, binding]));
  const counts = { image: 0, video: 0, audio: 0 };
  const providerReferences: ResolvedMaterialBinding[] = [];
  const localBindings: ResolvedMaterialBinding[] = [];
  const unresolved: string[] = [];
  let prompt = text;

  for (const variableName of extractMaterialVariables(text)) {
    const binding = bindingByName.get(variableName);
    const material = binding ? materialById.get(binding.materialId) : undefined;
    if (!binding || !material) {
      unresolved.push(variableName);
      continue;
    }

    if (binding.mode === "ai_reference" && material.kind !== "data") {
      counts[material.kind] += 1;
      const label = material.kind === "image" ? "图片" : material.kind === "video" ? "视频" : "音频";
      const providerToken = `@${label}${counts[material.kind]}`;
      const resolved = { binding, material, providerToken };
      providerReferences.push(resolved);
      prompt = replaceVariable(prompt, variableName, providerToken);
      continue;
    }

    localBindings.push({ binding, material });
    const replacement = binding.mode === "data_chart"
      ? "后期叠加的精确数据图表"
      : "后期叠加的原始素材区域";
    prompt = replaceVariable(prompt, variableName, replacement);
  }

  return { prompt, providerReferences, localBindings, unresolved };
}
