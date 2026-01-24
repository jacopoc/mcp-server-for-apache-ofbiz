
import { z } from 'zod';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';

import type { ServerConfig, ToolDefinition } from '../lib/config/types.js';

export default function (serverConfig: ServerConfig): ToolDefinition {
    return {
        name: 'getDataManagerConfig',
        metadata: {
            title: 'Get DataManager Config',
            description: 'Fetch details of a DataManagerConfig.',
            inputSchema: {
                configId: z.string().describe('The configuration ID.')
            },
            outputSchema: {
                config: z.object({
                    configId: z.string(),
                    description: z.string().optional(),
                    importServiceName: z.string().optional(),
                    cronExpression: z.string().optional(),
                    jsonConfig: z.string().optional()
                }).describe('The DataManager configuration details.')
            }
        },
        handler: async (args: { configId: string }, request: express.Request) => {
            const backendUrl = `${serverConfig.BACKEND_API_BASE}/api/service/getDataManagerConfig`;

            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });

            const body: any = {
                configId: args.configId
            };

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
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const responseData = await response.json() as any;
                const config = responseData.config;

                if (!config) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `No configuration found for ID: ${args.configId}`
                            }
                        ],
                        isError: true
                    };
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(config, null, 2)
                        }
                    ],
                    structuredContent: {
                        config
                    }
                };
            } catch (error) {
                console.error('Error in getDataManagerConfig:', error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error getting DataManager config: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                    ],
                    isError: true
                };
            }
        }
    };
}
