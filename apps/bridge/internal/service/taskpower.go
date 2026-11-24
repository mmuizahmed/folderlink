package service

import (
	"errors"
	"strings"
)

// The Windows logon task's power conditions, and the fix for them.
//
// schtasks /create leaves the AC-power conditions on by default
// (DisallowStartIfOnBatteries and StopIfGoingOnBatteries are both true),
// so a laptop on battery at logon silently skips the task: the bridge
// never starts, nothing reports it, and the task's Last Run Time simply
// never advances. The task itself is healthy — Ready, Enabled, correct
// command — which is why this looks like a mystery until the power
// settings are checked. schtasks has no flag for these settings, so
// install and doctor --fix clear them through PowerShell (the same route
// pick/native_windows.go already uses).

// batteryFixScript clears both power conditions on the FolderLink logon
// task. Only the settings change: passing -Settings updates just the
// settings block and leaves the task's trigger, principal, and command
// alone.
//
// It must NOT use Set-ScheduledTask -InputObject $t: that round-trips
// the whole task definition, and the Task Scheduler service rejects it
// for a task created by schtasks /create with
// "The parameter is incorrect. (20,8):UserId:" (0x80070057) — the
// principal's UserId does not survive the round-trip. Updating only the
// settings avoids re-registering the principal entirely.
const batteryFixScript = `$t = Get-ScheduledTask -TaskName 'FolderLink'; $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; Set-ScheduledTask -TaskName 'FolderLink' -Settings $t.Settings`

// batteryConditionsBlocked reports whether the task XML says the logon
// task will not start on battery power (DisallowStartIfOnBatteries) or
// will stop when the machine switches to battery (StopIfGoingOnBatteries).
// Either one alone is enough to keep the bridge from starting at a
// battery logon.
//
// The XML is matched as text, not parsed: schtasks /xml declares UTF-16
// while the bytes arrive in the console code page, so a real XML parser
// chokes on the declaration. The element spellings are fixed
// machine-generated output from schtasks, and pointsAtInstallDir already
// reads the same dump this way.
func batteryConditionsBlocked(taskXML string) (bool, error) {
	if !strings.Contains(taskXML, "<Settings>") {
		return false, errors.New("not a task definition")
	}
	return strings.Contains(taskXML, "<DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>") ||
		strings.Contains(taskXML, "<StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>"), nil
}
