import type { ToolResult } from "@folderlink/shared";

export interface InvokeRequest {
  op:
    | "list_files"
    | "read_file"
    | "search_files"
    | "read_media"
    | "file_info"
    | "list_folders"
    | "pick_folder"
    | "rename_folder"
    | "remove_folder"
    | "rename_device"
    | "write_file"
    | "delete_file"
    | "run_command"
    | "exec_poll"
    | "approve_request"
    | "deny_request";
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
  query?: string;
  maxMatches?: number;
  // Write/exec fields. content is the file bytes (utf8 text, or base64
  // when encoding is "base64"). approvalId is the dashboard approval
  // request id, carried on the second call of a two-turn flow.
  content?: string;
  encoding?: string;
  approvalId?: string;
  command?: string;
  args?: string[];
  executionId?: string;
  requestId?: string;
}

export interface DeviceControl {
  invoke(input: InvokeRequest): Promise<ToolResult>;
  disconnect(): Promise<void>;
  presence(): Promise<{ connected: boolean }>;
  pushSettings(settings: { writeApprovalMode: string }): Promise<void>;
}
