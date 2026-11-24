//go:build windows

package service

// clearBatteryConditions clears the logon task's AC-power conditions, so
// it starts at logon even when the laptop is on battery. It runs the
// PowerShell script from taskpower.go against the existing task.
func clearBatteryConditions() error {
	return run("powershell", "-NoProfile", "-NonInteractive", "-Command", batteryFixScript)
}
