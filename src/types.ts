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
