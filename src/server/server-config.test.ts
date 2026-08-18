import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("server network configuration", () => {
  it("uses validated runtime configuration for listening and proxy trust", () => {
    const source = fs.readFileSync(path.resolve("src/server/index.ts"), "utf8");

    expect(source).toContain("const runtimeConfig = readRuntimeConfig(process.env);");
    expect(source).toContain('app.set("trust proxy", 1)');
    expect(source).toContain("configureRenderConcurrency(runtimeConfig.maxConcurrentRenders)");
    expect(source).toContain("app.listen(runtimeConfig.port, runtimeConfig.host");
  });
});
