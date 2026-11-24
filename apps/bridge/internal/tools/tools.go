// Package tools runs the read-only operations requested over the websocket.
package tools

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/config"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/guard"
	"github.com/mmuizahmed/mcp-bridge/apps/bridge/internal/pick"
)

type request struct {
	Op          string   `json:"op"`
	FolderID    string   `json:"folderId"`
	Path        string   `json:"path"`
	Label       string   `json:"label"`
	Name        string   `json:"name"`
	Limit       int      `json:"limit"`
	Cursor      string   `json:"cursor"`
	StartLine   int      `json:"startLine"`
	EndLine     int      `json:"endLine"`
	ByteOffset  int64    `json:"byteOffset"`
	MaxBytes    int      `json:"maxBytes"`
	Query       string   `json:"query"`
	MaxMatches  int      `json:"maxMatches"`
	Content     string   `json:"content"`
	Encoding    string   `json:"encoding"`
	ApprovalID  string   `json:"approvalId"`
	Command     string   `json:"command"`
	Args        []string `json:"args"`
	ExecutionID string   `json:"executionId"`
	RequestID   string   `json:"requestId"`
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
func Dispatch(ctx context.Context, store *config.Store, deps Deps, raw json.RawMessage) any {
	var req request
	if len(raw) == 0 || json.Unmarshal(raw, &req) != nil || req.Op == "" {
		return fail("bad_request", "The request is not valid.")
	}
	switch req.Op {
	case "pick_folder":
		return pickFolder(ctx, store)
	case "approve_request":
		return approveRequest(deps, req)
	case "deny_request":
		return denyRequest(deps, req)
	case "exec_poll":
		return execPoll(deps, req)
	case "rename_folder":
		if err := store.Rename(req.FolderID, req.Label); err != nil {
			return fail("bad_request", err.Error())
		}
		return success{OK: true, Result: map[string]string{"id": req.FolderID, "label": req.Label}}
	case "remove_folder":
		if err := store.Remove(req.FolderID); err != nil {
			return fail("bad_request", err.Error())
		}
		return success{OK: true, Result: map[string]string{"id": req.FolderID}}
	case "rename_device":
		if err := store.SetName(req.Name); err != nil {
			return fail("bad_request", err.Error())
		}
		return success{OK: true, Result: map[string]string{"name": req.Name}}
	case "list_folders":
		cfg, err := store.Load()
		if err != nil {
			return fail("internal", "The local configuration could not be read.")
		}
		folders := make([]map[string]string, 0, len(cfg.Folders))
		for _, folder := range cfg.Folders {
			folders = append(folders, map[string]string{"id": folder.ID, "label": folder.Label})
		}
		return success{OK: true, Result: map[string]any{"folders": folders}}
	}
	if req.FolderID == "" {
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
	case "search_files":
		result, err := guard.Search(ctx, folder.Path, req.Path, req.Query, req.MaxMatches)
		if err != nil {
			return fromErr(err)
		}
		return success{OK: true, Result: result}
	case "read_media":
		result, err := guard.Media(ctx, folder.Path, req.Path, req.MaxBytes)
		if err != nil {
			return fromErr(err)
		}
		return success{OK: true, Result: result}
	case "file_info":
		result, err := guard.Info(ctx, folder.Path, req.Path)
		if err != nil {
			return fromErr(err)
		}
		return success{OK: true, Result: result}
	case "write_file":
		return writeFile(ctx, store, deps, folder, req)
	case "delete_file":
		return deleteFile(ctx, deps, folder, req)
	case "run_command":
		return runCommand(ctx, deps, folder, req)
	default:
		return fail("bad_request", "The operation is not supported.")
	}
}

func pickFolder(ctx context.Context, store *config.Store) any {
	path, err := pick.Open(ctx)
	if err != nil {
		if errors.Is(err, pick.ErrCanceled) {
			return fail("canceled", "No folder was selected.")
		}
		return fail("unavailable", "The folder picker could not be opened.")
	}
	folder, err := store.Allow(path, "")
	if err != nil {
		return fail("bad_request", err.Error())
	}
	if folder.Label == "" {
		folder.Label = filepath.Base(folder.Path)
	}
	return success{OK: true, Result: map[string]string{"id": folder.ID, "label": folder.Label}}
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
