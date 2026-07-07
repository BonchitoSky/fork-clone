# Fork & Clone native messaging host.
#
# Chrome's native messaging protocol frames every message as a 4-byte
# little-endian unsigned length followed by exactly that many bytes of UTF-8
# JSON, on RAW stdin/stdout. Anything else written to stdout (Write-Host,
# stray pipeline output, git progress) corrupts the frame and Chrome drops
# the connection — so all output below is either captured into variables or
# piped to $null, and replies go through Send-Reply only.

$ErrorActionPreference = 'Stop'

function Send-Reply($obj) {
    $json = ConvertTo-Json -InputObject $obj -Compress -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $out = [Console]::OpenStandardOutput()
    $len = [System.BitConverter]::GetBytes([UInt32]$bytes.Length)  # little-endian on Windows
    $out.Write($len, 0, 4)
    $out.Write($bytes, 0, $bytes.Length)
    $out.Flush()
}

function Read-Message {
    $in = [Console]::OpenStandardInput()
    $header = New-Object byte[] 4
    $got = 0
    while ($got -lt 4) {
        $n = $in.Read($header, $got, 4 - $got)
        if ($n -le 0) { return $null }
        $got += $n
    }
    $len = [System.BitConverter]::ToUInt32($header, 0)
    if ($len -eq 0 -or $len -gt 1MB) { return $null }
    $buf = New-Object byte[] $len
    $got = 0
    while ($got -lt $len) {
        $n = $in.Read($buf, $got, $len - $got)
        if ($n -le 0) { break }
        $got += $n
    }
    $json = [System.Text.Encoding]::UTF8.GetString($buf, 0, $got)
    return ConvertFrom-Json -InputObject $json
}

function Find-Git {
    $cmd = Get-Command git -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe",
        "$env:LocalAppData\Programs\Git\cmd\git.exe"
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

function Get-FreeTarget($folder, $repo) {
    $target = Join-Path $folder $repo
    $i = 2
    while (Test-Path $target) {
        $target = Join-Path $folder ($repo + '-' + $i)
        $i++
    }
    return $target
}

function Invoke-Clone($git, $url, $target) {
    # Up to 3 attempts with a pause: a fresh fork can answer the API before
    # its git data is actually clonable, so the first attempt may fail.
    # ErrorActionPreference must be Continue here: under 'Stop', PowerShell 5.1
    # converts git's ordinary stderr progress ("Cloning into ...") into a
    # terminating error as soon as 2>&1 redirects it.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $lastError = ''
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $output = (& $git clone -- $url $target 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) {
            $ErrorActionPreference = $prevEap
            return @{ ok = $true }
        }
        $lastError = $output
        if ($attempt -lt 3) { Start-Sleep -Seconds 4 }
    }
    $ErrorActionPreference = $prevEap
    $trimmed = $lastError.Trim()
    if ($trimmed.Length -gt 500) { $trimmed = $trimmed.Substring($trimmed.Length - 500) }
    return @{ ok = $false; error = $trimmed }
}

try {
    $msg = Read-Message
    if ($null -eq $msg) { exit 0 }

    if ($msg.ping) {
        $git = Find-Git
        $gitVersion = $null
        if ($git) {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $gitVersion = (& $git --version 2>&1 | Out-String).Trim()
            $ErrorActionPreference = $prevEap
        }
        Send-Reply @{ pong = $true; git = $gitVersion }
        exit 0
    }

    # Validate strictly: only github.com HTTPS remotes, absolute folder,
    # plain repo name. Blocks a hostile page from repurposing this host.
    if ($msg.url -notmatch '^https://github\.com/[\w.-]+/[\w.-]+(\.git)?$') {
        Send-Reply @{ ok = $false; error = 'Rejected: url must be a https://github.com/owner/repo clone URL.' }
        exit 0
    }
    if ($msg.folder -notmatch '^[A-Za-z]:\\') {
        Send-Reply @{ ok = $false; error = 'Rejected: folder must be an absolute Windows path.' }
        exit 0
    }
    if ($msg.repo -notmatch '^[\w.-]+$' -or $msg.repo -eq '.' -or $msg.repo -eq '..') {
        Send-Reply @{ ok = $false; error = 'Rejected: invalid repo name.' }
        exit 0
    }

    $git = Find-Git
    if (-not $git) {
        Send-Reply @{ ok = $false; error = 'git not found. Install Git for Windows: https://git-scm.com/download/win' }
        exit 0
    }

    if (-not (Test-Path $msg.folder)) {
        $null = New-Item -ItemType Directory -Path $msg.folder -Force
    }
    $target = Get-FreeTarget $msg.folder $msg.repo

    $result = Invoke-Clone $git $msg.url $target
    if ($result.ok) {
        Send-Reply @{ ok = $true; path = $target }
    } else {
        Send-Reply @{ ok = $false; error = $result.error }
    }
} catch {
    # The host must always answer; a silent death looks like a hung clone.
    Send-Reply @{ ok = $false; error = ('Host error: ' + $_.Exception.Message) }
}
