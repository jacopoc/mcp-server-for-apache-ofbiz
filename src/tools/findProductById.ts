import { z } from 'zod';
import express from 'express';

import { BACKEND_API_BASE, USER_AGENT } from '../server-remote.js';
import type { ToolDefinition } from '../toolLoader.js';

export default function (): ToolDefinition {
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
          .describe('ID of the product to find; must be between 2 and 20 characters long.'),
      },
      outputSchema: {
        productId: z.string().optional().describe('The unique identifier of the product.'),
        productName: z.string().optional().describe('The name of the product.'),
        internalName: z.string().optional().describe('The technical name of the product.'),
        description: z.string().optional().describe('A brief description of the product.'),
        productTypeId: z.string().optional().describe('The type identifier of the product.'),
      },
    },
    handler: async ({ id }: { id: string }, request: express.Request) => {
      const idParam = { idToFind: id };
      const inParams = encodeURIComponent(JSON.stringify(idParam));
      const backendUrl = `${BACKEND_API_BASE}/rest/services/findProductById?inParams=${inParams}`;

      const requestOptions: { method: string; headers: Record<string, string> } = {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((request as any).authInfo?.downstreamToken) {
        requestOptions.headers['Authorization'] =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `Bearer ${(request as any).authInfo.downstreamToken}`;
      }

      try {
        const response = await fetch(backendUrl, requestOptions);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        const structuredContent = {
          productId: responseData.data.product.productId || '',
          productName: responseData.data.product.productName || '',
          internalName: responseData.data.product.internalName || '',
          description: responseData.data.product.description || '',
          productTypeId: responseData.data.product.productTypeId || '',
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(structuredContent),
            },
          ],
          structuredContent: structuredContent,
        };
      } catch (error) {
        console.error('Error making backend request:', error);
        return {
          content: [
            {
              type: 'text',
              text: `Error finding product: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          structuredContent: {},
        };
      }
    },
  };
}
