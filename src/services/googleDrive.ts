import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { config } from "../config.js";
import type { DriveFolderSummary, ExistingDriveFile } from "../types.js";
import {
  escapeDriveQueryValue,
  errorMessage,
  sanitizeDriveName,
  sha256,
} from "../utils.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export class GoogleDriveService {
  private drive?: drive_v3.Drive;

  async findProductFolder(
    parentFolderId: string,
    productTitle: string,
  ): Promise<DriveFolderSummary | undefined> {
    const drive = await this.getDrive();
    const folderName = sanitizeDriveName(productTitle);
    const response = await drive.files.list({
      q:
        `mimeType='${FOLDER_MIME_TYPE}' and trashed=false ` +
        `and name='${escapeDriveQueryValue(folderName)}' ` +
        `and '${escapeDriveQueryValue(parentFolderId)}' in parents`,
      fields: "files(id,name,webViewLink)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const folder = response.data.files?.[0];
    if (!folder?.id || !folder.name) {
      return undefined;
    }

    return {
      id: folder.id,
      name: folder.name,
      created: false,
      webViewLink: folder.webViewLink ?? undefined,
    };
  }

  async getOrCreateProductFolder(
    parentFolderId: string,
    productTitle: string,
  ): Promise<DriveFolderSummary> {
    const existing = await this.findProductFolder(parentFolderId, productTitle);
    if (existing) {
      return existing;
    }

    const drive = await this.getDrive();
    const folderName = sanitizeDriveName(productTitle);
    const response = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentFolderId],
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });

    if (!response.data.id || !response.data.name) {
      throw new Error("Drive did not return an ID for the created folder.");
    }

    return {
      id: response.data.id,
      name: response.data.name,
      created: true,
      webViewLink: response.data.webViewLink ?? undefined,
    };
  }

  async listFilesBySourceImageHash(
    folderId: string,
  ): Promise<Map<string, ExistingDriveFile>> {
    const drive = await this.getDrive();
    const filesByHash = new Map<string, ExistingDriveFile>();
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `trashed=false and '${escapeDriveQueryValue(folderId)}' in parents`,
        fields: "nextPageToken,files(id,name,appProperties,webViewLink)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        pageSize: 1000,
        pageToken,
      });

      for (const file of response.data.files ?? []) {
        const hash = file.appProperties?.sourceImageUrlHash;
        if (file.id && file.name && hash) {
          filesByHash.set(hash, {
            id: file.id,
            name: file.name,
            sourceImageUrlHash: hash,
            webViewLink: file.webViewLink ?? undefined,
          });
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return filesByHash;
  }

  async uploadImage(params: {
    folderId: string;
    filename: string;
    sourceImageUrl: string;
    sourceImageUrlHash: string;
    amazonProductUrl: string;
    productTitle: string;
  }): Promise<{ id: string; name: string; webViewLink?: string }> {
    const drive = await this.getDrive();
    const response = await fetch(params.sourceImageUrl, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        referer: params.amazonProductUrl,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Image download failed with ${response.status} ${response.statusText}.`,
      );
    }

    const mimeType =
      response.headers.get("content-type")?.split(";")[0] ??
      inferMimeType(params.filename);
    const description = JSON.stringify(
      {
        sourceImageUrl: params.sourceImageUrl,
        sourceImageUrlHash: params.sourceImageUrlHash,
        amazonProductUrl: params.amazonProductUrl,
        amazonProductUrlHash: sha256(params.amazonProductUrl),
        productTitle: params.productTitle,
        uploadedBy: config.appName,
        uploadedAt: new Date().toISOString(),
      },
      null,
      2,
    );

    const upload = await drive.files.create({
      requestBody: {
        name: params.filename,
        parents: [params.folderId],
        description,
        appProperties: {
          sourceImageUrlHash: params.sourceImageUrlHash,
          amazonProductUrlHash: sha256(params.amazonProductUrl),
          productTitleHash: sha256(params.productTitle),
        },
      },
      media: {
        mimeType,
        body: Readable.fromWeb(response.body),
      },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });

    if (!upload.data.id || !upload.data.name) {
      throw new Error("Drive did not return an ID for the uploaded image.");
    }

    return {
      id: upload.data.id,
      name: upload.data.name,
      webViewLink: upload.data.webViewLink ?? undefined,
    };
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (this.drive) {
      return this.drive;
    }

    try {
      const auth = createGoogleAuth();
      this.drive = google.drive({ version: "v3", auth });
      return this.drive;
    } catch (error) {
      throw new Error(`Unable to initialize Google Drive: ${errorMessage(error)}`);
    }
  }
}

function createGoogleAuth(): GoogleAuth {
  if (config.googleApplicationCredentialsJson) {
    return new GoogleAuth({
      credentials: JSON.parse(config.googleApplicationCredentialsJson),
      scopes: [config.googleDriveScope],
    });
  }

  return new GoogleAuth({
    keyFile: config.googleServiceAccountKeyFile,
    scopes: [config.googleDriveScope],
  });
}

function inferMimeType(filename: string): string {
  if (/\.png$/i.test(filename)) {
    return "image/png";
  }
  if (/\.webp$/i.test(filename)) {
    return "image/webp";
  }
  if (/\.gif$/i.test(filename)) {
    return "image/gif";
  }

  return "image/jpeg";
}
