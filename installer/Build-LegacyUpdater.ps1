[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$sourceRoot = Join-Path $PSScriptRoot 'legacy-updater'
$stageRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot ".legacy-updater-stage-$PID"))
$finalZip = Join-Path $releaseRoot 'MayMay-Legacy-Updater.zip'
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

try {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'Update-MayMay.cmd') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $sourceRoot 'Update-MayMay.ps1') -PathType Leaf)) {
    throw 'The legacy updater source files are incomplete.'
  }

  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  Remove-SafeDirectory $stageRoot
  Remove-Item -LiteralPath $finalZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $checksumFile -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $sourceRoot -File | Copy-Item -Destination $stageRoot -Force

  Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $finalZip -CompressionLevel Optimal -Force
  $hash = Get-FileHash -LiteralPath $finalZip -Algorithm SHA256
  Set-Content -LiteralPath $checksumFile -Value "$($hash.Hash)  $([IO.Path]::GetFileName($finalZip))" -Encoding ascii

  Write-Host 'Email-ready legacy updater created:' -ForegroundColor Green
  Write-Host "  $finalZip" -ForegroundColor Green
  Write-Host "  ZIP SHA-256: $($hash.Hash)" -ForegroundColor Green
} finally {
  Remove-SafeDirectory $stageRoot
}

