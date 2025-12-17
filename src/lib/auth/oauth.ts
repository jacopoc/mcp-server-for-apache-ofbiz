import * as oidc_client from 'openid-client';

export interface TokenExchangeConfig {
  authzServerBaseUrl: string;
  mcpServerClientId: string;
  mcpServerClientSecret: string;
  tokenExchangeScope: string[];
  backendApiResource?: string;
  backendApiAudience?: string;
}

/**
 * OAuth server configuration cache
 */
let cachedAuthServerConfig: oidc_client.Configuration | null = null;

/**
 * Gets or creates a cached OpenID Configuration instance
 */
export async function getOAuthServerConfiguration(
  config: TokenExchangeConfig
): Promise<oidc_client.Configuration> {
  if (cachedAuthServerConfig) return cachedAuthServerConfig;

  try {
    cachedAuthServerConfig = await oidc_client.discovery(
      new URL(config.authzServerBaseUrl),
      config.mcpServerClientId,
      config.mcpServerClientSecret,
      undefined,
      { execute: [oidc_client.allowInsecureRequests] }
    );
    return cachedAuthServerConfig;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Failed to initialize OpenID client:', errorMessage);
    throw new Error('Failed to initialize OAuth client for token exchange');
  }
}

/**
 * Performs an OAuth 2.0 Token Exchange (RFC 8693)
 *
 * @param subjectToken - The access token received from the client or another API
 * @param config - Token exchange configuration
 * @returns The new access token to use for calling a downstream API
 */
export async function performTokenExchange(
  subjectToken: string,
  config: TokenExchangeConfig
): Promise<string | null> {
  try {
    // Discover the Authorization Server's configuration
    const authServerConfig = await getOAuthServerConfiguration(config);

    // Execute the token exchange request
    const requestParams: Record<string, string> = {
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: config.tokenExchangeScope.join(' ')
    };

    if (config.backendApiResource) {
      requestParams.resource = config.backendApiResource;
    }
    if (config.backendApiAudience) {
      requestParams.audience = config.backendApiAudience;
    }

    const response = await oidc_client.genericGrantRequest(
      authServerConfig,
      'urn:ietf:params:oauth:grant-type:token-exchange',
      requestParams
    );

    // Verify the response contains the expected access token
    if (!response?.access_token) {
      console.error('Token exchange succeeded but no access_token was returned:', response);
      return null;
    }
    return response.access_token;
  } catch (err: unknown) {
    console.error('Error during token exchange:', err);
    return null;
  }
}

/**
 * Resets the cached OAuth server configuration (useful for testing)
 */
export function resetOAuthServerConfigurationCache(): void {
  cachedAuthServerConfig = null;
}
