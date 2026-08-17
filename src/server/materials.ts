import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { MaterialAsset, MaterialKind } from "../shared/video.js";
import { parseDataAsset } from "./data-assets.js";
import { createMaterialAsset } from "./db.js";
import { materialRoot } from "./paths.js";

const extensions: Record<MaterialKind, Set<string>> = {
  image: new Set([".png", ".jpg", ".jpeg", ".webp"]),
  video: new Set([".mp4", ".mov", ".webm"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac"]),
  data: new Set([".csv", ".xlsx"])
};

export function classifyMaterial(filename: string): MaterialKind {
  const extension = path.extname(filename.trim()).toLowerCase();
  for (const [kind, supported] of Object.entries(extensions) as Array<[MaterialKind, Set<string>]>) {
    if (supported.has(extension)) return kind;
  }
  throw new Error("不支持该素材格式，请上传图片、视频、音频、CSV 或 XLSX 文件");
}

export function createVariableName(filename: string): string {
  const extension = path.extname(filename.trim());
  const base = path.basename(filename.trim(), extension).normalize("NFKC");
  let variable = base
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  if (!variable) variable = "素材";
  if (/^\p{N}/u.test(variable)) variable = `素材_${variable}`.slice(0, 30);
  return variable;
}

export async function storeMaterialUpload(filename: string, mimeType: string, buffer: Buffer): Promise<MaterialAsset> {
  const kind = classifyMaterial(filename);
  const id = nanoid(12);
  const extension = path.extname(filename.trim()).toLowerCase();
  const directory = path.join(materialRoot, id);
  const storedName = `source${extension}`;
  const storagePath = path.join(directory, storedName);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(storagePath, buffer);

  const relativeUrl = `/materials/${id}/${storedName}`;
  const publicBase = process.env.MATERIAL_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const asset: MaterialAsset = {
    id,
    variableName: createVariableName(filename),
    name: filename.trim().slice(0, 120),
    kind,
    mimeType: mimeType || "application/octet-stream",
    size: buffer.length,
    url: relativeUrl,
    publicUrl: publicBase ? `${publicBase}${relativeUrl}` : undefined,
    dataAsset: kind === "data" ? await parseDataAsset(filename, extension, buffer) : undefined,
    createdAt: new Date().toISOString()
  };
  createMaterialAsset(asset, storagePath);
  return asset;
}
