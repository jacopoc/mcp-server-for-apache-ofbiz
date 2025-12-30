/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from 'node-fetch';
import type { JwtHeader, JwtPayload } from 'jsonwebtoken';

import { getJwksUri, createJwksClient, createKeyGetter, validateAccessToken } from './jwt.js';
import type { JwtValidatorConfig } from './jwt.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

// Mock jsonwebtoken - need to import the actual module to mock it properly
vi.mock('jsonwebtoken');

// Mock jwks-rsa
vi.mock('jwks-rsa', () => ({
  default: vi.fn()
}));

describe('JWT Authentication Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getJwksUri', () => {
    it('should fetch and return JWKS URI from OpenID configuration', async () => {
      const mockMetadata = {
        jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com'
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockMetadata)
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const result = await getJwksUri('https://auth.example.com');

      expect(result).toBe('https://auth.example.com/.well-known/jwks.json');
      expect(fetch).toHaveBeenCalledWith(
        'https://auth.example.com/.well-known/openid-configuration'
      );
    });

    it('should throw error when fetch fails', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Not Found'
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await expect(getJwksUri('https://auth.example.com')).rejects.toThrow(
        'Failed to fetch metadata: Not Found'
      );
    });

    it('should throw error when jwks_uri is missing', async () => {
      const mockMetadata = {
        issuer: 'https://auth.example.com'
        // jwks_uri is missing
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockMetadata)
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await expect(getJwksUri('https://auth.example.com')).rejects.toThrow(
        "Invalid OpenID metadata: 'jwks_uri' missing or not a string"
      );
    });

    it('should throw error when jwks_uri is not a string', async () => {
      const mockMetadata = {
        jwks_uri: 123, // Not a string
        issuer: 'https://auth.example.com'
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockMetadata)
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await expect(getJwksUri('https://auth.example.com')).rejects.toThrow(
        "Invalid OpenID metadata: 'jwks_uri' missing or not a string"
      );
    });
  });

  describe('createJwksClient', () => {
    it('should create JWKS client with correct configuration', async () => {
      const mockMetadata = {
        jwks_uri: 'https://auth.example.com/.well-known/jwks.json'
      };

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockMetadata)
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      const jwksClient = (await import('jwks-rsa')).default;
      const mockClient = { getSigningKey: vi.fn() };
      vi.mocked(jwksClient).mockReturnValue(mockClient as any);

      const result = await createJwksClient('https://auth.example.com');

      expect(result).toBe(mockClient);
      expect(jwksClient).toHaveBeenCalledWith({
        jwksUri: 'https://auth.example.com/.well-known/jwks.json',
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 600000 // 10 minutes
      });
    });

    it('should propagate errors from getJwksUri', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Internal Server Error'
      } as unknown as Response;

      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue(mockResponse);

      await expect(createJwksClient('https://auth.example.com')).rejects.toThrow();
    });
  });

  describe('createKeyGetter', () => {
    it('should return a function that retrieves signing key', () => {
      const mockKey = {
        getPublicKey: vi
          .fn()
          .mockReturnValue('-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----')
      };

      const mockClient = {
        getSigningKey: vi.fn((_kid, callback) => {
          callback(null, mockKey);
        })
      } as any;

      const keyGetter = createKeyGetter(mockClient);

      expect(typeof keyGetter).toBe('function');

      const mockCallback = vi.fn();
      const mockHeader: JwtHeader = { kid: 'test-key-id', alg: 'RS256' };

      keyGetter(mockHeader, mockCallback);

      expect(mockClient.getSigningKey).toHaveBeenCalledWith('test-key-id', expect.any(Function));
      expect(mockCallback).toHaveBeenCalledWith(
        null,
        '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
      );
    });

    it('should return error when kid is missing from header', () => {
      const mockClient = {
        getSigningKey: vi.fn()
      } as any;

      const keyGetter = createKeyGetter(mockClient);
      const mockCallback = vi.fn();
      const mockHeader: JwtHeader = { alg: 'RS256' }; // No kid

      keyGetter(mockHeader, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(expect.any(Error));
      expect(mockCallback.mock.calls[0][0].message).toBe("Missing 'kid' in token header");
      expect(mockClient.getSigningKey).not.toHaveBeenCalled();
    });

    it('should propagate errors from getSigningKey', () => {
      const mockError = new Error('Failed to get signing key');
      const mockClient = {
        getSigningKey: vi.fn((_kid, callback) => {
          callback(mockError, undefined);
        })
      } as any;

      const keyGetter = createKeyGetter(mockClient);
      const mockCallback = vi.fn();
      const mockHeader: JwtHeader = { kid: 'test-key-id', alg: 'RS256' };

      keyGetter(mockHeader, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(mockError, undefined);
    });

    it('should handle case when key is undefined', () => {
      const mockClient = {
        getSigningKey: vi.fn((_kid, callback) => {
          callback(null, undefined);
        })
      } as any;

      const keyGetter = createKeyGetter(mockClient);
      const mockCallback = vi.fn();
      const mockHeader: JwtHeader = { kid: 'test-key-id', alg: 'RS256' };

      keyGetter(mockHeader, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith(null, undefined);
    });
  });

  describe('validateAccessToken', () => {
    const mockConfig: JwtValidatorConfig = {
      authzServerBaseUrl: 'https://auth.example.com',
      mcpServerClientId: 'test-client-id'
    };

    it('should validate a valid token successfully', async () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'RS256', kid: 'test-key-id' }
      };
      const mockPayload: JwtPayload = {
        sub: 'user-123',
        client_id: 'test-client-id',
        scope: 'read write',
        aud: 'test-client-id',
        iss: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;

      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);

      // Mock jwt.verify to call the callback with the payload
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(null, mockPayload);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result).toEqual({
        valid: true,
        clientId: 'test-client-id',
        scopes: ['read', 'write'],
        userId: 'user-123',
        audience: 'test-client-id',
        subjectToken: mockToken
      });

      expect(jwt.verify).toHaveBeenCalledWith(
        mockToken,
        mockGetKey,
        {
          algorithms: ['RS256'],
          audience: 'test-client-id',
          issuer: 'https://auth.example.com'
        },
        expect.any(Function)
      );
    });

    it('should return invalid result when token has no algorithm', async () => {
      const mockToken = 'invalid.jwt.token';
      const mockDecodedHeader = {
        header: {} // No alg
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result).toEqual({ valid: false });
      expect(console.error).toHaveBeenCalledWith('Token validation error:', expect.any(Error));
    });

    it('should return invalid result when decode returns null', async () => {
      const mockToken = 'invalid.jwt.token';

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(null);

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result).toEqual({ valid: false });
    });

    it('should return invalid result when jwt.verify fails', async () => {
      const mockToken = 'expired.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'RS256', kid: 'test-key-id' }
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);

      // Mock jwt.verify to call the callback with an error
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(new Error('Token expired'), undefined);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result).toEqual({ valid: false });
      expect(console.error).toHaveBeenCalledWith('Token validation error:', expect.any(Error));
    });

    it('should handle token with no scope claim', async () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'RS256', kid: 'test-key-id' }
      };
      const mockPayload: JwtPayload = {
        sub: 'user-123',
        client_id: 'test-client-id',
        aud: 'test-client-id',
        iss: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
        // No scope
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(null, mockPayload);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result).toEqual({
        valid: true,
        clientId: 'test-client-id',
        scopes: undefined,
        userId: 'user-123',
        audience: 'test-client-id',
        subjectToken: mockToken
      });
    });

    it('should handle token with empty scope string', async () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'RS256', kid: 'test-key-id' }
      };
      const mockPayload: JwtPayload = {
        sub: 'user-123',
        client_id: 'test-client-id',
        scope: '', // Empty scope
        aud: 'test-client-id',
        iss: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(null, mockPayload);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result.scopes).toEqual(['']);
    });

    it('should handle token with multiple audiences', async () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'RS256', kid: 'test-key-id' }
      };
      const mockPayload: JwtPayload = {
        sub: 'user-123',
        client_id: 'test-client-id',
        scope: 'read',
        aud: ['test-client-id', 'another-audience'],
        iss: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(null, mockPayload);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      const result = await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(result.audience).toEqual(['test-client-id', 'another-audience']);
    });

    it('should use the algorithm from the token header', async () => {
      const mockToken = 'valid.jwt.token';
      const mockDecodedHeader = {
        header: { alg: 'ES256', kid: 'test-key-id' } // Different algorithm
      };
      const mockPayload: JwtPayload = {
        sub: 'user-123',
        client_id: 'test-client-id',
        aud: 'test-client-id',
        iss: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const jwtModule = await import('jsonwebtoken');
      const jwt = jwtModule.default;
      vi.mocked(jwt.decode).mockReturnValue(mockDecodedHeader as any);
      vi.mocked(jwt.verify).mockImplementation(
        (_token: any, _getKey: any, _options: any, callback: any) => {
          if (typeof callback === 'function') {
            callback(null, mockPayload);
          }
          return undefined as any;
        }
      );

      const mockGetKey = vi.fn();
      await validateAccessToken(mockToken, mockGetKey, mockConfig);

      expect(jwt.verify).toHaveBeenCalledWith(
        mockToken,
        mockGetKey,
        {
          algorithms: ['ES256'], // Should use ES256 from token header
          audience: 'test-client-id',
          issuer: 'https://auth.example.com'
        },
        expect.any(Function)
      );
    });
  });
});
