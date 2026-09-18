[CmdletBinding()]
param(
  [Nullable[int]]$AppPort,
  [Nullable[int]]$SidecarPort
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$settings = Get-Content -Raw (Join-Path $PSScriptRoot "local-settings.json") | ConvertFrom-Json
$sidecarTokenPath = Join-Path $projectRoot ".local\sidecar-token.txt"

function Resolve-Port($explicitValue, [string]$environmentName, [int]$fallback) {
  $candidate = if ($null -ne $explicitValue) {
    $explicitValue
  } elseif ([Environment]::GetEnvironmentVariable($environmentName)) {
    [Environment]::GetEnvironmentVariable($environmentName)
  } else {
    $fallback
  }
  $value = 0
  if (-not [int]::TryParse([string]$candidate, [ref]$value) -or $value -le 0 -or $value -ge 65536) {
    throw "$environmentName must be an integer between 1 and 65535."
  }
  return $value
}

$appPortValue = Resolve-Port $AppPort "APP_PORT" ([int]$settings.appPort)
$sidecarPortValue = Resolve-Port $SidecarPort "SIDECAR_PORT" ([int]$settings.sidecarPort)
$appUrl = "http://127.0.0.1:$appPortValue"
$sidecarUrl = "http://127.0.0.1:$sidecarPortValue"

function Get-Endpoint([string]$uri, [bool]$includeBody = $false) {
  try {
    $response = Invoke-WebRequest -Uri $uri -TimeoutSec 5 -UseBasicParsing
    [pscustomobject]@{ url = $uri; status = $response.StatusCode; body = if ($includeBody) { $response.Content } else { "" } }
  } catch {
    [pscustomobject]@{ url = $uri; status = 0; body = $_.Exception.Message }
  }
}

function Get-Status([string]$uri, [hashtable]$headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $uri -Headers $headers -TimeoutSec 5 -UseBasicParsing
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Read-SidecarToken([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return "" }
  $file = Get-Item -LiteralPath $path
  if ($file.Length -le 0 -or $file.Length -gt 4096) { return "" }
  $value = [System.IO.File]::ReadAllText($file.FullName).Trim()
  if ($value.Length -lt 32 -or $value.Contains("`r") -or $value.Contains("`n")) { return "" }
  return $value
}

$app = Get-Endpoint "$appUrl/api/health" $true
$sidecar = Get-Endpoint "$sidecarUrl/openapi.json"
$sidecarToken = Read-SidecarToken $sidecarTokenPath
$unauthenticatedStatus = Get-Status "$sidecarUrl/__local_auth_probe__"
$authenticatedStatus = if ($sidecarToken) {
  Get-Status "$sidecarUrl/__local_auth_probe__" @{ Authorization = "Bearer $sidecarToken" }
} else {
  0
}
$sidecarAuthHealthy = $unauthenticatedStatus -eq 401 `
  -and $authenticatedStatus -gt 0 `
  -and $authenticatedStatus -ne 401
$health = $null
if ($app.status -ge 200 -and $app.status -lt 300) {
  try { $health = $app.body | ConvertFrom-Json } catch { $health = $null }
}
[pscustomobject]@{
  app = [pscustomobject]@{
    url = $app.url
    status = $app.status
    douyinConfigured = [bool]$health.services.douyin.configured
    bilibiliHealthy = [bool]$health.services.bilibili.healthy
    message = if ($health.services.bilibili.message) { $health.services.bilibili.message } else { "" }
  }
  sidecar = [pscustomobject]@{
    url = $sidecar.url
    status = $sidecar.status
    tokenReady = [bool]$sidecarToken
    unauthenticatedStatus = $unauthenticatedStatus
    authenticatedStatus = $authenticatedStatus
    authenticationHealthy = $sidecarAuthHealthy
  }
} | ConvertTo-Json -Depth 6

if ($app.status -lt 200 -or $app.status -ge 300) { exit 1 }
if ($sidecar.status -lt 200 -or $sidecar.status -ge 300) { exit 2 }
if (-not $sidecarAuthHealthy) { exit 5 }
if (-not $health -or -not $health.services.douyin.configured) { exit 3 }
if (-not $health.services.bilibili.healthy) { exit 4 }
