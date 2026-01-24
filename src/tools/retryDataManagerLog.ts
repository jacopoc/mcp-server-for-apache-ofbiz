
import { z } from 'zod';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';

import type { ServerConfig, ToolDefinition } from '../lib/config/types.js';

export default function (serverConfig: ServerConfig): ToolDefinition {
    return {
        name: 'retryDataManagerLog',
        metadata: {
            title: 'Retry DataManager Log',
            description: 'Retry a failed DataManager log. If content is provided, it uploads the content as a new data resource and retries the job with it. Otherwise, it retries with the original configuration.',
            inputSchema: {
                logId: z.string().describe('The ID of the DataManager Log to retry.'),
                content: z.string().optional().describe('Optional new content (e.g. fixed CSV/JSON) to use for the retry. If not provided, the original file/config will be used.')
            },
            outputSchema: {
                successMessage: z.string().optional(),
                result: z.any().optional(),
                isError: z.boolean().optional(),
                errorMessage: z.string().optional()
            }
        },
        handler: async (args: { logId: string; content?: string }, request: express.Request) => {
            const backendUrl = `${serverConfig.BACKEND_API_BASE}/api/service/retryDataManagerLog`;

            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });

            const body: any = {
                logId: args.logId
            };
            if (args.content) {
                body.content = args.content;
            }

            const requestOptions: any = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': serverConfig.BACKEND_USER_AGENT || '',
                    Accept: 'application/json',
                    Authorization: (request as any).authInfo?.downstreamToken
                        ? `Bearer ${(request as any).authInfo.downstreamToken}`
                        : (serverConfig.BACKEND_ACCESS_TOKEN ? `Bearer ${serverConfig.BACKEND_ACCESS_TOKEN}` : '')
                },
                body: JSON.stringify(body),
                agent: httpsAgent
            };

            try {
                const response = await fetch(backendUrl, requestOptions);

                if (!response.ok) {
                    const errorText = await response.text();
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error retrying DataManager log: ${response.status} - ${errorText}`
                            }
                        ],
                        isError: true
                    };
                }

                const responseData = await response.json() as any;

                // The service returns 'result' map if successful, or throws error
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(responseData, null, 2)
                        }
                    ],
                    structuredContent: {
                        successMessage: responseData.successMessage,
                        result: responseData.result
                    }
                };

            } catch (error) {
                console.error('Error in retryDataManagerLog:', error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error retrying DataManager log: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                    ],
                    isError: true
                };
            }
        }
    };
}
