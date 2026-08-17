import type { MaterialAsset, VideoPlan } from "../shared/video.js";
import { extractMaterialVariables } from "./material-variables.js";

export type PreflightIssueCode = "unresolved_variable" | "missing_material" | "invalid_data_field" | "invalid_duration" | "provider_url_required";

export interface PreflightIssue {
  code: PreflightIssueCode;
  message: string;
  shotId?: string;
  variableName?: string;
}

export function inspectPlanForRender(plan: VideoPlan, materials: MaterialAsset[], expectedDuration: number): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const materialsById = new Map(materials.map((material) => [material.id, material]));
  const totalDuration = plan.shots.reduce((sum, shot) => sum + shot.duration, 0);

  if (plan.shots.some((shot) => shot.duration < 1) || Math.abs(totalDuration - expectedDuration) > 0.15) {
    issues.push({ code: "invalid_duration", message: `分镜总时长必须为 ${expectedDuration} 秒` });
  }

  for (const shot of plan.shots) {
    const bindings = shot.materialBindings ?? [];
    const byName = new Map(bindings.map((binding) => [binding.variableName, binding]));
    for (const variableName of extractMaterialVariables(shot.visualPrompt)) {
      const binding = byName.get(variableName);
      if (!binding) {
        issues.push({ code: "unresolved_variable", message: `镜头 ${shot.index + 1} 的 @${variableName} 尚未绑定素材`, shotId: shot.id, variableName });
        continue;
      }
      const material = materialsById.get(binding.materialId);
      if (!material) {
        issues.push({ code: "missing_material", message: `@${variableName} 对应的素材不存在`, shotId: shot.id, variableName });
        continue;
      }
      if (binding.mode === "ai_reference" && material.kind !== "data" && !material.publicUrl) {
        issues.push({ code: "provider_url_required", message: `@${variableName} 需要公网素材地址才能交给 Seedance，可改用原样叠加或配置 MATERIAL_PUBLIC_BASE_URL`, shotId: shot.id, variableName });
      }
      if (binding.mode === "data_chart" && binding.chart) {
        const columns = new Set(material.dataAsset?.columns ?? []);
        for (const column of [binding.chart.xColumn, ...binding.chart.yColumns]) {
          if (!columns.has(column)) {
            issues.push({ code: "invalid_data_field", message: `@${variableName} 中不存在字段“${column}”`, shotId: shot.id, variableName });
          }
        }
      }
    }
  }

  return issues;
}
