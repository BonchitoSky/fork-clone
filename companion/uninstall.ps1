# Fork & Clone companion uninstaller: removes the registry key and the
# generated host manifest. Never touches your cloned repositories.

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.forkclone.host'
$jsonPath = Join-Path $here 'com.forkclone.host.json'

if (Test-Path $key) {
    Remove-Item -Path $key -Force -Confirm:$false
    Write-Host "Removed registry key: $key" -ForegroundColor Green
} else {
    Write-Host 'Registry key was not present (already uninstalled?).' -ForegroundColor Yellow
}

if (Test-Path $jsonPath) {
    Remove-Item -Path $jsonPath -Force -Confirm:$false
    Write-Host "Removed host manifest: $jsonPath" -ForegroundColor Green
} else {
    Write-Host 'Host manifest was not present.' -ForegroundColor Yellow
}

Write-Host 'Done. You can also remove the extension from chrome://extensions.'
