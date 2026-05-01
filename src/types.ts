export type ExtractorMode = "browser" | "scraping_api" | "auto";

export interface ProcessAmazonProductUrlsInput {
  urls: string[];
  parent_folder_id?: string;
  dry_run?: boolean;
  extractor_mode?: ExtractorMode;
}

export interface AmazonExtraction {
  inputUrl: string;
  productTitle: string;
  galleryImageUrls: string[];
  extractorMode: ExtractorMode;
}

export interface DriveFolderSummary {
  id: string;
  name: string;
  created: boolean;
  webViewLink?: string;
}

export interface ExistingDriveFile {
  id: string;
  name: string;
  sourceImageUrlHash?: string;
  webViewLink?: string;
}

export interface UploadedImageSummary {
  filename: string;
  source_image_url: string;
  source_image_url_hash: string;
  drive_file_id: string;
  drive_web_view_link?: string;
}

export interface WouldUploadImageSummary {
  filename: string;
  source_image_url: string;
  source_image_url_hash: string;
}

export interface SkippedDuplicateSummary {
  filename: string;
  source_image_url: string;
  source_image_url_hash: string;
  reason:
    | "source_image_url_already_uploaded"
    | "source_image_url_repeated_in_extraction";
  existing_drive_file_id?: string;
}

export interface ProductErrorSummary {
  stage: "validation" | "extraction" | "folder" | "upload" | "drive";
  message: string;
  source_image_url?: string;
}

export interface ProductProcessSummary {
  input_url: string;
  product_title?: string;
  drive_folder_id?: string;
  drive_folder_name?: string;
  drive_folder_status?: "created" | "existing" | "would_create" | "unknown";
  gallery_images_found: number;
  uploaded: UploadedImageSummary[];
  would_upload: WouldUploadImageSummary[];
  skipped_duplicates: SkippedDuplicateSummary[];
  errors: ProductErrorSummary[];
}

export interface BatchSummary {
  products_processed: number;
  folders_created: number;
  files_uploaded: number;
  would_upload: number;
  duplicates_skipped: number;
  failed_products: number;
}

export interface BatchProcessResult {
  batch_id: string;
  parent_folder_id: string;
  dry_run: boolean;
  products: ProductProcessSummary[];
  summary: BatchSummary;
}
