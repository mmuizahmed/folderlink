import type { ToolResult } from "@mcp-bridge/shared";

export interface InvokeRequest {
  op: "list_files" | "read_file";
  folderId: string;
  path: string;
  limit?: number;
  cursor?: string;
  startLine?: number;
  endLine?: number;
  byteOffset?: number;
  maxBytes?: number;
}

export interface DeviceControl {
  invoke(input: InvokeRequest): Promise<ToolResult>;
  disconnect(): Promise<void>;
  presence(): Promise<{ connected: boolean }>;
}
