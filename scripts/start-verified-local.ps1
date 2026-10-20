[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$NodeBinary = $env:NORTHSTAR_LOCAL_NODE_BINARY
)

$ErrorActionPreference = 'Stop'
$failure = 'NorthStar verified local startup rejected the Node runtime.'
$expectedPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0'
if (-not ([IO.Path]::GetFullPath($PSHOME).TrimEnd('\') -ieq $expectedPowerShell)) {
  throw $failure
}

foreach ($key in @(
  'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID',
  'RAILWAY_SERVICE_ID', 'RAILWAY_STATIC_URL', 'NIXPACKS_NODE_VERSION'
)) {
  if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key))) {
    throw $failure
  }
}
if ([string]::IsNullOrWhiteSpace($NodeBinary) -or
    -not [IO.Path]::IsPathRooted($NodeBinary) -or
    -not ([IO.Path]::GetFullPath($NodeBinary) -ceq $NodeBinary)) {
  throw $failure
}
$item = Get-Item -LiteralPath $NodeBinary -Force
if (-not $item.PSIsContainer -and $item.Extension -ieq '.exe' -and
    -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
    [string]::IsNullOrEmpty([string]$item.LinkType)) {
  $resolved = $item.FullName
} else {
  throw $failure
}
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -ErrorAction Stop
$owner = (Microsoft.PowerShell.Security\Get-Acl -LiteralPath $resolved).GetOwner(
  [Security.Principal.SecurityIdentifier]
).Value
$currentOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($owner -cne $currentOwner) { throw $failure }
$expectedSha256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e'
$sha256 = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($resolved)
try {
  $actualSha256 = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
} finally {
  $stream.Dispose()
  $sha256.Dispose()
}
if ($actualSha256 -cne $expectedSha256) { throw $failure }

foreach ($key in @('NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
  'npm_config_node_options', 'NODE_V8_COVERAGE')) {
  if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key))) {
    throw $failure
  }
  [Environment]::SetEnvironmentVariable($key, $null, 'Process')
}

$env:PATH = $item.DirectoryName
$env:NORTHSTAR_AUTHENTICATED_NODE_PATH = $resolved
$env:NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY = 'official-win-x64-22.23.3-v1'
$env:NORTHSTAR_AUTHENTICATED_NODE_SHA256 = $expectedSha256
& $resolved (Join-Path $PSScriptRoot 'production-launcher.js')
exit $LASTEXITCODE
