import type { ShotPlan } from "../shared/video.js";

export function selectGeneratedShotIndices(shots: ShotPlan[], maximum: number): Set<number> {
  const candidates = shots.filter((shot) => shot.assetType !== "data_visualization").map((shot) => shot.index);
  if (maximum <= 0 || !candidates.length) return new Set();
  if (candidates.length <= maximum) return new Set(candidates);
  if (maximum === 1) return new Set([candidates[Math.floor(candidates.length / 2)]]);

  const selected = new Set<number>();
  for (let index = 0; index < maximum; index += 1) {
    const position = Math.round((index * (candidates.length - 1)) / (maximum - 1));
    selected.add(candidates[position]);
  }
  return selected;
}
