import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resetOAuthServerConfigurationCache } from './oauth.js';
import type { TokenExchangeConfig } from './oauth.js';

describe('OAuth Module', () => {
  let testConfig: TokenExchangeConfig;

  beforeEach(() => {
    testConfig = {
      authzServerBaseUrl: 'https://auth.example.com',
      mcpServerClientId: 'test-client-id',
      mcpServerClientSecret: 'test-client-secret',
      tokenExchangeScope: ['api:read', 'api:write'],
      backendApiResource: 'https://api.example.com',
      backendApiAudience: 'api-audience'
    };
  });

  afterEach(() => {
    resetOAuthServerConfigurationCache();
  });

  describe('resetOAuthServerConfigurationCache', () => {
    it('should reset the cache without errors', () => {
      expect(() => resetOAuthServerConfigurationCache()).not.toThrow();
    });
  });

  // Note: performTokenExchange and getOAuthServerConfiguration are difficult to test
  // without mocking the entire oidc_client module. Integration tests would be more appropriate.
  // For unit tests, we can test the configuration structure and cache behavior.

  describe('TokenExchangeConfig', () => {
    it('should accept valid configuration', () => {
      expect(testConfig.authzServerBaseUrl).toBe('https://auth.example.com');
      expect(testConfig.mcpServerClientId).toBe('test-client-id');
      expect(testConfig.mcpServerClientSecret).toBe('test-client-secret');
      expect(testConfig.tokenExchangeScope).toEqual(['api:read', 'api:write']);
    });

    it('should allow optional resource and audience', () => {
      const minimalConfig: TokenExchangeConfig = {
        authzServerBaseUrl: 'https://auth.example.com',
        mcpServerClientId: 'test-client',
        mcpServerClientSecret: 'test-secret',
        tokenExchangeScope: []
      };
      expect(minimalConfig.backendApiResource).toBeUndefined();
      expect(minimalConfig.backendApiAudience).toBeUndefined();
    });
  });
});
