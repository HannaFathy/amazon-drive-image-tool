import { config } from "../config.js";
import type {
  AmazonExtraction,
  BatchProcessResult,
  ExtractorMode,
  ExistingDriveFile,
  ProcessAmazonProductUrlsInput,
  ProductErrorSummary,
  ProductProcessSummary,
} from "../types.js";
import {
  createBatchId,
  ensureUniqueFilename,
  errorMessage,
  filenameFromImageUrl,
  sanitizeDriveName,
  sha256,
  validateAmazonAeProductUrl,
} from "../utils.js";
import { AmazonExtractor } from "./amazonExtractor.js";
import { GoogleDriveService } from "./googleDrive.js";

export async function processAmazonProductUrls(
  input: ProcessAmazonProductUrlsInput,
): Promise<BatchProcessResult> {
  const urls = [...new Set(input.urls.map((url) => url.trim()))].filter(Boolean);
  if (urls.length === 0) {
    throw new Error("At least one Amazon product URL is required.");
  }
  if (urls.length > config.maxUrlsPerRun) {
    throw new Error(
      `A maximum of ${config.maxUrlsPerRun} URLs are allowed per run.`,
    );
  }

  const parentFolderId = input.parent_folder_id ?? config.defaultParentFolderId;
  const dryRun = input.dry_run ?? false;
  const extractorMode = input.extractor_mode ?? "auto";
  const extractor = new AmazonExtractor();
  const drive = new GoogleDriveService();

  try {
    const products = await mapWithConcurrency(
      urls,
      config.maxConcurrentProducts,
      (url) =>
        processOneProduct({
          url,
          parentFolderId,
          dryRun,
          extractorMode,
          extractor,
          drive,
        }),
    );

    return {
      batch_id: createBatchId(),
      parent_folder_id: parentFolderId,
      dry_run: dryRun,
      products,
      summary: {
        products_processed: products.length,
        folders_created: products.filter(
          (product) => product.drive_folder_status === "created",
        ).length,
        files_uploaded: products.reduce(
          (total, product) => total + product.uploaded.length,
          0,
        ),
        would_upload: products.reduce(
          (total, product) => total + product.would_upload.length,
          0,
        ),
        duplicates_skipped: products.reduce(
          (total, product) => total + product.skipped_duplicates.length,
          0,
        ),
        failed_products: products.filter((product) =>
          product.errors.some((error) => error.stage !== "upload"),
        ).length,
      },
    };
  } finally {
    await extractor.close();
  }
}

async function processOneProduct(params: {
  url: string;
  parentFolderId: string;
  dryRun: boolean;
  extractorMode: ExtractorMode;
  extractor: AmazonExtractor;
  drive: GoogleDriveService;
}): Promise<ProductProcessSummary> {
  const product: ProductProcessSummary = {
    input_url: params.url,
    gallery_images_found: 0,
    uploaded: [],
    would_upload: [],
    skipped_duplicates: [],
    errors: [],
  };

  try {
    validateAmazonAeProductUrl(params.url);
  } catch (error) {
    product.errors.push(errorSummary("validation", error));
    return product;
  }

  let extraction: AmazonExtraction;
  try {
    extraction = await params.extractor.extract(params.url, params.extractorMode);
    product.product_title = extraction.productTitle;
    product.gallery_images_found = extraction.galleryImageUrls.length;
  } catch (error) {
    product.errors.push(errorSummary("extraction", error));
    return product;
  }

  let folderId: string | undefined;
  try {
    if (params.dryRun) {
      const existingFolder = await params.drive.findProductFolder(
        params.parentFolderId,
        extraction.productTitle,
      );
      folderId = existingFolder?.id;
      product.drive_folder_id = existingFolder?.id;
      product.drive_folder_name =
        existingFolder?.name ?? sanitizeDriveName(extraction.productTitle);
      product.drive_folder_status = existingFolder ? "existing" : "would_create";
    } else {
      const folder = await params.drive.getOrCreateProductFolder(
        params.parentFolderId,
        extraction.productTitle,
      );
      folderId = folder.id;
      product.drive_folder_id = folder.id;
      product.drive_folder_name = folder.name;
      product.drive_folder_status = folder.created ? "created" : "existing";
    }
  } catch (error) {
    product.drive_folder_status = "unknown";
    product.errors.push(errorSummary("folder", error));
    return product;
  }

  const existingFiles: Map<string, ExistingDriveFile> = folderId
    ? await params.drive.listFilesBySourceImageHash(folderId).catch((error) => {
        product.errors.push(errorSummary("drive", error));
        return new Map();
      })
    : new Map();
  const seenThisRun = new Set<string>();
  const usedFilenames = new Set<string>();

  for (const [index, sourceImageUrl] of extraction.galleryImageUrls.entries()) {
    const sourceImageUrlHash = sha256(sourceImageUrl);
    const filename = ensureUniqueFilename(
      filenameFromImageUrl(sourceImageUrl, index),
      usedFilenames,
    );

    const existing = existingFiles.get(sourceImageUrlHash);
    if (existing) {
      product.skipped_duplicates.push({
        filename,
        source_image_url: sourceImageUrl,
        source_image_url_hash: sourceImageUrlHash,
        reason: "source_image_url_already_uploaded",
        existing_drive_file_id: existing.id,
      });
      continue;
    }

    if (seenThisRun.has(sourceImageUrlHash)) {
      product.skipped_duplicates.push({
        filename,
        source_image_url: sourceImageUrl,
        source_image_url_hash: sourceImageUrlHash,
        reason: "source_image_url_repeated_in_extraction",
      });
      continue;
    }
    seenThisRun.add(sourceImageUrlHash);

    if (params.dryRun) {
      product.would_upload.push({
        filename,
        source_image_url: sourceImageUrl,
        source_image_url_hash: sourceImageUrlHash,
      });
      continue;
    }

    if (!folderId) {
      product.errors.push({
        stage: "folder",
        message: "No Drive folder ID is available for upload.",
        source_image_url: sourceImageUrl,
      });
      continue;
    }

    try {
      const uploaded = await params.drive.uploadImage({
        folderId,
        filename,
        sourceImageUrl,
        sourceImageUrlHash,
        amazonProductUrl: params.url,
        productTitle: extraction.productTitle,
      });
      product.uploaded.push({
        filename: uploaded.name,
        source_image_url: sourceImageUrl,
        source_image_url_hash: sourceImageUrlHash,
        drive_file_id: uploaded.id,
        drive_web_view_link: uploaded.webViewLink,
      });
      existingFiles.set(sourceImageUrlHash, {
        id: uploaded.id,
        name: uploaded.name,
        sourceImageUrlHash,
        webViewLink: uploaded.webViewLink,
      });
    } catch (error) {
      product.errors.push({
        stage: "upload",
        message: errorMessage(error),
        source_image_url: sourceImageUrl,
      });
    }
  }

  return product;
}

function errorSummary(
  stage: ProductErrorSummary["stage"],
  error: unknown,
): ProductErrorSummary {
  return {
    stage,
    message: errorMessage(error),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
