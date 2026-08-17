import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseScriptImport } from "./script-imports.js";

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  zip.folder("word")?.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("script import", () => {
  it("reads a UTF-8 text script", async () => {
    await expect(parseScriptImport("减药科普.txt", Buffer.from("第一段：患者提出问题。\n第二段：医生解释。", "utf8")))
      .resolves.toContain("医生解释");
  });

  it("extracts text from a Word document", async () => {
    const buffer = await makeDocx("医生解释减药需要逐步评估。");
    await expect(parseScriptImport("减药科普.docx", buffer)).resolves.toContain("逐步评估");
  });

  it("rejects empty script imports", async () => {
    await expect(parseScriptImport("empty.txt", Buffer.from("   "))).rejects.toThrow("没有可用文字");
  });
});
