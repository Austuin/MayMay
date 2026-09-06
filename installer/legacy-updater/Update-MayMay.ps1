[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'MayMay'),
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$repository = 'Austuin/MayMay'
$releaseApi = "https://api.github.com/repos/$repository/releases/latest"
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$workingDirectory = [IO.Path]::GetFullPath((Join-Path $temporaryRoot "MayMay-Legacy-Update-$PID"))
$logPath = Join-Path $env:LOCALAPPDATA 'MayMay-legacy-update.log'
$firebaseBackup = Join-Path $workingDirectory 'firebase-admin.json'
$hostStopped = $false
$resolvedInstallRoot = $null

function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

function Write-Step([string]$Message) {
  Write-Host $Message -ForegroundColor Cyan
  Write-UpdateLog $Message
}

function Resolve-MayMayInstall([string]$RequestedRoot) {
  $candidates = @($RequestedRoot)
  $shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MayMay.lnk'),
    (Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs') 'MayMay.lnk')
  )

  foreach ($shortcutPath in $shortcutPaths) {
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { continue }
    try {
      $shortcutShell = New-Object -ComObject WScript.Shell
      $targetPath = $shortcutShell.CreateShortcut($shortcutPath).TargetPath
      if ($targetPath) { $candidates += [IO.Path]::GetDirectoryName($targetPath) }
    } catch {
      Write-UpdateLog "Could not inspect shortcut ${shortcutPath}: $($_.Exception.Message)"
    }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not $candidate) { continue }
    $fullCandidate = [IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath (Join-Path $fullCandidate 'Start-MayMay.cmd') -PathType Leaf) {
      return $fullCandidate
    }
  }

  Write-Host ''
  Write-Host 'MayMay was not found in its usual location.' -ForegroundColor Yellow
  $enteredPath = Read-Host 'Enter the folder containing Start-MayMay.cmd'
  if (-not $enteredPath) { throw 'No MayMay installation folder was selected.' }
  $fullEnteredPath = [IO.Path]::GetFullPath($enteredPath.Trim('"'))
  if (-not (Test-Path -LiteralPath (Join-Path $fullEnteredPath 'Start-MayMay.cmd') -PathType Leaf)) {
    throw "Start-MayMay.cmd was not found in $fullEnteredPath"
  }
  return $fullEnteredPath
}

function Stop-MayMayHost([string]$MayMayRoot) {
  $runtimePath = [IO.Path]::GetFullPath((Join-Path $MayMayRoot 'runtime\node.exe'))
  $hostProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    if (-not $_.ExecutablePath) { return $false }
    try {
      return [IO.Path]::GetFullPath($_.ExecutablePath).Equals($runtimePath, [StringComparison]::OrdinalIgnoreCase)
    } catch {
      return $false
    }
  })

  foreach ($hostProcess in $hostProcesses) {
    Write-Step "Stopping the existing MayMay Host (process $($hostProcess.ProcessId))..."
    Stop-Process -Id $hostProcess.ProcessId -Force -ErrorAction Stop
    Wait-Process -Id $hostProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Path $workingDirectory -Force | Out-Null
  Write-UpdateLog 'Legacy updater started.'

  $resolvedInstallRoot = Resolve-MayMayInstall $InstallRoot
  $installDriveRoot = [IO.Path]::GetPathRoot($resolvedInstallRoot)
  if ($resolvedInstallRoot -eq $installDriveRoot) {
    throw 'MayMay cannot be updated at the root of a drive.'
  }

  Write-Host ''
  Write-Host 'MayMay Legacy Updater' -ForegroundColor Cyan
  Write-Host "Installation: $resolvedInstallRoot" -ForegroundColor Cyan
  Write-Host 'This one-time updater adds the permanent Check for updates command.' -ForegroundColor Cyan
  Write-Host ''

  Write-Step 'Checking GitHub for the newest MayMay release...'
  $headers = @{ 'User-Agent' = 'MayMay-Legacy-Updater'; 'Accept' = 'application/vnd.github+json' }
  $release = Invoke-RestMethod -Uri $releaseApi -Headers $headers -TimeoutSec 30
  if (-not $release.tag_name -or $release.tag_name -notmatch '^v(?<version>\d+\.\d+\.\d+)$') {
    throw 'GitHub did not return a valid MayMay release version.'
  }

  $version = $Matches.version
  $packageName = "MayMay-Offline-Installer-v$version.zip"
  $checksumName = "$packageName.sha256"
  $packageAsset = @($release.assets | Where-Object { $_.name -eq $packageName }) | Select-Object -First 1
  $checksumAsset = @($release.assets | Where-Object { $_.name -eq $checksumName }) | Select-Object -First 1
  if (-not $packageAsset -or -not $checksumAsset) {
    throw "MayMay v$version does not contain the required Windows update files."
  }

  $packagePath = Join-Path $workingDirectory $packageName
  $checksumPath = Join-Path $workingDirectory $checksumName
  Write-Step "Downloading MayMay v$version..."
  Invoke-WebRequest -Uri $packageAsset.browser_download_url -Headers $headers -OutFile $packagePath -UseBasicParsing -TimeoutSec 600
  Invoke-WebRequest -Uri $checksumAsset.browser_download_url -Headers $headers -OutFile $checksumPath -UseBasicParsing -TimeoutSec 60

  $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
  if ($checksumText -notmatch '^(?<hash>[A-Fa-f0-9]{64})\s+') {
    throw 'The downloaded checksum file is invalid.'
  }
  $expectedHash = $Matches.hash.ToUpperInvariant()
  $actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    throw 'The downloaded update did not pass its SHA-256 safety check.'
  }
  Write-Step 'The update download passed its SHA-256 safety check.'

  $expandedInstaller = Join-Path $workingDirectory 'installer'
  New-Item -ItemType Directory -Path $expandedInstaller -Force | Out-Null
  Expand-Archive -LiteralPath $packagePath -DestinationPath $expandedInstaller -Force
  $installerScript = Join-Path $expandedInstaller 'Install-MayMay.ps1'
  if (-not (Test-Path -LiteralPath $installerScript -PathType Leaf)) {
    throw 'The verified update does not contain the MayMay installer.'
  }

  $firebaseKey = Join-Path $resolvedInstallRoot 'app\config\firebase-admin.json'
  if (Test-Path -LiteralPath $firebaseKey -PathType Leaf) {
    Copy-Item -LiteralPath $firebaseKey -Destination $firebaseBackup -Force
    Write-UpdateLog 'The local Firebase key was safeguarded for the update.'
  }

  Stop-MayMayHost $resolvedInstallRoot
  $hostStopped = $true
  Write-Step 'Installing the newest MayMay version...'
  & $installerScript -InstallRoot $resolvedInstallRoot -Quiet -NoLaunch -NoKeyDiscovery -NoShortcuts

  if (Test-Path -LiteralPath $firebaseBackup -PathType Leaf) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $firebaseKey) -Force | Out-Null
    Copy-Item -LiteralPath $firebaseBackup -Destination $firebaseKey -Force
  }

  Write-UpdateLog "MayMay v$version installed successfully."
  Write-Host ''
  Write-Host "MayMay v$version is installed." -ForegroundColor Green
  Write-Host 'Future updates are available from the MayMay Host by typing update.' -ForegroundColor Green

  if (-not $NoRestart) {
    Write-Step 'Restarting MayMay...'
    Start-Process -FilePath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -WorkingDirectory $resolvedInstallRoot
  }
  exit 0
} catch {
  Write-UpdateLog "Legacy update failed: $($_.Exception.Message)"
  if ($resolvedInstallRoot) {
    $firebaseKey = Join-Path $resolvedInstallRoot 'app\config\firebase-admin.json'
    if ((Test-Path -LiteralPath $firebaseBackup -PathType Leaf) -and
        -not (Test-Path -LiteralPath $firebaseKey -PathType Leaf)) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $firebaseKey) -Force | Out-Null
      Copy-Item -LiteralPath $firebaseBackup -Destination $firebaseKey -Force
    }
    if ($hostStopped -and -not $NoRestart -and
        (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -PathType Leaf)) {
      Start-Process -FilePath (Join-Path $resolvedInstallRoot 'Start-MayMay.cmd') -WorkingDirectory $resolvedInstallRoot
    }
  }
  Write-Host ''
  Write-Host "Update failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Details were saved to $logPath" -ForegroundColor Yellow
  exit 1
} finally {
  if ($workingDirectory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and
      [IO.Path]::GetFileName($workingDirectory).StartsWith('MayMay-Legacy-Update-', [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $workingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
