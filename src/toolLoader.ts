import * as fs from 'fs';
import * as path from 'path';

export interface ToolDefinition {
  name: string;
  metadata: {
    title: string;
    description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputSchema: Record<string, any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any, request: any) => Promise<any>;
}

export async function loadTools(toolsFolderPath: string): Promise<ToolDefinition[]> {
  const toolsDir = path.resolve(process.cwd(), toolsFolderPath);

  if (!fs.existsSync(toolsDir)) {
    console.warn(`Tools directory not found: ${toolsDir}`);
    return [];
  }

  const tools: ToolDefinition[] = [];
  const toolFiles = fs
    .readdirSync(toolsDir)
    .filter((file) => file.endsWith('.js') || file.endsWith('.ts'));

  for (const file of toolFiles) {
    try {
      const toolPath = path.join(toolsDir, file);
      const toolModule = await import(toolPath);

      // Each tool file should export a default function that returns tool definitions
      if (typeof toolModule.default === 'function') {
        const toolDefs = await toolModule.default();
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
