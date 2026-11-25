package tools

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/mmuizahmed/folderlink/apps/bridge/internal/approve"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/config"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/execrun"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/guard"
	"github.com/mmuizahmed/folderlink/apps/bridge/internal/mode"
)

// Deps are the optional write/exec collaborators. A nil Approve store or
// nil Exec registry disables the write/exec tools entirely: Dispatch
// fails them with "unavailable" instead of running them. The client
// always supplies both; a bridge built without them cannot write.
type Deps struct {
	Approve *approve.Store
	Exec    *execrun.Registry
	// Mode is the write approval mode the bridge enforces. A nil store
	// fails closed to manual approval.
	Mode *mode.Store
	// DashboardURL is the public dashboard base (https://folderlink.muiz.pk).
	// The approval_required result links the user to the request there.
	DashboardURL string
}

// approvalRequiredResult is the in-band answer a dashboard-gated
// operation returns on its first call: no waiting, no blocking — the AI
// tells the user, the user approves in the dashboard, and the AI calls
// again with approval_id. It matches the shared protocol's
// ApprovalRequiredResult; the worker fills dashboard_url from its own
// environment when the bridge leaves it blank.
type approvalRequiredResult struct {
	Status       string   `json:"status"`
	RequestID    string   `json:"requestId"`
	Operation    string   `json:"operation"`
	Folder       string   `json:"folder"`
	Path         string   `json:"path"`
	DashboardURL string   `json:"dashboardUrl"`
	ExpiresIn    int      `json:"expiresIn"`
	Message      string   `json:"message"`
	ContentHash  string   `json:"contentHash"`
	PreHash      string   `json:"preHash"`
	Diff         string   `json:"diff"`
	Preview      string   `json:"preview"`
	Size         int64    `json:"size"`
	Argv         []string `json:"argv"`
}

func writeFile(ctx context.Context, store *config.Store, deps Deps, folder *config.Folder, req request) any {
	if deps.Approve == nil {
		return fail("unavailable", "Writing files is not available on this bridge.")
	}
	content, err := decodeContent(req.Content, req.Encoding)
	if err != nil {
		return fail("bad_request", err.Error())
	}
	plan, err := guard.PrepareWrite(ctx, folder.Path, req.Path, content)
	if err != nil {
		return fromErr(err)
	}
	if req.ApprovalID != "" {
		// Second call: verify the token against the live plan,
		// whatever the tier is now. If the content changed between
		// the two calls (binary to text, or different bytes), the
		// hash binding fails — which is the safe answer.
		ok, reason := deps.Approve.Verify(req.ApprovalID, approve.Binding{
			Op:          approve.OpWriteFile,
			FolderID:    folder.ID,
			Path:        plan.Rel,
			ContentHash: plan.ContentHash,
			PreHash:     plan.PreHash,
		})
		if !ok {
			return approvalFailure(deps, req.ApprovalID, reason)
		}
		return executeWrite(ctx, folder, plan, content)
	}
	// Every write needs a dashboard approval, whatever the file is and
	// whatever the mode is: no write lands on a client card alone. The
	// mode still gates commands and shows in the tray, but it no longer
	// lets a write through. The second call (with approval_id) verifies
	// the token against the live plan above and only then executes.
	pending := deps.Approve.Create(&approve.Pending{
		Op:          approve.OpWriteFile,
		FolderID:    folder.ID,
		FolderLabel: folder.Label,
		Path:        plan.Rel,
		ContentHash: plan.ContentHash,
		PreHash:     plan.PreHash,
		Diff:        plan.Diff,
	})
	return approvalRequired(deps, pending)
}

func executeWrite(ctx context.Context, folder *config.Folder, plan *guard.WritePlan, content []byte) any {
	postHash, err := guard.ExecuteWrite(ctx, folder.Path, plan, content)
	if err != nil {
		return fromErr(err)
	}
	return success{OK: true, Result: map[string]any{
		"preHash":  plan.PreHash,
		"postHash": postHash,
		"bytes":    len(content),
	}}
}

func deleteFile(ctx context.Context, deps Deps, folder *config.Folder, req request) any {
	if deps.Approve == nil {
		return fail("unavailable", "Deleting files is not available on this bridge.")
	}
	preview, err := guard.PrepareDelete(ctx, folder.Path, req.Path)
	if err != nil {
		return fromErr(err)
	}
	if req.ApprovalID == "" {
		pending := deps.Approve.Create(&approve.Pending{
			Op:          approve.OpDeleteFile,
			FolderID:    folder.ID,
			FolderLabel: folder.Label,
			Path:        preview.Rel,
			ContentHash: preview.PreHash,
			PreHash:     preview.PreHash,
			Preview:     preview.Preview,
			Size:        preview.Size,
		})
		return approvalRequired(deps, pending)
	}
	ok, reason := deps.Approve.Verify(req.ApprovalID, approve.Binding{
		Op:          approve.OpDeleteFile,
		FolderID:    folder.ID,
		Path:        preview.Rel,
		ContentHash: preview.PreHash,
		PreHash:     preview.PreHash,
	})
	if !ok {
		return approvalFailure(deps, req.ApprovalID, reason)
	}
	if err := guard.ExecuteDelete(ctx, folder.Path, preview); err != nil {
		return fromErr(err)
	}
	return success{OK: true, Result: map[string]any{"deleted": preview.Rel}}
}

func runCommand(ctx context.Context, deps Deps, folder *config.Folder, req request) any {
	if deps.Approve == nil || deps.Exec == nil {
		return fail("unavailable", "Running commands is not available on this bridge.")
	}
	argv := append([]string{req.Command}, req.Args...)
	if err := execrun.Validate(argv); err != nil {
		return fail("bad_request", err.Error())
	}
	if req.ApprovalID == "" {
		pending := deps.Approve.Create(&approve.Pending{
			Op:          approve.OpRunCommand,
			FolderID:    folder.ID,
			FolderLabel: folder.Label,
			Argv:        argv,
			ArgvHash:    execrun.ArgvHash(argv),
		})
		return approvalRequired(deps, pending)
	}
	ok, reason := deps.Approve.Verify(req.ApprovalID, approve.Binding{
		Op:       approve.OpRunCommand,
		FolderID: folder.ID,
		ArgvHash: execrun.ArgvHash(argv),
	})
	if !ok {
		return approvalFailure(deps, req.ApprovalID, reason)
	}
	id, err := deps.Exec.Start(folder.Path, argv)
	if err != nil {
		return fail("internal", "The command could not be started.")
	}
	return success{OK: true, Result: map[string]any{
		"status":      "started",
		"executionId": id,
	}}
}

func execPoll(deps Deps, req request) any {
	if deps.Exec == nil {
		return fail("unavailable", "Running commands is not available on this bridge.")
	}
	if req.ExecutionID == "" {
		return fail("bad_request", "The request is not valid.")
	}
	res, ok := deps.Exec.Poll(req.ExecutionID)
	if !ok {
		return fail("not_found", "That command run does not exist or has expired.")
	}
	return success{OK: true, Result: map[string]any{
		"status":    res.Status,
		"exitCode":  res.ExitCode,
		"stdout":    res.Stdout,
		"stderr":    res.Stderr,
		"truncated": res.Truncated,
	}}
}

func approveRequest(deps Deps, req request) any {
	if deps.Approve == nil {
		return fail("unavailable", "Approvals are not available on this bridge.")
	}
	if req.RequestID == "" {
		return fail("bad_request", "The request is not valid.")
	}
	if !deps.Approve.Approve(req.RequestID) {
		return fail("approval_expired", "That approval request has expired or was already decided.")
	}
	return success{OK: true, Result: map[string]any{
		"approved":  true,
		"requestId": req.RequestID,
	}}
}

func denyRequest(deps Deps, req request) any {
	if deps.Approve == nil {
		return fail("unavailable", "Approvals are not available on this bridge.")
	}
	if req.RequestID == "" {
		return fail("bad_request", "The request is not valid.")
	}
	if !deps.Approve.Deny(req.RequestID) {
		return fail("approval_expired", "That approval request has expired or was already decided.")
	}
	return success{OK: true, Result: map[string]any{
		"denied":    true,
		"requestId": req.RequestID,
	}}
}

// approvalFailure translates a token verification failure into the
// result the AI sees. A missing token with a still-pending request means
// the user has not approved yet: return approval_required, not an error,
// so the AI waits instead of giving up.
func approvalFailure(deps Deps, approvalID, reason string) any {
	switch reason {
	case "no_token":
		if pending := deps.Approve.Get(approvalID); pending != nil {
			return approvalRequired(deps, pending)
		}
		return fail("approval_denied", "That approval was denied, or it expired.")
	case "approval_expired":
		return fail("approval_expired", "That approval expired. Ask for a new one.")
	default: // hash_mismatch
		return fail("hash_mismatch", "The file changed after approval. Ask for a new approval.")
	}
}

// approvalRequired builds the in-band result from a pending request. The
// dashboard URL is filled from the configured web base; the worker
// overwrites it from its own environment when set. In manual mode a
// plain write says so, so the user understands why even a text write
// needs their approval.
func approvalRequired(deps Deps, pending *approve.Pending) any {
	dashboardURL := ""
	if deps.DashboardURL != "" {
		dashboardURL = strings.TrimSuffix(deps.DashboardURL, "/") + "/dashboard#approvals/" + pending.ID
	}
	manual := pending.Op == approve.OpWriteFile &&
		(deps.Mode == nil || deps.Mode.Get() == mode.ModeManual)
	prefix := ""
	if manual {
		prefix = "Manual approval is on. "
	}
	message := fmt.Sprintf(
		"%sThis %s needs approval in the FolderLink dashboard before it can run. "+
			"Tell the user to open %s, review it, and approve it — then call %s again with approval_id %q.",
		prefix, pending.Op, dashboardURL, pending.Op, pending.ID)
	if dashboardURL == "" {
		message = fmt.Sprintf(
			"%sThis %s needs approval in the FolderLink dashboard before it can run. "+
				"Tell the user to open the dashboard, review it, and approve it — then call %s again with approval_id %q.",
			prefix, pending.Op, pending.Op, pending.ID)
	}
	return success{OK: true, Result: approvalRequiredResult{
		Status:       "approval_required",
		RequestID:    pending.ID,
		Operation:    string(pending.Op),
		Folder:       pending.FolderLabel,
		Path:         pending.Path,
		DashboardURL: dashboardURL,
		ExpiresIn:    int(time.Until(pending.ExpiresAt).Seconds()),
		Message:      message,
		ContentHash:  pending.ContentHash,
		PreHash:      pending.PreHash,
		Diff:         pending.Diff,
		Preview:      pending.Preview,
		Size:         pending.Size,
		Argv:         pending.Argv,
	}}
}

// decodeContent decodes a write payload. utf8 is the default; base64 is
// for binary writes. The decoded bytes are capped at MaxWriteBytes.
func decodeContent(content, encoding string) ([]byte, error) {
	var raw []byte
	var err error
	switch encoding {
	case "", "utf8":
		raw = []byte(content)
	case "base64":
		raw, err = base64.StdEncoding.DecodeString(content)
		if err != nil {
			return nil, fmt.Errorf("the base64 content is not valid")
		}
	default:
		return nil, fmt.Errorf("unknown encoding %q", encoding)
	}
	if len(raw) > guard.MaxWriteBytes {
		return nil, fmt.Errorf("the content is too large (max %d bytes)", guard.MaxWriteBytes)
	}
	return raw, nil
}
