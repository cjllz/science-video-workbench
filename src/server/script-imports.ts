import path from "node:path";
import mammoth from "mammoth";

const maximumCharacters = 30_000;

function validate(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("剧本文件没有可用文字");
  if (normalized.length > maximumCharacters) throw new Error(`剧本最多支持 ${maximumCharacters} 个字符`);
  return normalized;
}

export async function parseScriptImport(filename: string, buffer: Buffer): Promise<string> {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".txt" || extension === ".md") {
    return validate(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  }
  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return validate(result.value);
  }
  throw new Error("只支持 TXT、Markdown 或 DOCX 剧本文件");
}
