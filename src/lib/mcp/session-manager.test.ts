import { describe, it, expect, beforeEach } from 'vitest';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { SessionManager } from './session-manager.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockTransport: StreamableHTTPServerTransport;

  beforeEach(() => {
    sessionManager = new SessionManager();
    // Create a minimal mock transport
    mockTransport = {
      sessionId: 'test-session-id'
    } as StreamableHTTPServerTransport;
  });

  describe('addSession', () => {
    it('should add a new session', () => {
      sessionManager.addSession('session-1', mockTransport);
      expect(sessionManager.hasSession('session-1')).toBe(true);
    });

    it('should initialize downstream token as null', () => {
      sessionManager.addSession('session-1', mockTransport);
      expect(sessionManager.getDownstreamToken('session-1')).toBeNull();
    });
  });

  describe('getTransport', () => {
    it('should return transport for existing session', () => {
      sessionManager.addSession('session-1', mockTransport);
      const transport = sessionManager.getTransport('session-1');
      expect(transport).toBe(mockTransport);
    });

    it('should return undefined for non-existent session', () => {
      const transport = sessionManager.getTransport('non-existent');
      expect(transport).toBeUndefined();
    });
  });

  describe('hasSession', () => {
    it('should return true for existing session', () => {
      sessionManager.addSession('session-1', mockTransport);
      expect(sessionManager.hasSession('session-1')).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(sessionManager.hasSession('non-existent')).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.deleteSession('session-1');
      expect(sessionManager.hasSession('session-1')).toBe(false);
    });

    it('should handle deleting non-existent session', () => {
      expect(() => sessionManager.deleteSession('non-existent')).not.toThrow();
    });

    it('should handle undefined session ID', () => {
      expect(() => sessionManager.deleteSession(undefined)).not.toThrow();
    });
  });

  describe('getDownstreamToken', () => {
    it('should return null for new session', () => {
      sessionManager.addSession('session-1', mockTransport);
      expect(sessionManager.getDownstreamToken('session-1')).toBeNull();
    });

    it('should return null for non-existent session', () => {
      expect(sessionManager.getDownstreamToken('non-existent')).toBeNull();
    });
  });

  describe('setDownstreamToken', () => {
    it('should set downstream token for existing session', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.setDownstreamToken('session-1', 'test-token');
      expect(sessionManager.getDownstreamToken('session-1')).toBe('test-token');
    });

    it('should not throw error when setting token for non-existent session', () => {
      expect(() => sessionManager.setDownstreamToken('non-existent', 'token')).not.toThrow();
    });

    it('should update existing token', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.setDownstreamToken('session-1', 'token-1');
      sessionManager.setDownstreamToken('session-1', 'token-2');
      expect(sessionManager.getDownstreamToken('session-1')).toBe('token-2');
    });
  });

  describe('getSessionCount', () => {
    it('should return 0 for new manager', () => {
      expect(sessionManager.getSessionCount()).toBe(0);
    });

    it('should return correct count after adding sessions', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.addSession('session-2', mockTransport);
      expect(sessionManager.getSessionCount()).toBe(2);
    });

    it('should return correct count after deleting sessions', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.addSession('session-2', mockTransport);
      sessionManager.deleteSession('session-1');
      expect(sessionManager.getSessionCount()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all sessions', () => {
      sessionManager.addSession('session-1', mockTransport);
      sessionManager.addSession('session-2', mockTransport);
      sessionManager.clear();
      expect(sessionManager.getSessionCount()).toBe(0);
    });
  });
});
