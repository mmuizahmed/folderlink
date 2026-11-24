//go:build !windows

package service

// clearBatteryConditions is a no-op off Windows: only the Windows logon
// task has these power conditions.
func clearBatteryConditions() error {
	return nil
}
