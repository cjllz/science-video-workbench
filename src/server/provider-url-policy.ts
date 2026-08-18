import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const defaultAllowedHosts = ["api.openai.com", "api.deepseek.com"];

function policyError(detail: string): Error {
  return new Error(`Invalid personal API base URL: ${detail}`);
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/\.$/, "");
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && octets[2] === 100)
    || (first === 203 && second === 0 && octets[2] === 113)
    || first >= 224;
}

export function isPublicNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) return !isPrivateIpv4(address);
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPublicNetworkAddress(normalized.slice(7));
  return normalized !== "::"
    && normalized !== "::1"
    && !normalized.startsWith("fc")
    && !normalized.startsWith("fd")
    && !/^fe[89ab]/.test(normalized)
    && !normalized.startsWith("ff")
    && !normalized.startsWith("2001:db8:");
}

export function personalApiAllowedHosts(environment: NodeJS.ProcessEnv): Set<string> {
  const configured = (environment.PERSONAL_API_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => normalizedHost(host.trim()))
    .filter(Boolean);
  for (const host of configured) {
    if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".") || isIP(host)) {
      throw policyError("PERSONAL_API_ALLOWED_HOSTS must contain comma-separated DNS hostnames");
    }
  }
  return new Set([...defaultAllowedHosts, ...configured]);
}

export function validatePersonalProviderBaseUrl(value: string, environment: NodeJS.ProcessEnv): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw policyError("must be a valid URL");
  }
  const hostname = normalizedHost(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw policyError("must use HTTPS without credentials or a custom port");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isIP(hostname)) {
    throw policyError("must use an approved public DNS hostname");
  }
  if (!personalApiAllowedHosts(environment).has(hostname)) {
    throw policyError("hostname is not in PERSONAL_API_ALLOWED_HOSTS");
  }
  url.hostname = hostname;
  return url.toString().replace(/\/$/, "");
}

export async function assertPublicPersonalProviderUrl(
  value: string,
  resolveAddresses: (hostname: string) => Promise<string[]> = async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address)
): Promise<void> {
  const hostname = new URL(value).hostname;
  const addresses = await resolveAddresses(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicNetworkAddress(address))) {
    throw policyError("hostname must resolve only to public network addresses");
  }
}
