import * as fs from 'fs';
import * as path from 'path';

import type { ServerConfig, ToolDefinition } from '../config/types.js';

/**
 * Loads tool definitions from a directory
 */
export async function loadTools(
  serverConfig: ServerConfig,
  toolsFolderPath: string
): Promise<ToolDefinition[]> {
  const toolsDir = path.resolve(process.cwd(), toolsFolderPath);

  if (!fs.existsSync(toolsDir)) {
    console.warn(`Tools directory not found: ${toolsDir}`);
    return [];
  }

  const tools: ToolDefinition[] = [];
  const toolFiles = fs.readdirSync(toolsDir).filter((file) => file.endsWith('.js'));

  for (const file of toolFiles) {
    try {
      const toolPath = path.join(toolsDir, file);
      const toolModule = await import(toolPath);

      // Each tool file should export a default function that returns tool definitions
      if (typeof toolModule.default === 'function') {
        const toolDefs = await toolModule.default(serverConfig);
        if (Array.isArray(toolDefs)) {
          tools.push(...toolDefs);
        } else {
          tools.push(toolDefs);
        }
      }
    } catch (error) {
      console.error(`Error loading tool file ${file}:`, error);
    }
  }

  return tools;
}
