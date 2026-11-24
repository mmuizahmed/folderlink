package service

import (
	"errors"
	"runtime"
	"strings"
	"testing"
)

// taskXML renders a schtasks /query /xml dump with the given power
// settings, in the shape schtasks actually emits (UTF-16 declaration,
// default namespace, Settings block).
func taskXML(disallow, stop string) string {
	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>muiz</Author>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>` + disallow + `</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>` + stop + `</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"C:\Users\muiz\AppData\Local\FolderLink\folderlink-bg.exe"</Command>
      <Arguments>run</Arguments>
    </Exec>
  </Actions>
</Task>
`
}

func TestBatteryConditionsBlocked(t *testing.T) {
	cases := []struct {
		name    string
		xml     string
		blocked bool
		wantErr bool
	}{
		{"both on (the shipped default)", taskXML("true", "true"), true, false},
		{"only no-start-on-batteries", taskXML("true", "false"), true, false},
		{"only stop-on-batteries", taskXML("false", "true"), true, false},
		{"both cleared", taskXML("false", "false"), false, false},
		{"empty output", "", false, true},
		{"not a task definition", "<html>nope</html>", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blocked, err := batteryConditionsBlocked(tc.xml)
			if tc.wantErr && err == nil {
				t.Fatalf("batteryConditionsBlocked = %v, nil error; want an error", blocked)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("batteryConditionsBlocked: %v", err)
			}
			if blocked != tc.blocked {
				t.Fatalf("batteryConditionsBlocked = %v, want %v", blocked, tc.blocked)
			}
		})
	}
}

func TestBatteryFixScript(t *testing.T) {
	for _, want := range []string{
		"Get-ScheduledTask -TaskName 'FolderLink'",
		"DisallowStartIfOnBatteries = $false",
		"StopIfGoingOnBatteries = $false",
		"Set-ScheduledTask -TaskName 'FolderLink' -Settings $t.Settings",
	} {
		if !strings.Contains(batteryFixScript, want) {
			t.Errorf("batteryFixScript is missing %q:\n%s", want, batteryFixScript)
		}
	}
}

func TestCheckLogonPowerXML(t *testing.T) {
	if got := checkLogonPowerXML(taskXML("true", "true"), nil); got.Status != CheckFail || !strings.Contains(got.Detail, "doctor --fix") {
		t.Errorf("blocked task = %s %q, want FAIL pointing at doctor --fix", got.Status, got.Detail)
	}
	if got := checkLogonPowerXML(taskXML("false", "false"), nil); got.Status != CheckOK {
		t.Errorf("cleared task = %s %q, want ok", got.Status, got.Detail)
	}
	if got := checkLogonPowerXML("", errors.New("exit status 1")); got.Status != CheckFail {
		t.Errorf("query error = %s %q, want FAIL", got.Status, got.Detail)
	}
	if got := checkLogonPowerXML("garbage", nil); got.Status != CheckFail {
		t.Errorf("garbage xml = %s %q, want FAIL", got.Status, got.Detail)
	}
}

func TestCheckLogonPowerSkips(t *testing.T) {
	if got := checkLogonPower(false); got.Status != CheckSkip {
		t.Errorf("not installed = %s, want skip", got.Status)
	}
	// Off Windows there is no such condition to check. On Windows the
	// check reads the real task, so it is not asserted here.
	if runtime.GOOS != "windows" {
		if got := checkLogonPower(true); got.Status != CheckSkip {
			t.Errorf("installed on non-Windows = %s, want skip", got.Status)
		}
	}
}

func TestRepairLogonPowerNonWindows(t *testing.T) {
	if err := RepairLogonPower(); err == nil || !strings.Contains(err.Error(), "Windows-only") {
		t.Errorf("RepairLogonPower() = %v, want a Windows-only error", err)
	}
}
