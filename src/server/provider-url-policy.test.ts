import { describe, expect, it } from "vitest";
import {
  assertPublicPersonalProviderUrl,
  validatePersonalProviderBaseUrl
} from "./provider-url-policy.js";

describe("personal provider URL policy", () => {
  it("allows official HTTPS endpoints and explicit administrator hosts", () => {
    expect(validatePersonalProviderBaseUrl("https://api.openai.com/v1", {})).toBe("https://api.openai.com/v1");
    expect(validatePersonalProviderBaseUrl("https://gateway.example.com/v1", {
      PERSONAL_API_ALLOWED_HOSTS: "gateway.example.com"
    })).toBe("https://gateway.example.com/v1");
  });

  it("rejects HTTP, credentials, local addresses, and unlisted hosts", () => {
    for (const value of [
      "http://api.openai.com/v1",
      "https://key@api.openai.com/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://192.168.1.2/v1",
      "https://unlisted.example/v1"
    ]) expect(() => validatePersonalProviderBaseUrl(value, {})).toThrow("personal API base URL");
  });

  it("rejects an allowlisted hostname when DNS resolves to a private address", async () => {
    await expect(assertPublicPersonalProviderUrl(
      "https://gateway.example.com/v1",
      async () => ["10.0.0.8"]
    )).rejects.toThrow("public network address");
    await expect(assertPublicPersonalProviderUrl(
      "https://gateway.example.com/v1",
      async () => ["203.0.113.10"]
    )).rejects.toThrow("public network address");
    await expect(assertPublicPersonalProviderUrl(
      "https://gateway.example.com/v1",
      async () => ["8.8.8.8"]
    )).resolves.toBeUndefined();
  });
});
