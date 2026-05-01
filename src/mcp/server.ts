import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { config } from "../config.js";
import { processAmazonProductUrls } from "../services/batchProcessor.js";
import type { BatchProcessResult } from "../types.js";

const inputSchema = {
  urls: z
    .array(z.string().url())
    .min(1)
    .max(config.maxUrlsPerRun)
    .describe("Amazon UAE product URLs to process."),
  parent_folder_id: z
    .string()
    .min(1)
    .optional()
    .describe("Google Drive parent folder ID. Defaults to the configured folder."),
  dry_run: z
    .boolean()
    .optional()
    .describe("When true, extract and compare without creating folders or files."),
  extractor_mode: z
    .enum(["browser", "scraping_api", "auto"])
    .optional()
    .describe("Extraction strategy. Defaults to auto."),
};

export function createAmazonDriveMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "amazon-drive-image-tool",
      version: config.appVersion,
    },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    "preview_batch_upload",
    {
      title: "Preview Amazon gallery upload",
      description:
        "Extract Amazon UAE product titles and gallery image URLs, then report which images would upload to Google Drive.",
      inputSchema: {
        urls: inputSchema.urls,
        parent_folder_id: inputSchema.parent_folder_id,
        extractor_mode: inputSchema.extractor_mode,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await processAmazonProductUrls({
        ...input,
        dry_run: true,
      });
      return jsonToolResult(result);
    },
  );

  server.registerTool(
    "process_amazon_product_urls",
    {
      title: "Process Amazon product URLs",
      description:
        "Create or reuse Google Drive product folders and upload only new Amazon UAE gallery images.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await processAmazonProductUrls(input);
      return jsonToolResult(result);
    },
  );

  return server;
}

function jsonToolResult(result: BatchProcessResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}
