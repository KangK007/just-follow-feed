[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sidecarRoot = Join-Path $projectRoot ".local\Douyin_TikTok_Download_API"
$requirements = Join-Path $sidecarRoot "requirements.txt"
$venvPython = Join-Path $sidecarRoot ".venv\Scripts\python.exe"
$auditPython = Join-Path $projectRoot ".local\audit-tools\Scripts\python.exe"
$sitePackages = Join-Path $sidecarRoot ".venv\Lib\site-packages"

if (-not (Test-Path -LiteralPath $venvPython) -or -not (Test-Path -LiteralPath $requirements)) {
  throw "The pinned sidecar is not installed. Run setup-sidecar.ps1 first."
}

& $venvPython -m pip check
if ($LASTEXITCODE -ne 0) { throw "The sidecar environment has incompatible packages." }

$hasModule = (& $venvPython -c "import importlib.util; print('yes' if importlib.util.find_spec('pip_audit') else 'no')").Trim()
if ($hasModule -eq "yes") {
  & $venvPython -m pip_audit
} elseif (Test-Path -LiteralPath $auditPython) {
  & $auditPython -m pip_audit --path $sitePackages
} elseif (Get-Command uvx -ErrorAction SilentlyContinue) {
  uvx pip-audit --path $sitePackages
} elseif (Get-Command pipx -ErrorAction SilentlyContinue) {
  pipx run pip-audit --path $sitePackages
} else {
  throw "pip-audit is unavailable. Install pip-audit, uvx, or pipx before accepting sidecar dependency changes."
}

if ($LASTEXITCODE -ne 0) { throw "The sidecar dependency audit reported vulnerabilities." }
