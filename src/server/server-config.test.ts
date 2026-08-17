import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("server network configuration", () => {
  it("listens on all interfaces by default and supports a HOST override", () => {
    const source = fs.readFileSync(path.resolve("src/server/index.ts"), "utf8");

    expect(source).toContain('const host = process.env.HOST || "0.0.0.0";');
    expect(source).toContain("app.listen(port, host");
  });
});
