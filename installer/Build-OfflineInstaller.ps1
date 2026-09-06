[CmdletBinding()]
param(
  [string]$Version = '0.1.0',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$stageRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot ".installer-stage-$PID"))
$installerFolder = Join-Path $stageRoot "MayMay-Offline-Installer-v$Version"
$payloadRoot = Join-Path $stageRoot 'payload'
$payloadApp = Join-Path $payloadRoot 'app'
$finalFolder = Join-Path $releaseRoot "MayMay-Offline-Installer-v$Version"
$finalZip = Join-Path $releaseRoot "MayMay-Offline-Installer-v$Version.zip"
$checksumFile = "$finalZip.sha256"

function Remove-SafeDirectory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolved = [IO.Path]::GetFullPath($Path)
  $allowedPrefix = "$releaseRoot$([IO.Path]::DirectorySeparatorChar)"
  if (-not $resolved.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside the release directory: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

try {
  Set-Location -LiteralPath $projectRoot
  if (-not $SkipBuild) {
    Write-Host 'Building the MayMay production website...' -ForegroundColor Cyan
    $buildStarted = [DateTime]::UtcNow
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $buildOutput = @(& npm.cmd run build 2>&1)
      $buildExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $savedErrorActionPreference
    }
    $buildOutput | ForEach-Object { Write-Host $_ }
    $builtIndex = Join-Path $projectRoot 'dist\client\index.html'
    $knownVinextWindowsExit =
      $buildExitCode -eq -1073740791 -and
      ($buildOutput -join "`n") -match 'Build complete' -and
      (Test-Path -LiteralPath $builtIndex -PathType Leaf) -and
      (Get-Item -LiteralPath $builtIndex).LastWriteTimeUtc -ge $buildStarted.AddSeconds(-2)
    if ($buildExitCode -ne 0 -and -not $knownVinextWindowsExit) {
      throw "The website build failed with exit code $buildExitCode."
    }
    if ($knownVinextWindowsExit) {
      Write-Warning 'Vinext hit its known Windows shutdown assertion after completing the static export; the fresh output was verified and packaging will continue.'
    }
  }

  $clientBuild = Join-Path $projectRoot 'dist\client'
  if (-not (Test-Path -LiteralPath (Join-Path $clientBuild 'index.html') -PathType Leaf)) {
    throw 'dist\client\index.html is missing. Run the website build first.'
  }

  $runtimeLock = Join-Path $PSScriptRoot 'runtime\package-lock.json'
  if (-not (Test-Path -LiteralPath $runtimeLock -PathType Leaf)) {
    throw 'installer\runtime\package-lock.json is missing. Generate it before packaging.'
  }

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  Remove-SafeDirectory $stageRoot
  Remove-SafeDirectory $finalFolder
  Remove-Item -LiteralPath $finalZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $checksumFile -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $payloadApp -Force | Out-Null
  New-Item -ItemType Directory -Path $installerFolder -Force | Out-Null

  Write-Host 'Collecting the offline runtime and static application...' -ForegroundColor Cyan
  Copy-DirectoryContents $clientBuild (Join-Path $payloadApp 'dist\client')
  Remove-Item -LiteralPath (Join-Path $payloadApp 'dist\client\maymay-runtime.json') -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path (Join-Path $payloadApp 'public') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $payloadApp 'scripts') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\host-terminal.mjs') -Destination (Join-Path $payloadApp 'scripts\host-terminal.mjs')
  Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\provision-firestore.mjs') -Destination (Join-Path $payloadApp 'scripts\provision-firestore.mjs')
  Copy-Item -LiteralPath (Join-Path $projectRoot 'firebase.rules') -Destination (Join-Path $payloadApp 'firebase.rules')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json') -Destination (Join-Path $payloadApp 'package.json')
  Copy-Item -LiteralPath $runtimeLock -Destination (Join-Path $payloadApp 'package-lock.json')

  Push-Location $payloadApp
  try {
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "The offline runtime dependency install failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  New-Item -ItemType Directory -Path (Join-Path $payloadRoot 'runtime') -Force | Out-Null
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $payloadRoot 'runtime\node.exe')
  Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'payload') -Force | Copy-Item -Destination $payloadRoot -Recurse -Force

  $payloadZip = Join-Path $installerFolder 'MayMay-Payload.zip'
  Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $payloadZip -CompressionLevel Optimal -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-MayMay.cmd') -Destination $installerFolder
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-MayMay.ps1') -Destination $installerFolder
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-FIRST.txt') -Destination $installerFolder

  Move-Item -LiteralPath $installerFolder -Destination $finalFolder
  Compress-Archive -Path (Join-Path $finalFolder '*') -DestinationPath $finalZip -CompressionLevel Optimal -Force
  $hash = Get-FileHash -LiteralPath $finalZip -Algorithm SHA256
  Set-Content -LiteralPath $checksumFile -Value "$($hash.Hash)  $([IO.Path]::GetFileName($finalZip))" -Encoding ascii

  Write-Host ''
  Write-Host 'Offline installer created:' -ForegroundColor Green
  Write-Host "  $finalZip" -ForegroundColor Green
  Write-Host "  $finalFolder" -ForegroundColor Green
  Write-Host "  ZIP SHA-256: $($hash.Hash)" -ForegroundColor Green
} finally {
  Set-Location -LiteralPath $projectRoot
  Remove-SafeDirectory $stageRoot
}
