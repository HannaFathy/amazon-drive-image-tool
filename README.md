# Amazon Drive Image Tool

OAuth-protected MCP server that accepts Amazon UAE product URLs, extracts product gallery images, creates or reuses Google Drive product folders, uploads only new images, and returns a structured batch summary.

## Tools

- `preview_batch_upload`: extracts product titles/gallery images and reports what would upload. It does not create folders or files.
- `process_amazon_product_urls`: creates or reuses Drive folders and uploads only images whose source URL hash has not already been uploaded.

Default parent folder:

```text
1bH22h21qlMyaROq748jJy0JuC2s3kuBg
```

## Local Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

For local MCP calls, set `DEV_BEARER_TOKEN` in `.env` and send:

```text
Authorization: Bearer <DEV_BEARER_TOKEN>
```

`GET /healthz` verifies that the service is running. The MCP endpoint is `POST /mcp`.

## Google Drive Setup

Version 1 uses a Google service account. Share the target parent Drive folder with the service account email as editor, then configure one of:

- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/secrets/service-account.json`
- `GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}`

Uploaded files store duplicate-check metadata in Drive `appProperties`:

```json
{
  "sourceImageUrlHash": "sha256-hash",
  "amazonProductUrlHash": "sha256-hash",
  "productTitleHash": "sha256-hash"
}
```

The full `sourceImageUrl`, Amazon product URL, and product title are stored in the Drive file description as JSON. This keeps `appProperties` short enough for Drive's custom property limits while still preserving the full source metadata.

## OAuth Setup

Production should use an OAuth/OIDC provider such as Auth0, Clerk, Supabase Auth, or Google Identity. Configure:

```text
AUTH_REQUIRED=true
PUBLIC_BASE_URL=https://your-host.example.com
ALLOWED_HOSTS=your-host.example.com
OAUTH_ISSUER_URL=https://your-issuer.example.com
OAUTH_AUDIENCE=https://your-host.example.com/mcp
REQUIRED_SCOPES=amazon-drive-image-tool:write
```

The server exposes OAuth protected resource metadata at:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
```

It validates bearer JWTs against the issuer JWKS and requires the configured scope. `DEV_BEARER_TOKEN` is only a local-development fallback.

## Example Tool Input

```json
{
  "urls": [
    "https://www.amazon.ae/example-product/dp/B0XXXXXXXX"
  ],
  "parent_folder_id": "1bH22h21qlMyaROq748jJy0JuC2s3kuBg",
  "dry_run": false,
  "extractor_mode": "auto"
}
```

## Deployment Notes

The included Dockerfile builds a Node 22 container and installs Playwright Chromium. It is suitable for Cloud Run or Render.

### Fastest Render Deploy

1. Push this folder to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Render will read `render.yaml` and create a web service.
4. Set `PUBLIC_BASE_URL` to the Render service URL, for example `https://amazon-drive-image-tool.onrender.com`.
5. Set `ALLOWED_HOSTS` to the Render hostname, for example `amazon-drive-image-tool.onrender.com`.
6. Set OAuth and Google Drive secret values.
7. Deploy the service.

The MCP Server URL for Agent Studio will be:

```text
https://YOUR_RENDER_SERVICE.onrender.com/mcp
```

For Cloud Run, set secrets/environment variables for OAuth and Google credentials, then expose the deployed endpoint:

```text
https://YOUR_HOSTED_DOMAIN/mcp
```

Use that `/mcp` URL in the ChatGPT app/modal. Do not use the Google Drive folder URL as the MCP server URL.

## Limits

Defaults are intentionally conservative:

- Max 20 product URLs per run.
- Max 20 gallery images per product.
- Max 5 concurrent product pages.

Override with `MAX_URLS_PER_RUN`, `MAX_IMAGES_PER_PRODUCT`, and `MAX_CONCURRENT_PRODUCTS`.

## References

- MCP TypeScript SDK Streamable HTTP server guidance: https://ts.sdk.modelcontextprotocol.io/documents/server.html
- OpenAI MCP server guidance: https://developers.openai.com/api/docs/mcp
- Google Drive custom file properties: https://developers.google.com/workspace/drive/api/guides/properties
- Google Drive appProperties search: https://developers.google.com/drive/api/guides/search-files
