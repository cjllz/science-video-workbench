import type { MaterialAsset, ShotMaterialBinding } from "../shared/video";

export type MaterialPurpose = "integrate" | "exact" | "data";

export function getMaterialPurpose(binding: ShotMaterialBinding): MaterialPurpose {
  if (binding.mode === "data_chart") return "data";
  if (binding.mode === "ai_reference") return "integrate";
  return "exact";
}

export function getMaterialPurposeOptions(material: MaterialAsset): Array<[MaterialPurpose, string]> {
  if (material.kind === "data") return [["data", "展示数据"]];
  if (material.kind === "audio") return [["integrate", "作为声音"]];
  return [["integrate", "融入画面"], ["exact", "原样展示"]];
}

function defaultRole(material: MaterialAsset): ShotMaterialBinding["role"] {
  if (material.kind === "data") return "data";
  if (material.kind === "audio") return "music";
  if (material.kind === "video") return "motion";
  return "replacement";
}

export function createDefaultBinding(material: MaterialAsset, duration?: number): ShotMaterialBinding {
  const data = material.dataAsset;
  const xColumn = data?.columns.find((column) => !data.numericColumns.includes(column)) ?? data?.columns[0] ?? "";
  return {
    materialId: material.id,
    variableName: material.variableName,
    role: defaultRole(material),
    mode: material.kind === "data" ? "data_chart" : material.kind === "audio" ? "ai_reference" : "exact_overlay",
    placement: material.kind === "data" ? "top-right" : "full",
    ...(duration === undefined ? {} : { startOffset: 0, endOffset: duration }),
    ...(data ? { chart: { type: "line" as const, xColumn, yColumns: data.numericColumns.slice(0, 2) } } : {})
  };
}

export function applyMaterialPurpose(
  binding: ShotMaterialBinding,
  material: MaterialAsset,
  purpose: MaterialPurpose
): ShotMaterialBinding {
  const defaults = createDefaultBinding(material);
  return {
    ...binding,
    role: purpose === "data" ? "data" : defaultRole(material),
    mode: purpose === "data" ? "data_chart" : purpose === "integrate" ? "ai_reference" : "exact_overlay",
    chart: purpose === "data" ? binding.chart ?? defaults.chart : binding.chart
  };
}

export function replaceBindingMaterial(binding: ShotMaterialBinding, material: MaterialAsset): ShotMaterialBinding {
  return {
    ...createDefaultBinding(material),
    placement: binding.placement,
    startOffset: binding.startOffset,
    endOffset: binding.endOffset
  };
}
