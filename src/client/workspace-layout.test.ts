import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(path.resolve("src/client/styles.css"), "utf8");

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`).exec(stylesheet);
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("desktop workspace scrolling contract", () => {
  it("constrains the authenticated shell and workspace to the viewport", () => {
    expect(rule(".app-shell:not(.login-shell)")).toMatch(/height:\s*100dvh/);
    expect(rule(".app-shell:not(.login-shell)")).toMatch(/overflow:\s*hidden/);
    expect(rule(".workspace")).toMatch(/min-height:\s*0/);
    expect(rule(".workspace")).toMatch(/overflow:\s*hidden/);
  });

  it("gives every desktop panel an independent contained scroll area", () => {
    const panels = rule(".brief-panel, .preview-panel, .history-panel");
    expect(panels).toMatch(/overflow-y:\s*auto/);
    expect(panels).toMatch(/overscroll-behavior-y:\s*contain/);
    expect(panels).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("restores document flow at the existing tablet breakpoint", () => {
    const tabletBlock = stylesheet.match(/@media \(max-width:\s*1180px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(tabletBlock).toMatch(/\.app-shell:not\(\.login-shell\)[^{]*\{[^}]*height:\s*auto/);
    expect(tabletBlock).toMatch(/\.workspace\s*\{[^}]*overflow:\s*visible/);
    expect(tabletBlock).toMatch(/\.brief-panel, \.preview-panel, \.history-panel\s*\{[^}]*overflow-y:\s*visible/);
  });
});
