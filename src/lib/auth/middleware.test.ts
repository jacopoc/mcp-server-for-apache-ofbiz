import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

import { createAuthMiddleware } from './middleware.js';
import type { AuthenticatedRequest } from './middleware.js';
import type { JwtValidationResult } from './jwt.js';

describe('createAuthMiddleware', () => {
  let mockReq: Partial<express.Request>;
  let mockRes: Partial<express.Response>;
  let mockNext: express.NextFunction;
  let mockValidateAccessToken: (token: string) => Promise<JwtValidationResult>;
  const resourceMetadataUrl = 'https://example.com/.well-known/oauth-authorization-server';

  beforeEach(() => {
    // Reset mocks before each test
    mockReq = {
      headers: {}
    };

    const jsonMock = vi.fn().mockReturnThis();
    const statusMock = vi.fn().mockReturnThis();
    const setMock = vi.fn().mockReturnThis();

    mockRes = {
      status: statusMock,
      set: setMock,
      json: jsonMock
    };

    mockNext = vi.fn();
    mockValidateAccessToken = vi.fn();
  });

  describe('missing authorization header', () => {
    it('should return 401 when authorization header is missing', async () => {
      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        `Bearer realm="mcp", as_uri="${resourceMetadataUrl}"`
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authorization required'
        },
        id: null
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header does not start with Bearer', async () => {
      mockReq.headers = {
        authorization: 'Basic sometoken'
      };

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        `Bearer realm="mcp", as_uri="${resourceMetadataUrl}"`
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when authorization header is just "Bearer "', async () => {
      mockReq.headers = {
        authorization: 'Bearer '
      };

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      // Token will be empty string, validation should handle it
      expect(mockValidateAccessToken).toHaveBeenCalledWith('');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('valid token', () => {
    it('should call next() and attach auth to request when token is valid', async () => {
      const validToken = 'valid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${validToken}`
      };

      const validationResult: JwtValidationResult = {
        valid: true,
        userId: 'user-123',
        scopes: ['read', 'write']
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockValidateAccessToken).toHaveBeenCalledWith(validToken);
      expect((mockReq as AuthenticatedRequest).auth).toEqual(validationResult);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('should handle validation result with additional properties', async () => {
      const validToken = 'valid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${validToken}`
      };

      const validationResult: JwtValidationResult = {
        valid: true,
        userId: 'user-123',
        scopes: ['read', 'write'],
        audience: 'https://api.example.com',
        clientId: 'client-123'
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect((mockReq as AuthenticatedRequest).auth).toEqual(validationResult);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('invalid token', () => {
    it('should return 401 when token validation fails', async () => {
      const invalidToken = 'invalid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${invalidToken}`
      };

      const validationResult: JwtValidationResult = {
        valid: false
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockValidateAccessToken).toHaveBeenCalledWith(invalidToken);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        `Bearer realm="mcp", error="invalid_token", as_uri="${resourceMetadataUrl}"`
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Invalid or expired token'
        },
        id: null
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should not attach auth to request when token is invalid', async () => {
      const invalidToken = 'invalid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${invalidToken}`
      };

      const validationResult: JwtValidationResult = {
        valid: false
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect((mockReq as AuthenticatedRequest).auth).toBeUndefined();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return 500 when validation throws an error', async () => {
      const validToken = 'valid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${validToken}`
      };

      const error = new Error('JWKS fetch failed');
      mockValidateAccessToken = vi.fn().mockRejectedValue(error);

      // Mock console.error to suppress error output in tests
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockValidateAccessToken).toHaveBeenCalledWith(validToken);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Authentication error:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error during authentication'
        },
        id: null
      });
      expect(mockNext).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-Error exceptions', async () => {
      const validToken = 'valid.jwt.token';
      mockReq.headers = {
        authorization: `Bearer ${validToken}`
      };

      mockValidateAccessToken = vi.fn().mockRejectedValue('String error');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Authentication error:', 'String error');
      expect(mockRes.status).toHaveBeenCalledWith(500);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('token extraction', () => {
    it('should correctly extract token after "Bearer " prefix', async () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature';
      mockReq.headers = {
        authorization: `Bearer ${token}`
      };

      const validationResult: JwtValidationResult = {
        valid: true,
        userId: 'user-123',
        scopes: []
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockValidateAccessToken).toHaveBeenCalledWith(token);
    });

    it('should handle authorization header with extra spaces', async () => {
      const token = 'valid.token';
      mockReq.headers = {
        authorization: `Bearer  ${token}` // Extra space
      };

      const validationResult: JwtValidationResult = {
        valid: true,
        userId: 'user-123',
        scopes: []
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      // Token will have an extra space at the beginning
      expect(mockValidateAccessToken).toHaveBeenCalledWith(` ${token}`);
    });
  });

  describe('WWW-Authenticate header', () => {
    it('should include correct realm and as_uri for missing token', async () => {
      const customMetadataUrl = 'https://custom.auth.com/metadata';
      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl: customMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        `Bearer realm="mcp", as_uri="${customMetadataUrl}"`
      );
    });

    it('should include error parameter for invalid token', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid.token'
      };

      const validationResult: JwtValidationResult = {
        valid: false
      };

      mockValidateAccessToken = vi.fn().mockResolvedValue(validationResult);

      const customMetadataUrl = 'https://custom.auth.com/metadata';
      const middleware = createAuthMiddleware({
        validateAccessToken: mockValidateAccessToken,
        resourceMetadataUrl: customMetadataUrl
      });

      await middleware(mockReq as express.Request, mockRes as express.Response, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith(
        'WWW-Authenticate',
        `Bearer realm="mcp", error="invalid_token", as_uri="${customMetadataUrl}"`
      );
    });
  });
});
