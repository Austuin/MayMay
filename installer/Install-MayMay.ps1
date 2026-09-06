[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'MayMay'),
  [string]$FirebaseKeyPath,
  [switch]$Quiet,
  [switch]$NoLaunch,
  [switch]$NoKeyDiscovery,
  [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$projectId = 'maymaydata-a6fda'
$payloadPath = Join-Path $PSScriptRoot 'MayMay-Payload.zip'
$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDriveRoot = [IO.Path]::GetPathRoot($resolvedInstallRoot)

if ($resolvedInstallRoot -eq $installDriveRoot) {
  throw 'MayMay cannot be installed directly to the root of a drive.'
}
if (-not (Test-Path -LiteralPath $payloadPath -PathType Leaf)) {
  throw 'MayMay-Payload.zip is missing. Keep all installer files together.'
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'This MayMay installer requires 64-bit Windows.'
}

Write-Host ''
Write-Host 'MayMay Offline Installer' -ForegroundColor Cyan
Write-Host 'Installing the local host application without downloading anything...' -ForegroundColor Cyan

New-Item -ItemType Directory -Path $resolvedInstallRoot -Force | Out-Null
Expand-Archive -LiteralPath $payloadPath -DestinationPath $resolvedInstallRoot -Force
New-Item -ItemType Directory -Path (Join-Path $resolvedInstallRoot 'app\public') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $resolvedInstallRoot 'app\config') -Force | Out-Null

$selectedKey = $null
if (-not $NoKeyDiscovery) {
  $keyCandidates = @()
  if ($FirebaseKeyPath) {
    $keyCandidates += Get-Item -LiteralPath $FirebaseKeyPath -ErrorAction Stop
  }
  $installerKey = Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "$projectId-firebase-adminsdk-*.json" -ErrorAction SilentlyContinue
  $downloadsPath = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
  $downloadsKey = Get-ChildItem -LiteralPath $downloadsPath -File -Filter "$projectId-firebase-adminsdk-*.json" -ErrorAction SilentlyContinue
  $keyCandidates += @($installerKey) + @($downloadsKey)
  $selectedKey = $keyCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if ($selectedKey) {
  & (Join-Path $resolvedInstallRoot 'Set-Firebase-Key.ps1') -KeyPath $selectedKey.FullName -Quiet
}

if (-not $NoShortcuts) {
  $shortcutShell = New-Object -ComObject WScript.Shell
  $desktopShortcut = $shortcutShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'MayMay.lnk'))
  $desktopShortcut.TargetPath = Join-Path $resolvedInstallRoot 'Start-MayMay.cmd'
  $desktopShortcut.WorkingDirectory = $resolvedInstallRoot
  $desktopShortcut.Description = 'Start the MayMay local care tracker'
  $desktopShortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,67"
  $desktopShortcut.Save()

  $startMenuDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $startMenuShortcut = $shortcutShell.CreateShortcut((Join-Path $startMenuDirectory 'MayMay.lnk'))
  $startMenuShortcut.TargetPath = Join-Path $resolvedInstallRoot 'Start-MayMay.cmd'
  $startMenuShortcut.WorkingDirectory = $resolvedInstallRoot
  $startMenuShortcut.Description = 'Start the MayMay local care tracker'
  $startMenuShortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,67"
  $startMenuShortcut.Save()
}

$keyInstalled = Test-Path -LiteralPath (Join-Path $resolvedInstallRoot 'app\config\firebase-admin.json')
Write-Host ''
Write-Host "MayMay was installed to $resolvedInstallRoot" -ForegroundColor Green
if (-not $NoShortcuts) {
  Write-Host 'A MayMay shortcut was added to the desktop and Start menu.' -ForegroundColor Green
}
if (-not $keyInstalled) {
  Write-Warning 'The Firebase Admin key was not found. Run "Set up MayMay Firebase key" in the installation folder before starting MayMay.'
}
Write-Host 'When Windows asks about network access, allow Private networks so phones and tablets can connect.' -ForegroundColor Yellow

if (-not $NoLaunch -and $keyInstalled) {
  $startNow = $Quiet
  if (-not $Quiet) {
    $answer = Read-Host 'Start MayMay now? [Y/n]'
    $startNow = $answer -notmatch '^[Nn]'
  }
  if ($startNow) {
    Start-Process -FilePath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -WorkingDirectory $resolvedInstallRoot
  }
}
