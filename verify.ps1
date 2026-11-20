# Run from any working directory; failures stop verification immediately.
$ErrorActionPreference = 'Stop'
$pythonExe = Join-Path $PSScriptRoot 'backend\venv312\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { $pythonExe = Join-Path $PSScriptRoot 'backend\venv\Scripts\python.exe' }
Push-Location $PSScriptRoot
try {
    & $pythonExe -m pytest backend/tests -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
    Set-Location (Join-Path $PSScriptRoot 'frontend')
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'All tests and production build passed.' -ForegroundColor Green
