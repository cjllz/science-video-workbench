import fs from "node:fs/promises";
import path from "node:path";

export interface ProviderAssetRecord {
  shotId: string;
  index: number;
  filename: string;
  provider: string;
  sourceUrl?: string;
  sourceExpiresAt?: string;
  createdAt: string;
}

export interface ProviderAssetManifest {
  shots: Record<string, ProviderAssetRecord>;
}

export const providerAssetManifestName = "provider-assets.json";

export async function loadProviderAssetManifest(directory: string): Promise<ProviderAssetManifest> {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, providerAssetManifestName), "utf8")) as ProviderAssetManifest;
  } catch {
    return { shots: {} };
  }
}

export async function saveProviderAssetRecord(directory: string, record: ProviderAssetRecord): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const manifest = await loadProviderAssetManifest(directory);
  manifest.shots[record.shotId] = record;
  const destination = path.join(directory, providerAssetManifestName);
  const temporary = `${destination}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(manifest, null, 2));
  await fs.rename(temporary, destination);
}

export function selectReferenceVideoUrl(
  record: ProviderAssetRecord | undefined,
  jobId: string,
  publicBase = process.env.OUTPUT_PUBLIC_BASE_URL,
  now = new Date()
): string | undefined {
  if (!record) return undefined;
  const sourceIsLive = record.sourceUrl && (!record.sourceExpiresAt || new Date(record.sourceExpiresAt).getTime() > now.getTime());
  if (sourceIsLive) return record.sourceUrl;
  const base = publicBase?.replace(/\/$/, "");
  if (!base?.startsWith("https://")) return undefined;
  return `${base}/outputs/${jobId}/${record.filename}`;
}
