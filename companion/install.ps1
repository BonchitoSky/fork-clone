# Fork & Clone companion installer.
# Registers the native messaging host for the current user (HKCU, no admin).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ''
Write-Host '=== Fork & Clone companion installer ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'You need the extension ID of the loaded extension:'
Write-Host '  1. Open chrome://extensions in Chrome'
Write-Host '  2. Turn on "Developer mode" (top right)'
Write-Host '  3. Find "Fork & Clone" and copy the ID shown under it'
Write-Host ''

$extensionId = (Read-Host 'Paste your extension ID').Trim()
if ($extensionId -notmatch '^[a-p]{32}$') {
    Write-Host ''
    Write-Host "That doesn't look like an extension ID (must be exactly 32 letters, a-p only)." -ForegroundColor Red
    Write-Host 'Copy it from chrome://extensions and run install.bat again.' -ForegroundColor Red
    exit 1
}

$hostBat = Join-Path $here 'host.bat'
if (-not (Test-Path $hostBat)) {
    Write-Host "host.bat not found next to this script ($hostBat) - keep the companion folder together." -ForegroundColor Red
    exit 1
}

$manifest = [ordered]@{
    name            = 'com.forkclone.host'
    description     = 'Runs git clone for the Fork & Clone extension'
    path            = $hostBat
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
$json = ConvertTo-Json -InputObject $manifest
$jsonPath = Join-Path $here 'com.forkclone.host.json'

# UTF-8 WITHOUT BOM: Chrome rejects a host manifest that starts with a BOM.
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote host manifest: $jsonPath" -ForegroundColor Green

$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.forkclone.host'
$null = New-Item -Path $key -Force
Set-Item -Path $key -Value $jsonPath
Write-Host "Registered registry key: $key" -ForegroundColor Green

Write-Host ''
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitVersion = (& git --version)
    Write-Host "Git found: $gitVersion" -ForegroundColor Green
} else {
    Write-Host 'WARNING: git was not found on this computer.' -ForegroundColor Yellow
    Write-Host 'Cloning will not work until you install Git for Windows:' -ForegroundColor Yellow
    Write-Host '  https://git-scm.com/download/win' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Installed - restart Chrome, then use Test & Save in the extension options.' -ForegroundColor Cyan
