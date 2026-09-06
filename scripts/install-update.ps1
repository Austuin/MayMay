[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [Parameter(Mandatory = $true)]
  [int]$ParentProcessId,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDriveRoot = [IO.Path]::GetPathRoot($resolvedInstallRoot)
$updateDirectory = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($resolvedPackage))
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$logPath = Join-Path $env:LOCALAPPDATA 'MayMay-update.log'

function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

if ($resolvedInstallRoot -eq $installDriveRoot) {
  throw 'Refusing to update an installation at the root of a drive.'
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -PathType Leaf)) {
  throw 'The selected MayMay installation is incomplete.'
}
if (-not $updateDirectory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not [IO.Path]::GetFileName($updateDirectory).StartsWith('MayMay-Update-', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The update package is not in a trusted MayMay temporary folder.'
}

try {
  Write-UpdateLog 'Waiting for the MayMay Host to close.'
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    if (-not (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    throw 'The MayMay Host did not close in time.'
  }

  $expandedInstaller = Join-Path $updateDirectory 'installer'
  New-Item -ItemType Directory -Path $expandedInstaller -Force | Out-Null
  Expand-Archive -LiteralPath $resolvedPackage -DestinationPath $expandedInstaller -Force
  $installerScript = Join-Path $expandedInstaller 'Install-MayMay.ps1'
  if (-not (Test-Path -LiteralPath $installerScript -PathType Leaf)) {
    throw 'The downloaded package does not contain the MayMay installer.'
  }

  Write-UpdateLog 'Installing the verified update.'
  & $installerScript -InstallRoot $resolvedInstallRoot -Quiet -NoLaunch -NoKeyDiscovery -NoShortcuts
  Write-UpdateLog 'Update installed.'
  if (-not $NoRestart) {
    Write-UpdateLog 'Restarting MayMay.'
    Start-Process -FilePath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -WorkingDirectory $resolvedInstallRoot
  }
} catch {
  Write-UpdateLog "Update failed: $($_.Exception.Message)"
  if (-not $NoRestart -and (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -PathType Leaf)) {
    Start-Process -FilePath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -WorkingDirectory $resolvedInstallRoot
  }
  exit 1
} finally {
  if ($updateDirectory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($updateDirectory).StartsWith('MayMay-Update-', [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $updateDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
