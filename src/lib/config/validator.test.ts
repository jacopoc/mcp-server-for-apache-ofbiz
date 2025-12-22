import { describe, it, expect } from 'vitest';

import { validateConfig, ConfigValidationError } from './validator.js';
import type { ServerConfig } from './types.js';

describe('Config Validator', () => {
  const validConfig: ServerConfig = {
    BACKEND_API_BASE: 'https://api.example.com',
    SERVER_PORT: 3000
  };

  describe('validateConfig', () => {
    it('should pass validation for valid minimal config', () => {
      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it('should throw error if BACKEND_API_BASE is missing', () => {
      const invalidConfig = { SERVER_PORT: 3000 } as ServerConfig;
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('BACKEND_API_BASE is required');
    });

    it('should throw error if SERVER_PORT is missing', () => {
      const invalidConfig = { BACKEND_API_BASE: 'https://api.example.com' } as ServerConfig;
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('SERVER_PORT is required');
    });

    it('should throw error for invalid port number (too low)', () => {
      const invalidConfig = { ...validConfig, SERVER_PORT: 0 };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('must be between 1 and 65535');
    });

    it('should throw error for invalid port number (too high)', () => {
      const invalidConfig = { ...validConfig, SERVER_PORT: 65536 };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('must be between 1 and 65535');
    });

    it('should throw error if MCP_SERVER_BASE_URL is missing when AUTHZ_SERVER_BASE_URL is present', () => {
      const invalidConfig = {
        ...validConfig,
        AUTHZ_SERVER_BASE_URL: 'https://auth.example.com'
      };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('MCP_SERVER_BASE_URL is required');
    });

    it('should throw error if AUTHZ_SERVER_BASE_URL is missing when MCP_SERVER_BASE_URL is present', () => {
      const invalidConfig = {
        ...validConfig,
        MCP_SERVER_BASE_URL: 'https://mcp.example.com'
      };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('AUTHZ_SERVER_BASE_URL is required');
    });

    it('should pass validation when both auth URLs are present', () => {
      const validAuthConfig = {
        ...validConfig,
        MCP_SERVER_BASE_URL: 'https://mcp.example.com',
        AUTHZ_SERVER_BASE_URL: 'https://auth.example.com'
      };
      expect(() => validateConfig(validAuthConfig)).not.toThrow();
    });

    it('should throw error if TLS_KEY_PATH is missing when TLS_CERT_PATH is present', () => {
      const invalidConfig = {
        ...validConfig,
        TLS_CERT_PATH: '/path/to/cert.pem'
      };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('TLS_KEY_PATH is required');
    });

    it('should throw error if TLS_CERT_PATH is missing when TLS_KEY_PATH is present', () => {
      const invalidConfig = {
        ...validConfig,
        TLS_KEY_PATH: '/path/to/key.pem'
      };
      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
      expect(() => validateConfig(invalidConfig)).toThrow('TLS_CERT_PATH is required');
    });

    it('should pass validation when both TLS paths are present', () => {
      const validTlsConfig = {
        ...validConfig,
        TLS_KEY_PATH: '/path/to/key.pem',
        TLS_CERT_PATH: '/path/to/cert.pem'
      };
      expect(() => validateConfig(validTlsConfig)).not.toThrow();
    });
  });
});
