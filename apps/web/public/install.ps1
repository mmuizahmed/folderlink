# FolderLink installer for Windows. No administrator rights.
$ErrorActionPreference = "Stop"

$Repo = "mmuizahmed/mcp-bridge"
$Asset = "folderlink_windows_amd64.zip"
$Root = Join-Path $env:LOCALAPPDATA "FolderLink"
$Tmp = Join-Path $env:TEMP "folderlink-install"
New-Item -ItemType Directory -Force -Path $Root, $Tmp | Out-Null

$Base = "https://github.com/$Repo/releases/latest/download"
Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile (Join-Path $Tmp "checksums.txt")
Invoke-WebRequest -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)

$line = Get-Content (Join-Path $Tmp "checksums.txt") | Where-Object { $_ -like "*$Asset" } | Select-Object -First 1
if (-not $line) { throw "checksums.txt has no entry for $Asset" }
$expected = ($line -split "\s+")[0].ToLower()
$actual = (Get-FileHash (Join-Path $Tmp $Asset) -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "checksum mismatch for $Asset" }

Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Root -Force
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

$Wsh = New-Object -ComObject WScript.Shell
foreach ($dir in @(
  [Environment]::GetFolderPath("Startup"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
)) {
  $shortcut = $Wsh.CreateShortcut((Join-Path $dir "FolderLink.lnk"))
  $shortcut.TargetPath = $Exe
  $shortcut.WorkingDirectory = $Root
  $shortcut.Save()
}

Write-Host "FolderLink is installed. Opening it to connect this computer."
Start-Process -FilePath $Exe
