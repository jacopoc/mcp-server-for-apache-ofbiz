import { z } from 'zod';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';

import type { ServerConfig, ToolDefinition } from '../lib/config/types.js';

export default function (serverConfig: ServerConfig): ToolDefinition {
    return {
        name: 'findDataManagerLogs',
        metadata: {
            title: 'Find DataManager Logs',
            description: 'Find DataManager Logs based on search criteria.',
            inputSchema: {
                logId: z.string().optional().describe('The ID of the log to search for.'),
                configId: z.string().optional().describe('The configuration ID.'),
                statusId: z.string().optional().describe('The status of the log.'),
                jobId: z.string().optional().describe('The job ID.'),
                viewIndex: z.number().optional().default(0).describe('Zero-based index of the page to retrieve.'),
                viewSize: z.number().optional().default(20).describe('Number of records per page.')
            },
            outputSchema: {
                logs: z.array(z.object({
                    logId: z.string(),
                    configId: z.string().optional(),
                    statusId: z.string().optional(),
                    jobId: z.string().optional(),
                    createdDate: z.union([z.string(), z.number()]).optional(),
                    reason: z.string().optional()
                })).describe('List of found logs.'),
                totalCount: z.number().optional().describe('Total number of matching records.')
            }
        },
        handler: async (args: { logId?: string; configId?: string; statusId?: string; jobId?: string; viewIndex?: number; viewSize?: number }, request: express.Request) => {
            const backendUrl = `${serverConfig.BACKEND_API_BASE}/api/service/getDataManagerLogs`;

            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });

            const body: any = {
                logId: args.logId,
                configId: args.configId,
                statusId: args.statusId,
                jobId: args.jobId,
                viewIndex: args.viewIndex,
                viewSize: args.viewSize
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
                const docs = responseData.logs || [];

                const logs = docs.map((log: any) => ({
                    logId: log.logId,
                    configId: log.configId || undefined,
                    statusId: log.statusId || undefined,
                    jobId: log.jobId || undefined,
                    createdDate: log.createdDate || undefined,
                    reason: log.statusId || undefined
                }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(logs)
                        }
                    ],
                    structuredContent: {
                        logs,
                        totalCount: responseData.totalCount
                    }
                };
            } catch (error) {
                console.error('Error in findDataManagerLogs:', error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error finding DataManager logs: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                    ],
                    isError: true
                };
            }
        }
    };
}
