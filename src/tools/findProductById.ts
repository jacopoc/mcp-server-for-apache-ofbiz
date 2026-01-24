import { z } from 'zod';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';

import type { ServerConfig, ToolDefinition } from '../lib/config/types.js';

export default function (serverConfig: ServerConfig): ToolDefinition {
  return {
    name: 'findProductById',
    metadata: {
      title: 'Find a product by ID',
      description: 'Find a product by using its ID. If the ID is not provided, ask for it.',
      inputSchema: {
        id: z
          .string()
          .min(2)
          .max(20)
          .describe('ID of the product to find; must be between 2 and 20 characters long.')
      },
      outputSchema: {
        productId: z.string().describe('The unique identifier of the product.'),
        productName: z.string().optional().describe('The name of the product.'),
        internalName: z.string().optional().describe('The technical name of the product.'),
        description: z.string().optional().describe('A brief description of the product.'),
        productTypeId: z.string().optional().describe('The type identifier of the product.')
      }
    },
    handler: async ({ id }: { id: string }, request: express.Request) => {
      const idParam = { idToFind: id };

      const backendUrl = `${serverConfig.BACKEND_API_BASE}/api/service/findProductById`;

      console.log("---backendUrl", backendUrl);
      const httpsAgent = new https.Agent({
        rejectUnauthorized: false
      });

      const requestOptions: any = {
        method: 'POST',
        headers: {
          'User-Agent': serverConfig.BACKEND_USER_AGENT || '',
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: (request as any).auth?.downstreamToken
            ? `Bearer ${(request as any).auth.downstreamToken}`
            : (serverConfig.BACKEND_ACCESS_TOKEN ? `Bearer ${serverConfig.BACKEND_ACCESS_TOKEN}` : '')
        },
        body: JSON.stringify(idParam),
        agent: httpsAgent
      };

      try {
        const response = await fetch(backendUrl, requestOptions);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json() as any;
        // Adjusted check to match OFBiz REST plugin response structure { product: { ... } }
        if (!responseData || !responseData.product) {
          throw new Error('Product not found.');
        }
        const product = responseData.product;

        const structuredContent = {
          productId: product.productId || '',
          productName: product.productName || '',
          internalName: product.internalName || '',
          description: product.description || '',
          productTypeId: product.productTypeId || ''
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredContent)
            }
          ],
          structuredContent: structuredContent
        };
      } catch (error) {
        console.error('Error making backend request:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding product: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ],
          isError: true
        };
      }
    }
  };
}