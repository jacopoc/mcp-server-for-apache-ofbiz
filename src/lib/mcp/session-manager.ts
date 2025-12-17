import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  downstreamToken: string | null;
}

/**
 * Manages MCP server sessions and their associated transports
 */
export class SessionManager {
  private sessions = new Map<string, SessionEntry>();

  /**
   * Gets a transport by session ID
   */
  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    const entry = this.sessions.get(sessionId);
    return entry?.transport;
  }

  /**
   * Gets the downstream token for a session
   */
  getDownstreamToken(sessionId: string): string | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    return entry.downstreamToken;
  }

  /**
   * Adds a new session
   */
  addSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
    this.sessions.set(sessionId, { transport, downstreamToken: null });
  }

  /**
   * Deletes a session
   */
  deleteSession(sessionId?: string): void {
    if (!sessionId) return;
    this.sessions.delete(sessionId);
  }

  /**
   * Sets the downstream token for a session
   */
  setDownstreamToken(sessionId: string, downstreamToken: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.downstreamToken = downstreamToken;
  }

  /**
   * Checks if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Gets the number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clears all sessions (useful for testing)
   */
  clear(): void {
    this.sessions.clear();
  }
}
