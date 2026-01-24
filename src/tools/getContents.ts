import { z } from 'zod';
import express from 'express';
import fetch from 'node-fetch';
import https from 'https';
import fs from 'fs';
import path from 'path';

import type { ServerConfig, ToolDefinition } from '../lib/config/types.js';

export default function (serverConfig: ServerConfig): ToolDefinition {
    return {
        name: 'getContent',
        metadata: {
            title: 'Get Content Text',
            description: 'Fetch the text content of a given Content ID (e.g. error log, text file). Supports streaming to local files for large payloads.',
            inputSchema: {
                contentId: z
                    .string()
                    .min(1)
                    .describe('The unique identifier of the Content to retrieve.'),
                configId: z.string().optional().describe('The DataManager Config ID associated with this content.'),
                category: z.enum(['uploaded', 'error']).optional().describe('Category of the content (uploaded or error).'),
                fullContent: z.boolean().optional().default(false).describe('If true, attempts to fetch the entire file without truncation (up to 10MB).'),
                outputPath: z.string().optional().describe('Optional absolute local path to save the full content directly to disk. Bypasses LLM context.'),
                offset: z.number().optional().describe('Starting byte offset for partial fetching.'),
                length: z.number().optional().describe('Number of bytes to fetch for partial fetching.')
            },
            outputSchema: {
                contentId: z.string(),
                dataResourceId: z.string().optional(),
                textData: z.string().optional(),
                mimeType: z.string().optional(),
                totalSize: z.number().optional(),
                bytesReturned: z.number().optional(),
                isTruncated: z.boolean().optional(),
                outputPath: z.string().optional()
            }
        },
        handler: async (args: {
            contentId: string;
            configId?: string;
            category?: 'uploaded' | 'error';
            fullContent?: boolean;
            outputPath?: string;
            offset?: number;
            length?: number;
        }, request: express.Request) => {
            const httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });

            const getServiceRequestOptions = (body: any) => ({
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
            });

            try {
                // 1. Fetch Content to get dataResourceId
                const contentResponse = await fetch(`${serverConfig.BACKEND_API_BASE}/api/service/getContent`, getServiceRequestOptions({ contentId: args.contentId }));
                if (!contentResponse.ok) throw new Error(`Failed to fetch Content: ${contentResponse.status}`);

                const contentData = await contentResponse.json() as any;
                const contentRecord = contentData.content;
                if (!contentRecord) {
                    return {
                        content: [{ type: 'text', text: `Content not found: ${args.contentId}` }],
                        isError: true
                    };
                }
                const dataResourceId = contentRecord.dataResourceId;

                if (!dataResourceId) {
                    return {
                        content: [{ type: 'text', text: `No dataResourceId for Content: ${args.contentId}` }],
                        isError: true
                    };
                }

                // 2. Fetch DataResource to determine type
                const drResponse = await fetch(`${serverConfig.BACKEND_API_BASE}/api/service/getDataResource`, getServiceRequestOptions({ dataResourceId }));
                if (!drResponse.ok) throw new Error(`Failed to fetch DataResource: ${drResponse.status}`);
                const drData = await drResponse.json() as any;
                const dr = drData.dataResource;

                if (!dr) {
                    return {
                        content: [{ type: 'text', text: `DataResource not found for ID: ${dataResourceId}` }],
                        isError: true
                    };
                }

                const dataResourceTypeId = dr.dataResourceTypeId;
                let textData = '';
                let totalSize = 0;
                let isTruncated = false;
                // 3A. Handle DOCUMENT DataResource (file-based)
                if (dataResourceTypeId === 'DOCUMENT') {
                    if (!dr.objectInfo) {
                        return {
                            content: [{ type: 'text', text: `No file path (objectInfo) for DOCUMENT: ${dataResourceId}` }],
                            isError: true
                        };
                    }

                    const documentPath = path.resolve(dr.objectInfo);

                    if (!fs.existsSync(documentPath)) {
                        return {
                            content: [{ type: 'text', text: `Document file not found at path: ${documentPath}` }],
                            isError: true
                        };
                    }

                    const jsonData = JSON.parse(await fs.promises.readFile(documentPath, 'utf-8'));
                    const jsonString = JSON.stringify(jsonData, null, 2);

                    totalSize = Buffer.byteLength(jsonString, 'utf-8');

                    const maxMemorySize = args.fullContent ? 10 * 1024 * 1024 : 50 * 1024;

                    if (jsonString.length > maxMemorySize) {
                        textData = jsonString.substring(0, maxMemorySize);
                        isTruncated = true;
                    } else {
                        textData = jsonString;
                    }
                }


                // 3. Handle Electronic Text first (standard OFBiz DB storage)
                if (dataResourceTypeId === 'ELECTRONIC_TEXT' || dataResourceTypeId === 'SHORT_TEXT') {
                    const textResponse = await fetch(`${serverConfig.BACKEND_API_BASE}/api/service/getElectronicText`, getServiceRequestOptions({ dataResourceId }));
                    if (textResponse.ok) {
                        const textDataResponse = await textResponse.json() as any;
                        const electronicText = textDataResponse.electronicText;
                        if (electronicText) {
                            textData = electronicText.textData;
                            totalSize = textData.length;
                        }
                    }
                }

                // 4. Fallback / Primary for Files: Remote Fetching via DownloadCsvFile
                if (!textData) {
                    const token = (request as any).authInfo?.downstreamToken || serverConfig.BACKEND_ACCESS_TOKEN;
                    let fetchUrl = `${serverConfig.BACKEND_API_BASE}/api/DownloadCsvFile?contentId=${args.contentId}`;

                    if (args.offset !== undefined) fetchUrl += `&offset=${args.offset}`;
                    if (args.length !== undefined) fetchUrl += `&length=${args.length}`;

                    const remoteResponse = await fetch(fetchUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'User-Agent': serverConfig.BACKEND_USER_AGENT || ''
                        },
                        agent: httpsAgent
                    });

                    if (remoteResponse.ok) {
                        const contentLengthHeader = remoteResponse.headers.get('content-length');
                        totalSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

                        if (args.outputPath) {
                            const absolutePath = path.resolve(args.outputPath);
                            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
                            const fileStream = fs.createWriteStream(absolutePath);

                            if (!remoteResponse.body) {
                                throw new Error('Remote response body is null');
                            }

                            await new Promise((resolve, reject) => {
                                remoteResponse.body!.pipe(fileStream);
                                remoteResponse.body!.on('error', reject);
                                fileStream.on('finish', resolve);
                                fileStream.on('error', reject);
                            });

                            return {
                                content: [{ type: 'text', text: `Successfully saved content to ${absolutePath} (${totalSize} bytes).` }],
                                structuredContent: {
                                    contentId: args.contentId,
                                    outputPath: absolutePath,
                                    totalSize,
                                    bytesReturned: totalSize,
                                    isTruncated: false
                                }
                            };
                        }

                        // Handle in-memory text with truncation logic
                        const maxMemorySize = args.fullContent ? 10 * 1024 * 1024 : 50 * 1024; // 10MB if fullContent requested, else 50KB preview
                        const fullText = await remoteResponse.text();

                        if (fullText.length > maxMemorySize) {
                            textData = fullText.substring(0, maxMemorySize);
                            isTruncated = true;
                        } else {
                            textData = fullText;
                        }
                        totalSize = fullText.length;
                    } else {
                        const errText = await remoteResponse.text();
                        console.error(`[getContent] Remote fetch failed: ${remoteResponse.status}. Body: ${errText.substring(0, 200)}`);
                    }
                } else {
                    // Truncate based on memory limit
                    const maxMemorySize = args.fullContent ? 10 * 1024 * 1024 : 50 * 1024;
                    if (textData.length > maxMemorySize) {
                        textData = textData.substring(0, maxMemorySize);
                        isTruncated = true;
                    }
                }

                if (!textData && !args.outputPath) {
                    return {
                        content: [{ type: 'text', text: `No text content found for contentId: ${args.contentId} (Type: ${dataResourceTypeId})` }],
                        isError: true
                    };
                }

                const result = {
                    contentId: args.contentId,
                    dataResourceId: dataResourceId,
                    textData: textData || undefined,
                    mimeType: contentRecord.mimeTypeId || undefined,
                    totalSize,
                    bytesReturned: textData ? textData.length : 0,
                    isTruncated
                };

                const displayPrefix = isTruncated ? `Preview (Truncated at ${textData.length} chars):\n` : '';
                return {
                    content: [{ type: 'text', text: displayPrefix + textData }],
                    structuredContent: result
                };

            } catch (error) {
                console.error('Error in getContent:', error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                        }
                    ],
                    isError: true
                };
            }
        }
    };
}
