import type express from 'express';

import type { JwtValidationResult } from './jwt.js';

export interface AuthenticatedRequest extends express.Request {
  auth?: ValidationResult;
}

export interface ValidationResult extends JwtValidationResult {
  downstreamToken?: string | null;
}

export interface AuthMiddlewareConfig {
  validateAccessToken: (token: string) => Promise<JwtValidationResult>;
  resourceMetadataUrl: string;
}

/**
 * Creates Express middleware to check for valid access token
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Return 401 with WWW-Authenticate header pointing to metadata
      res
        .status(401)
        .set('WWW-Authenticate', `Bearer realm="mcp", as_uri="${config.resourceMetadataUrl}"`)
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Unauthorized'
          },
          id: null
        });
      return;
    }

    const token = authHeader.substring(7);

    try {
      // Validate the access token
      const validationResult = await config.validateAccessToken(token);

      if (!validationResult.valid) {
        res
          .status(401)
          .set(
            'WWW-Authenticate',
            `Bearer realm="mcp", error="invalid_token", as_uri="${config.resourceMetadataUrl}"`
          )
          .json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Invalid or expired token'
            },
            id: null
          });
        return;
      }

      // Attach user/token info to request for use in handlers
      (req as AuthenticatedRequest).auth = validationResult;
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error during authentication'
        },
        id: null
      });
    }
  };
}
