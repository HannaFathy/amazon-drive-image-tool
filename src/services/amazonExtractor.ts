import { chromium, type Browser, type Page } from "playwright";
import { config } from "../config.js";
import type { AmazonExtraction, ExtractorMode } from "../types.js";
import {
  errorMessage,
  normalizeWhitespace,
  validateAmazonAeProductUrl,
} from "../utils.js";

export class AmazonExtractor {
  private browser?: Browser;

  async extract(
    inputUrl: string,
    mode: ExtractorMode = "auto",
  ): Promise<AmazonExtraction> {
    validateAmazonAeProductUrl(inputUrl);

    if (mode === "scraping_api") {
      return this.extractWithScrapingApi(inputUrl);
    }

    try {
      return await this.extractWithBrowser(inputUrl);
    } catch (error) {
      if (mode === "auto" && config.scrapingApiUrl) {
        return this.extractWithScrapingApi(inputUrl);
      }

      throw new Error(`Browser extraction failed: ${errorMessage(error)}`);
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }

  private async extractWithBrowser(inputUrl: string): Promise<AmazonExtraction> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      locale: "en-AE",
      timezoneId: "Asia/Dubai",
      viewport: { width: 1440, height: 1200 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    try {
      await page.goto(inputUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.extractorTimeoutMs,
      });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(
        () => undefined,
      );
      await dismissCookiePrompt(page);

      const imageUrls = new Set<string>();
      for (const url of await collectGalleryImageUrls(page)) {
        imageUrls.add(url);
      }

      await clickGalleryThumbnails(page, async () => {
        for (const url of await collectGalleryImageUrls(page)) {
          imageUrls.add(url);
        }
      });

      const productTitle = await extractTitle(page);
      const galleryImageUrls = selectBestAmazonImageUrls([...imageUrls]).slice(
        0,
        config.maxImagesPerProduct,
      );

      if (!productTitle) {
        throw new Error("Product title was not found.");
      }

      if (galleryImageUrls.length === 0) {
        throw new Error("No gallery image URLs were found.");
      }

      return {
        inputUrl,
        productTitle,
        galleryImageUrls,
        extractorMode: "browser",
      };
    } finally {
      await context.close();
    }
  }

  private async extractWithScrapingApi(
    inputUrl: string,
  ): Promise<AmazonExtraction> {
    if (!config.scrapingApiUrl) {
      throw new Error("SCRAPING_API_URL is not configured.");
    }

    const response = await fetch(config.scrapingApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.scrapingApiToken
          ? { authorization: `Bearer ${config.scrapingApiToken}` }
          : {}),
      },
      body: JSON.stringify({ url: inputUrl, marketplace: "amazon.ae" }),
    });

    if (!response.ok) {
      throw new Error(
        `Scraping API failed with ${response.status} ${response.statusText}.`,
      );
    }

    const payload = (await response.json()) as {
      title?: string;
      productTitle?: string;
      images?: string[];
      galleryImageUrls?: string[];
    };
    const productTitle = normalizeWhitespace(
      payload.productTitle ?? payload.title ?? "",
    );
    const galleryImageUrls = selectBestAmazonImageUrls([
      ...(payload.galleryImageUrls ?? []),
      ...(payload.images ?? []),
    ]).slice(0, config.maxImagesPerProduct);

    if (!productTitle) {
      throw new Error("Scraping API did not return a product title.");
    }
    if (galleryImageUrls.length === 0) {
      throw new Error("Scraping API did not return gallery images.");
    }

    return {
      inputUrl,
      productTitle,
      galleryImageUrls,
      extractorMode: "scraping_api",
    };
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }

    return this.browser;
  }
}

async function extractTitle(page: Page): Promise<string> {
  const titleSelectors = [
    "#productTitle",
    "#title #productTitle",
    "[data-automation-id='product-title']",
  ];

  for (const selector of titleSelectors) {
    const text = await page
      .locator(selector)
      .first()
      .textContent({ timeout: 1_500 })
      .catch(() => undefined);
    if (text && normalizeWhitespace(text)) {
      return normalizeWhitespace(text);
    }
  }

  const metaTitle = await page
    .locator("meta[property='og:title']")
    .first()
    .getAttribute("content")
    .catch(() => undefined);
  if (metaTitle) {
    return normalizeWhitespace(metaTitle.replace(/^Amazon\.ae:\s*/i, ""));
  }

  return normalizeWhitespace(
    (await page.title()).replace(/^Amazon\.ae:\s*/i, ""),
  );
}

async function dismissCookiePrompt(page: Page): Promise<void> {
  const buttons = [
    "#sp-cc-accept",
    "input#sp-cc-accept",
    "button:has-text('Accept')",
    "input:has-text('Accept')",
  ];

  for (const selector of buttons) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click({ timeout: 1_000 }).catch(() => undefined);
      return;
    }
  }
}

async function clickGalleryThumbnails(
  page: Page,
  collect: () => Promise<void>,
): Promise<void> {
  const thumbnails = page.locator(
    "#altImages li.imageThumbnail, #altImages li.item, #altImages img",
  );
  const count = Math.min(
    await thumbnails.count().catch(() => 0),
    config.maxImagesPerProduct,
  );

  for (let index = 0; index < count; index += 1) {
    await thumbnails
      .nth(index)
      .click({ timeout: 1_000, force: true })
      .catch(() => undefined);
    await page.waitForTimeout(250);
    await collect();
  }
}

async function collectGalleryImageUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls = new Set<string>();

    const add = (value: unknown): void => {
      if (typeof value !== "string" || !value.trim()) {
        return;
      }

      let cleaned = value
        .trim()
        .replaceAll("\\/", "/")
        .replaceAll("\\u002F", "/")
        .replaceAll("&amp;", "&");

      if (cleaned.startsWith("//")) {
        cleaned = `https:${cleaned}`;
      }

      if (/^https?:\/\/[^"'\s]+\/images\/I\/[^"'\s]+$/i.test(cleaned)) {
        urls.add(cleaned);
      }
    };

    const addSrcset = (value: string | null): void => {
      if (!value) {
        return;
      }
      for (const part of value.split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    };

    const addDynamicImageJson = (value: string | null): void => {
      if (!value) {
        return;
      }
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        for (const url of Object.keys(parsed)) {
          add(url);
        }
      } catch {
        // Ignore malformed page attributes.
      }
    };

    const containers = [
      "#imageBlock_feature_div",
      "#imageBlock",
      "#main-image-container",
      "#altImages",
      "#dp-container",
    ];

    for (const containerSelector of containers) {
      const container = document.querySelector(containerSelector);
      if (!container) {
        continue;
      }

      for (const image of Array.from(container.querySelectorAll("img"))) {
        add(image.getAttribute("data-old-hires"));
        add(image.getAttribute("data-a-hires"));
        add(image.getAttribute("data-src"));
        add(image.getAttribute("src"));
        addSrcset(image.getAttribute("srcset"));
        addDynamicImageJson(image.getAttribute("data-a-dynamic-image"));
      }
    }

    for (const script of Array.from(document.scripts)) {
      const text = script.textContent ?? "";
      if (
        !text.includes("colorImages") &&
        !text.includes("ImageBlock") &&
        !text.includes("hiRes")
      ) {
        continue;
      }

      const propertyRegex =
        /"(?:hiRes|large|mainUrl|variant|thumb)"\s*:\s*"([^"]+)"/g;
      for (const match of text.matchAll(propertyRegex)) {
        add(match[1]);
      }

      const urlRegex =
        /https?:\\?\/\\?\/(?:m\.)?media-amazon\.[^"'\\\s]+\/images\/I\/[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)/gi;
      for (const match of text.matchAll(urlRegex)) {
        add(match[0]);
      }
    }

    return [...urls];
  });
}

function selectBestAmazonImageUrls(values: string[]): string[] {
  const byImageId = new Map<
    string,
    { url: string; score: number; firstSeen: number }
  >();

  for (const [index, rawValue] of values.entries()) {
    const normalized = normalizeAmazonImageUrl(rawValue);
    if (!normalized) {
      continue;
    }

    const key = amazonImageGroupKey(normalized);
    const score = amazonImageScore(normalized);
    const current = byImageId.get(key);
    if (!current || score > current.score) {
      byImageId.set(key, { url: normalized, score, firstSeen: index });
    }
  }

  return [...byImageId.values()]
    .sort((left, right) => left.firstSeen - right.firstSeen)
    .map((item) => item.url);
}

function normalizeAmazonImageUrl(rawValue: string): string | undefined {
  const cleaned = rawValue
    .trim()
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .replaceAll("&amp;", "&");

  try {
    const url = new URL(cleaned);
    const hostname = url.hostname.toLowerCase();
    const isAmazonImageHost =
      hostname.includes("media-amazon.") ||
      hostname.includes("ssl-images-amazon.");
    if (!isAmazonImageHost || !url.pathname.includes("/images/I/")) {
      return undefined;
    }

    url.protocol = "https:";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function amazonImageGroupKey(value: string): string {
  const url = new URL(value);
  const match = url.pathname.match(
    /\/images\/I\/([^/.]+)(?:\.[^/]*)?\.(jpe?g|png|webp)$/i,
  );
  return match ? `${match[1]}.${match[2].toLowerCase()}` : url.pathname;
}

function amazonImageScore(value: string): number {
  const path = new URL(value).pathname;
  const sizeMatches = [...path.matchAll(/_(?:SL|UL|UX|SX|SY|UY|US|SS|SR)(\d+)_/g)];
  const largestSize = Math.max(
    0,
    ...sizeMatches.map((match) => Number.parseInt(match[1], 10)),
  );

  let score = largestSize;
  if (!/\._/.test(path)) {
    score += 2_000;
  }
  if (/_AC_US\d+_|_SS\d+_|_SR\d+_|_SX3\d+_|_SY3\d+_/i.test(path)) {
    score -= 1_000;
  }
  if (/\.jpe?g$/i.test(path)) {
    score += 10;
  }

  return score;
}
