// Package browser opens a URL in the desktop browser.
package browser

import (
	"net/url"
	"os/exec"
	"runtime"
	"strings"
)

// Open is replaced in tests so a pairing run does not launch a browser.
var Open = open

// PairPage is the control-panel address that already contains the pairing code.
func PairPage(web, code string) (string, error) {
	base, err := url.Parse(strings.TrimRight(web, "/") + "/pair")
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", err
	}
	query := base.Query()
	query.Set("code", code)
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func open(raw string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", raw)
	case "darwin":
		cmd = exec.Command("open", raw)
	default:
		cmd = exec.Command("xdg-open", raw)
	}
	return cmd.Start()
}
