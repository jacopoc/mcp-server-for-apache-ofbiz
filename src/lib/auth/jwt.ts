import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import type { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface JwtValidationResult {
  valid: boolean;
  clientId?: string;
  scopes?: string[];
  userId?: string;
  audience?: string | string[];
  subjectToken?: string;
}

export interface JwtValidatorConfig {
  authzServerBaseUrl: string;
  mcpServerClientId: string;
}

/**
 * Fetches JWKS URI from OpenID Connect metadata
 */
export async function getJwksUri(issuer: string): Promise<string> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.statusText}`);
  const metadata = (await res.json()) as Record<string, unknown>;
  const jwks = metadata['jwks_uri'];
  if (typeof jwks !== 'string') {
    throw new Error("Invalid OpenID metadata: 'jwks_uri' missing or not a string");
  }
  return jwks;
}

/**
 * Creates a JWKS client for retrieving public keys
 */
export async function createJwksClient(authzServerBaseUrl: string): Promise<jwksClient.JwksClient> {
  const jwksUri = await getJwksUri(authzServerBaseUrl);
  return jwksClient({
    jwksUri,
    cache: true, // enable local caching
    cacheMaxEntries: 5, // maximum number of keys stored
    cacheMaxAge: 10 * 60 * 1000 // 10 minutes
  });
}

/**
 * Creates a function to get the public key from the JWT's kid
 */
export function createKeyGetter(client: jwksClient.JwksClient) {
  return (header: JwtHeader, callback: SigningKeyCallback) => {
    if (!header.kid) {
      return callback(new Error("Missing 'kid' in token header"));
    }
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err, undefined);
      const signingKey = key?.getPublicKey();
      callback(null, signingKey);
    });
  };
}

/**
 * Validates an access token using JWT verification
 */
export async function validateAccessToken(
  token: string,
  getKey: (header: JwtHeader, callback: SigningKeyCallback) => void,
  config: JwtValidatorConfig
): Promise<JwtValidationResult> {
  try {
    // Using JWT tokens, validate locally
    const result = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      // Decode the token header to obtain the algorithm
      const decodedToken = jwt.decode(token, { complete: true }) as { header?: JwtHeader } | null;
      const alg = decodedToken?.header?.alg;
      if (!alg) return reject(new Error("Missing 'alg' in token header"));

      jwt.verify(
        token,
        getKey,
        {
          algorithms: [alg as jwt.Algorithm],
          audience: config.mcpServerClientId,
          issuer: config.authzServerBaseUrl
        },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as jwt.JwtPayload);
        }
      );
    });

    return {
      valid: true,
      clientId: result.client_id,
      scopes: result.scope?.split(' '),
      userId: result.sub,
      audience: result.aud,
      subjectToken: token
    };
  } catch (error) {
    console.error('Token validation error:', error);
    return { valid: false };
  }
}
