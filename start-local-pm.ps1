# Launches the local-pm production server on port 3010, logging to logs\server.log; restarts it if it crashes.
# Registered as the "local-pm" scheduled task (at logon, then every 5 minutes so a killed wrapper comes back).
# One wrapper and one server at most: a named mutex refuses a second wrapper, and a server already listening
# on the port is waited on, never duplicated, so the Atlas connection pool is never opened twice.
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force logs | Out-Null
$env:PATH = "$env:USERPROFILE\scoop\apps\nodejs-lts\current;$env:PATH"
$port = 3010

$mutex = New-Object System.Threading.Mutex($false, 'Global\local-pm-wrapper')
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { exit 0 }
"$(Get-Date -Format s) wrapper $PID owns the lock" *>> logs\server.log

try {
    while ($true) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            Start-Sleep -Seconds 30
            continue
        }
        "$(Get-Date -Format s) wrapper $PID starting the server" *>> logs\server.log
        npm run start *>> logs\server.log
        "$(Get-Date -Format s) server exited (code $LASTEXITCODE), restarting in 5s" *>> logs\server.log
        Start-Sleep -Seconds 5
    }
} finally {
    $mutex.ReleaseMutex()
}
