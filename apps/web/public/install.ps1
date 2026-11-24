# FolderLink installer for Windows. No administrator rights.
$ErrorActionPreference = "Stop"

$Repo = "mmuizahmed/mcp-bridge"
$Asset = "folderlink_windows_amd64.zip"
$BgAsset = "folderlink-bg_windows_amd64.zip"
$Root = Join-Path $env:LOCALAPPDATA "FolderLink"
$Tmp = Join-Path $env:TEMP "folderlink-install"
New-Item -ItemType Directory -Force -Path $Root, $Tmp | Out-Null

$Base = "https://github.com/$Repo/releases/latest/download"
Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Tmp "checksums.txt")
foreach ($Name in @($Asset, $BgAsset)) {
  Invoke-WebRequest -Uri "$Base/$Name" -OutFile (Join-Path $Tmp $Name)
  $line = Get-Content (Join-Path $Tmp "checksums.txt") | Where-Object { $_ -like "*$Name" } | Select-Object -First 1
  if (-not $line) { throw "checksums.txt has no entry for $Name" }
  $expected = ($line -split "\s+")[0].ToLower()
  $actual = (Get-FileHash (Join-Path $Tmp $Name) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { throw "checksum mismatch for $Name" }
}

# Stop the running bridge before overwriting it. Windows locks a running
# .exe, so on an upgrade Expand-Archive cannot replace folderlink-bg.exe
# while the tray/background process is still alive. The install step at
# the end starts the new build again.
foreach ($Name in @("folderlink-bg", "folderlink")) {
  Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 20 -and (Get-Process -Name $Name -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 500
  }
}

Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Root -Force
Expand-Archive -Path (Join-Path $Tmp $BgAsset) -DestinationPath $Root -Force
$Exe = Join-Path $Root "folderlink.exe"
if (-not (Test-Path $Exe)) {
  $found = Get-ChildItem -Path $Root -Filter "folderlink.exe" -Recurse | Select-Object -First 1
  if (-not $found) { throw "folderlink.exe was not in the archive" }
  $Exe = $found.FullName
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$Root*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$Root", "User")
}

# No Startup shortcut: the background install below registers a scheduled
# task at logon instead. A shortcut to folderlink.exe would open a terminal
# window, and closing it would kill the connection.
& $Exe install
Write-Host "FolderLink is installed and running in the background. Look for the FolderLink icon in the system tray."
