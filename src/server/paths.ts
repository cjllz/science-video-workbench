import path from "node:path";
import { fileURLToPath } from "node:url";

const filePath = fileURLToPath(import.meta.url);
export const projectRoot = path.resolve(path.dirname(filePath), "../..");
export const dataRoot = path.join(projectRoot, "data");
export const outputRoot = path.join(dataRoot, "outputs");
export const materialRoot = path.join(dataRoot, "materials");
export const databasePath = path.join(dataRoot, "studio.sqlite");
