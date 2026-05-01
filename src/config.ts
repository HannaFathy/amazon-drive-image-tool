import process from "node:process";

const DEFAULT_PARENT_FOLDER_ID = "1bH22h21qlMyaROq748jJy0JuC2s3kuBg";

function readInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readCsv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const port = readInt("PORT", 3000);
const publicBaseUrl = trimTrailingSlash(
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
);

export const config = {
  appName: "Amazon Drive Image Tool",
  appVersion: "0.1.0",
  port,
  bindHost: process.env.BIND_HOST ?? "0.0.0.0",
  publicBaseUrl,
  mcpPath: "/mcp",
  allowedHosts: readCsv("ALLOWED_HOSTS", [
    "localhost",
    "127.0.0.1",
    new URL(publicBaseUrl).hostname,
  ]),
  get mcpResourceUrl(): string {
    return `${publicBaseUrl}/mcp`;
  },
  authRequired: readBool("AUTH_REQUIRED", true),
  devBearerToken: process.env.DEV_BEARER_TOKEN,
  oauthIssuerUrl: process.env.OAUTH_ISSUER_URL
    ? trimTrailingSlash(process.env.OAUTH_ISSUER_URL)
    : undefined,
  oauthAudience: process.env.OAUTH_AUDIENCE,
  oauthJwksUrl: process.env.OAUTH_JWKS_URL,
  requiredScopes: readCsv("REQUIRED_SCOPES", [
    "amazon-drive-image-tool:write",
  ]),
  defaultParentFolderId:
    process.env.DEFAULT_PARENT_FOLDER_ID ?? DEFAULT_PARENT_FOLDER_ID,
  googleDriveScope:
    process.env.GOOGLE_DRIVE_SCOPE ?? "https://www.googleapis.com/auth/drive",
  googleServiceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
  googleApplicationCredentialsJson:
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
  maxUrlsPerRun: readInt("MAX_URLS_PER_RUN", 20),
  maxImagesPerProduct: readInt("MAX_IMAGES_PER_PRODUCT", 20),
  maxConcurrentProducts: readInt("MAX_CONCURRENT_PRODUCTS", 5),
  extractorTimeoutMs: readInt("EXTRACTOR_TIMEOUT_MS", 45_000),
  scrapingApiUrl: process.env.SCRAPING_API_URL,
  scrapingApiToken: process.env.SCRAPING_API_TOKEN,
};
