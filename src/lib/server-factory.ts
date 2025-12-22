import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import type { Server as HTTPServer } from 'http';
import type { Server as HTTPSServer } from 'https';

import type express from 'express';

export interface TlsConfig {
  keyPath: string;
  certPath: string;
  passphrase?: string;
}

export interface ServerFactoryConfig {
  port: number;
  enableHttps: boolean;
  tlsConfig?: TlsConfig;
  enableAuth: boolean;
  enableTokenExchange: boolean;
}

/**
 * Creates an HTTP or HTTPS server from an Express app
 */
export function createServer(
  app: express.Application,
  config: ServerFactoryConfig
): HTTPServer | HTTPSServer {
  if (config.enableHttps && config.tlsConfig) {
    return createHttpsServer(app, config);
  } else {
    return createHttpServer(app, config);
  }
}

/**
 * Creates an HTTP server
 */
function createHttpServer(app: express.Application, config: ServerFactoryConfig): HTTPServer {
  const server = app.listen(config.port, () => {
    console.log(
      `MCP stateful Streamable HTTP Server listening on port ${config.port} with ${config.enableAuth ? 'authentication' : 'no authentication'} and ${config.enableTokenExchange ? 'token exchange' : 'no token exchange'}.`
    );
  });
  return server;
}

/**
 * Creates an HTTPS server with TLS configuration
 */
function createHttpsServer(app: express.Application, config: ServerFactoryConfig): HTTPSServer {
  if (!config.tlsConfig) {
    throw new Error('TLS configuration is required for HTTPS server');
  }

  try {
    // Resolve key/cert relative to the project if paths provided in config are relative
    const base = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const keyPath = path.isAbsolute(config.tlsConfig.keyPath)
      ? config.tlsConfig.keyPath
      : path.join(base, config.tlsConfig.keyPath);
    const certPath = path.isAbsolute(config.tlsConfig.certPath)
      ? config.tlsConfig.certPath
      : path.join(base, config.tlsConfig.certPath);

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    const serverOptions: https.ServerOptions = {
      key,
      cert,
      passphrase: config.tlsConfig.passphrase
    };

    const server = https.createServer(serverOptions, app);
    server.listen(config.port, () => {
      console.log(
        `MCP stateful Streamable HTTPS Server listening on port ${config.port} with ${config.enableAuth ? 'authentication' : 'no authentication'} and ${config.enableTokenExchange ? 'token exchange' : 'no token exchange'}.`
      );
    });
    return server;
  } catch (err) {
    console.error('Failed to start HTTPS server:', err);
    throw err;
  }
}
