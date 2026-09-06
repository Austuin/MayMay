[CmdletBinding()]
param(
  [string]$KeyPath,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$projectId = 'maymaydata-a6fda'

if (-not $KeyPath) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Choose the MayMay Firebase Admin key'
  $dialog.Filter = 'Firebase Admin JSON (*.json)|*.json'
  $dialog.InitialDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'No key was selected. Nothing was changed.' -ForegroundColor Yellow
    return
  }
  $KeyPath = $dialog.FileName
}

$resolvedKey = (Resolve-Path -LiteralPath $KeyPath).Path
$key = Get-Content -LiteralPath $resolvedKey -Raw | ConvertFrom-Json
if ($key.project_id -ne $projectId -or -not $key.private_key -or -not $key.client_email) {
  throw "That file is not the Firebase Admin key for $projectId."
}

$configDirectory = Join-Path $PSScriptRoot 'app\config'
$destination = Join-Path $configDirectory 'firebase-admin.json'
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
Copy-Item -LiteralPath $resolvedKey -Destination $destination -Force

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $destination -AclObject $acl
} catch {
  if (-not $Quiet) {
    Write-Warning 'The key was installed, but Windows did not allow its file permissions to be tightened automatically.'
  }
}

if (-not $Quiet) {
  Write-Host 'The Firebase Admin key is installed for this Windows account.' -ForegroundColor Green
  Write-Host 'Keep the original JSON private and do not send it to caregivers.' -ForegroundColor Yellow
}
