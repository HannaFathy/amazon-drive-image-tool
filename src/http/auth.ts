import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.js";
import { errorMessage } from "../utils.js";

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

let jwksPromise: Promise<RemoteJwks> | undefined;

export function protectedResourceMetadata(_req: Request, res: Response): void {
  const authorizationServers = config.oauthIssuerUrl
    ? [config.oauthIssuerUrl]
    : [];

  res.json({
    resource: config.mcpResourceUrl,
    resource_name: config.appName,
    authorization_servers: authorizationServers,
    scopes_supported: config.requiredScopes,
    bearer_methods_supported: ["header"],
  });
}

export async function requireMcpAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!config.authRequired) {
    next();
    return;
  }

  const token = readBearerToken(req);
  if (!token) {
    rejectAuth(res, 401, "missing_token", "Missing bearer token.");
    return;
  }

  try {
    if (config.devBearerToken && token === config.devBearerToken) {
      next();
      return;
    }

    await verifyJwtToken(token);
    next();
  } catch (error) {
    rejectAuth(res, 401, "invalid_token", errorMessage(error));
  }
}

function readBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

async function verifyJwtToken(token: string): Promise<JWTPayload> {
  if (!config.oauthIssuerUrl) {
    throw new Error(
      "OAUTH_ISSUER_URL is required unless DEV_BEARER_TOKEN is used.",
    );
  }

  const jwks = await getJwks();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.oauthIssuerUrl,
    audience: config.oauthAudience ?? config.mcpResourceUrl,
  });

  requireScopes(payload);
  return payload;
}

async function getJwks(): Promise<RemoteJwks> {
  if (!jwksPromise) {
    jwksPromise = resolveJwksUrl().then((jwksUrl) =>
      createRemoteJWKSet(jwksUrl),
    );
  }

  return jwksPromise;
}

async function resolveJwksUrl(): Promise<URL> {
  if (config.oauthJwksUrl) {
    return new URL(config.oauthJwksUrl);
  }

  if (!config.oauthIssuerUrl) {
    throw new Error("OAUTH_ISSUER_URL is required to resolve JWKS metadata.");
  }

  const discoveryUrl = new URL(
    "/.well-known/openid-configuration",
    config.oauthIssuerUrl,
  );
  const response = await fetch(discoveryUrl);
  if (!response.ok) {
    throw new Error(
      `OIDC discovery failed with ${response.status} ${response.statusText}.`,
    );
  }

  const metadata = (await response.json()) as { jwks_uri?: string };
  if (!metadata.jwks_uri) {
    throw new Error("OIDC discovery response did not include jwks_uri.");
  }

  return new URL(metadata.jwks_uri);
}

function requireScopes(payload: JWTPayload): void {
  if (config.requiredScopes.length === 0) {
    return;
  }

  const scopes = new Set<string>();
  const scopeClaim = payload.scope;
  if (typeof scopeClaim === "string") {
    for (const scope of scopeClaim.split(/\s+/)) {
      if (scope) {
        scopes.add(scope);
      }
    }
  }

  const scpClaim = payload.scp;
  if (Array.isArray(scpClaim)) {
    for (const scope of scpClaim) {
      if (typeof scope === "string") {
        scopes.add(scope);
      }
    }
  }

  const missing = config.requiredScopes.filter((scope) => !scopes.has(scope));
  if (missing.length > 0) {
    throw new Error(`Token is missing required scope(s): ${missing.join(", ")}`);
  }
}

function rejectAuth(
  res: Response,
  status: number,
  error: string,
  message: string,
): void {
  const metadataUrl = `${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;
  const scope = config.requiredScopes.join(" ");
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl}", scope="${scope}", error="${error}"`,
  );
  res.status(status).json({
    error,
    message,
    resource_metadata: metadataUrl,
  });
}
