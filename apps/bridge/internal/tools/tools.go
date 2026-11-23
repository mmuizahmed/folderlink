// Package tools runs the read-only operations requested over the websocket.
package tools

import (
	"context"
	"encoding/json"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/guard"
)

type request struct {
	Op         string `json:"op"`
	FolderID   string `json:"folderId"`
	Path       string `json:"path"`
	Limit      int    `json:"limit"`
	Cursor     string `json:"cursor"`
	StartLine  int    `json:"startLine"`
	EndLine    int    `json:"endLine"`
	ByteOffset int64  `json:"byteOffset"`
	MaxBytes   int    `json:"maxBytes"`
}

type failure struct {
	OK    bool `json:"ok"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type success struct {
	OK     bool `json:"ok"`
	Result any  `json:"result"`
}

// Dispatch executes one tool request against the folders stored on this computer.
func Dispatch(ctx context.Context, store *config.Store, raw json.RawMessage) any {
	var req request
	if len(raw) == 0 || json.Unmarshal(raw, &req) != nil || req.Op == "" || req.FolderID == "" {
		return fail("bad_request", "The request is not valid.")
	}
	cfg, err := store.Load()
	if err != nil {
		return fail("internal", "The local configuration could not be read.")
	}
	var folder *config.Folder
	for i := range cfg.Folders {
		if cfg.Folders[i].ID == req.FolderID {
			folder = &cfg.Folders[i]
			break
		}
	}
	if folder == nil {
		return fail("denied", "That folder is not allowed on this device.")
	}
	switch req.Op {
	case "list_files":
		result, err := guard.List(ctx, folder.Path, req.Path, req.Cursor, req.Limit)
		if err != nil {
			return fromErr(err)
		}
		return success{OK: true, Result: result}
	case "read_file":
		result, err := guard.Read(ctx, folder.Path, req.Path, guard.ReadRequest{
			StartLine:  req.StartLine,
			EndLine:    req.EndLine,
			ByteOffset: req.ByteOffset,
			MaxBytes:   req.MaxBytes,
		})
		if err != nil {
			return fromErr(err)
		}
		return success{OK: true, Result: result}
	default:
		return fail("bad_request", "The operation is not supported.")
	}
}

func fromErr(err error) failure {
	code := guard.CodeOf(err)
	msg := "The request could not be completed."
	if code != "internal" {
		msg = err.Error()
	}
	return fail(code, msg)
}

func fail(codeName, message string) failure {
	var out failure
	out.Error.Code = codeName
	out.Error.Message = message
	return out
}
