# Run this script as Administrator to set up the background storage monitor
# It creates a Windows Scheduled Task that runs on login

$taskName = "StorageManagerMonitor"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $projectDir "monitor.js"

if (-not $nodePath) {
    Write-Host "ERROR: Node.js not found in PATH" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: monitor.js not found at $scriptPath" -ForegroundColor Red
    exit 1
}

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the task
$action = New-ScheduledTaskAction -Execute $nodePath -Argument $scriptPath -WorkingDirectory $projectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Monitors disk space and sends alerts when drives are getting full" -RunLevel Highest

Write-Host ""
Write-Host "Storage Monitor installed!" -ForegroundColor Green
Write-Host "- Project directory: $projectDir"
Write-Host "- Runs automatically when you log in"
Write-Host "- Checks disk space every 10 minutes"
Write-Host "- Sends Windows notifications when space is low"
Write-Host "- Daily status report at 9 AM"
Write-Host ""
Write-Host "To start it now: node `"$scriptPath`""
Write-Host "To remove it: Unregister-ScheduledTask -TaskName StorageManagerMonitor"
