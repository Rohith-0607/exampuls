# Windows local runner. A single backend shares fallback events with all clients.
param([switch]$NoWait, [switch]$Stop, [switch]$DualBackend)
$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$statePath = Join-Path $projectDir '.exampulse-local.json'
$startedProcesses = @()

if ($Stop) {
    if (Test-Path -LiteralPath $statePath) {
        $records = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        foreach ($record in $records) {
            $running = Get-Process -Id $record.Id -ErrorAction SilentlyContinue
            # Do not stop an unrelated process if Windows has recycled its PID.
            if ($running -and $running.StartTime.ToUniversalTime().ToString('o') -eq $record.StartTime) {
                Stop-Process -Id $running.Id -ErrorAction SilentlyContinue
            }
        }
        Remove-Item -LiteralPath $statePath
        Write-Host 'ExamPulse stopped.'
    } else { Write-Host 'No saved ExamPulse local session.' }
    return
}

function Wait-LocalService {
    param([string]$Url, $Process)
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw "Service exited before becoming ready: $Url. Check *_err.log." }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Url. Check *_err.log."
}

function Start-LocalService {
    param([string]$Executable, [string[]]$ServiceArguments, [string]$Directory, [string]$Name)
    Start-Process -FilePath $Executable -ArgumentList $ServiceArguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectDir "${Name}_out.log") -RedirectStandardError (Join-Path $projectDir "${Name}_err.log")
}

$pythonExe = Join-Path $projectDir 'backend\venv312\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { $pythonExe = Join-Path $projectDir 'backend\venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Create backend\venv and install backend\requirements.txt first.' }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$frontendDir = Join-Path $projectDir 'frontend'
$viteCli = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteCli)) { throw 'Run npm install in frontend first.' }

$ports = @(8001, 5173)
if ($DualBackend) { $ports += 8002 }
foreach ($port in $ports) {
    $listener = New-Object System.Net.Sockets.TcpClient
    try {
        $listener.Connect('127.0.0.1', $port)
        throw "Port $port is already in use. Stop the existing service before starting ExamPulse."
    } catch [System.Net.Sockets.SocketException] {
        # A refused connection means the port is available.
    } finally { $listener.Dispose() }
}

$previousInstanceId = $env:INSTANCE_ID
try {
    & $nodeExe (Join-Path $frontendDir 'scripts\copy-vision-assets.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Could not prepare local camera assets.' }
    $env:INSTANCE_ID = 'backend-1'
    $backend1 = Start-LocalService $pythonExe @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8001') $projectDir 'backend1'
    $startedProcesses += $backend1
    Wait-LocalService 'http://127.0.0.1:8001/health' $backend1
    if ($DualBackend) {
        $health = Invoke-RestMethod 'http://127.0.0.1:8001/health'
        if ($health.redis_fallback) { throw 'Dual backend mode needs shared Redis. Start Redis or omit -DualBackend for local development.' }
        $env:INSTANCE_ID = 'backend-2'
        $backend2 = Start-LocalService $pythonExe @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8002') $projectDir 'backend2'
        $startedProcesses += $backend2
        Wait-LocalService 'http://127.0.0.1:8002/health' $backend2
    }
    $frontend = Start-LocalService $nodeExe @("`"$viteCli`"", '--host', '127.0.0.1', '--port', '5173', '--strictPort') $frontendDir 'frontend'
    $startedProcesses += $frontend
    Wait-LocalService 'http://127.0.0.1:5173' $frontend
    $records = @($startedProcesses | ForEach-Object { @{ Id = $_.Id; StartTime = $_.StartTime.ToUniversalTime().ToString('o') } })
    ConvertTo-Json -InputObject $records | Set-Content -LiteralPath $statePath
    Write-Host 'ExamPulse is ready: http://127.0.0.1:5173' -ForegroundColor Green
    Write-Host 'API docs: http://127.0.0.1:8001/docs'
    Write-Host 'Demo: candidate_001 / password123 or admin / admin123'
    Write-Host 'Stop with: .\run_local.ps1 -Stop'
    if (-not $NoWait) {
        Write-Host 'Press Ctrl+C to stop.'
        while ($true) {
            foreach ($service in $startedProcesses) {
                if ($service.HasExited) { throw 'A service stopped. Check *_err.log.' }
            }
            Start-Sleep -Seconds 1
        }
    }
} catch {
    $NoWait = $false
    throw
} finally {
    $env:INSTANCE_ID = $previousInstanceId
    if (-not $NoWait) {
        foreach ($service in $startedProcesses) {
            if (-not $service.HasExited) { Stop-Process -Id $service.Id -ErrorAction SilentlyContinue }
        }
        if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    }
}
