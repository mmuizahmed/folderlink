import type { ToolResult } from "@mcp-bridge/shared";

export interface InvokeRequest {
  op:
    | "list_files"
    | "read_file"
    | "pick_folder"
    | "rename_folder"
    | "remove_folder"
    | "rename_device";
  folderId?: string;
  path?: string;
  label?: string;
  name?: string;
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
