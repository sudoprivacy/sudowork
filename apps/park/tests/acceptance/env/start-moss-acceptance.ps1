param(
  [string]$AcceptanceRoot = 'C:\work\sudo_workspace_v3\park-acceptance',
  [int]$MossPort = 4174,
  [int]$ParkPort = 4176,
  [int]$StubPort = 4180,
  [int]$NexusPort = 2126,
  [int]$AuthProxyPort = 12013,
  [string]$ScodePath = ''
)

$ErrorActionPreference = 'Stop'
$sudoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$workspaceRoot = Split-Path -Parent $sudoRoot
$mossRoot = Join-Path $workspaceRoot 'moss'
$node = (Get-Command node).Source
$initializer = Join-Path $PSScriptRoot 'initialize-acceptance.mjs'
$runtimeVersions = Get-Content -LiteralPath (Join-Path $mossRoot 'src\server\nexus\runtime-versions.json') -Raw -Encoding utf8 | ConvertFrom-Json
$expectedScodeVersion = [string]$runtimeVersions.scode
if (-not $ScodePath) {
  $bundledScode = Join-Path $mossRoot 'bin\scode.exe'
  if (Test-Path -LiteralPath $bundledScode) {
    $ScodePath = $bundledScode
  } else {
    $ScodePath = (Get-Command scode -ErrorAction Stop).Source
  }
}
$ScodePath = (Resolve-Path -LiteralPath $ScodePath).Path
$actualScodeVersion = (& $ScodePath --version 2>&1 | Out-String).Trim()
$expectedVersionNumber = $expectedScodeVersion.TrimStart('v')
if ($actualScodeVersion -notmatch "(^|\s)$([regex]::Escape($expectedVersionNumber))(\s|$)") {
  throw "Moss requires scode $expectedScodeVersion, but $ScodePath reported '$actualScodeVersion'. Pass -ScodePath with the pinned binary."
}

New-Item -ItemType Directory -Path $AcceptanceRoot -Force | Out-Null
$acceptanceFile = Join-Path $AcceptanceRoot 'acceptance.json'
if (-not (Test-Path -LiteralPath $acceptanceFile)) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'acceptance.json') -Destination $acceptanceFile
}
$settings = Get-Content -LiteralPath $acceptanceFile -Raw -Encoding utf8 | ConvertFrom-Json
$server = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'server.json') -Raw -Encoding utf8 | ConvertFrom-Json
$server.bootstrapAdmin.username = $settings.admin.username
$server.bootstrapAdmin.password = $settings.admin.password
$server.server.port = $MossPort
$server.runtimeDefaults | Add-Member -NotePropertyName scodePath -NotePropertyValue $ScodePath -Force
$server.storage = [ordered]@{
  rootDir = $AcceptanceRoot
  dbPath = Join-Path $AcceptanceRoot 'moss.db'
  transcriptDir = Join-Path $AcceptanceRoot 'transcripts'
  runtimeDir = Join-Path $AcceptanceRoot 'runtime'
}
$serverFile = Join-Path $AcceptanceRoot 'server.json'
$serverJson = $server | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($serverFile, $serverJson, [System.Text.UTF8Encoding]::new($false))

$env:MOSS_HOME = $AcceptanceRoot
$env:MOSS_SERVER_CONFIG = $serverFile
$env:MOSS_INSTANCE_ID = 'park-acceptance'
$env:MOSS_NEXUS_GRPC_PORT = [string]$NexusPort
$env:MOSS_NEXUS_DIR = Join-Path $AcceptanceRoot 'nexus'
$env:MOSS_AUTH_PROXY_PORT = [string]$AuthProxyPort
$env:MOSS_AUTH_PROXY_URL = "http://127.0.0.1:$AuthProxyPort"
$env:MOSS_PUBLIC_BASE_URL = "http://127.0.0.1:$MossPort"
$env:PARK_PUBLIC_URL = "http://127.0.0.1:$ParkPort/consult"
$env:PARK_ACCEPTANCE_MOSS_URL = "http://127.0.0.1:$MossPort"
$env:PARK_ACCEPTANCE_STUB_URL = "http://127.0.0.1:$StubPort/v1"
$env:PARK_PUBLIC_PROXY_HMAC_KEY = $settings.proxyHmacKey
$env:PARK_SMS_HMAC_KEY = $settings.smsHmacKey
$env:PARK_CAPTCHA_HMAC_KEY = $settings.captchaHmacKey
$env:PARK_ACCEPTANCE_TEST_MODE = '1'
$env:PARK_CAPTCHA_FIXED_CODE = 'ABCDE'

function Wait-MossReady {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$MossPort/readyz" -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  throw 'Moss acceptance server did not become ready within 90 seconds.'
}

function Start-MossProcess {
  Start-Process -FilePath $node -ArgumentList 'bin/moss-server.mjs' -WorkingDirectory $mossRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $AcceptanceRoot 'moss-console.log') `
    -RedirectStandardError (Join-Path $AcceptanceRoot 'moss-error.log')
}

$stub = $null
$moss = $null
try {
  $stub = Start-Process -FilePath $node -ArgumentList @((Join-Path $PSScriptRoot 'model-stub.mjs'), $AcceptanceRoot, $StubPort) `
    -WorkingDirectory $sudoRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $AcceptanceRoot 'model-stub-console.log') `
    -RedirectStandardError (Join-Path $AcceptanceRoot 'model-stub-error.log')
  Start-Sleep -Milliseconds 500

  if (-not $settings.orgId) {
    Remove-Item Env:PARK_ORG_ID -ErrorAction SilentlyContinue
    $moss = Start-MossProcess
    Wait-MossReady
    & $node $initializer $AcceptanceRoot bootstrap
    Stop-Process -Id $moss.Id
    Wait-Process -Id $moss.Id -ErrorAction SilentlyContinue
    $moss = $null
    # Windows cannot deliver SIGTERM to the Node process, so wait for its
    # SQLite liveness row to expire before starting the configured park phase.
    Start-Sleep -Seconds 31
    $settings = Get-Content -LiteralPath $acceptanceFile -Raw -Encoding utf8 | ConvertFrom-Json
  }

  $env:PARK_ORG_ID = $settings.orgId
  $moss = Start-MossProcess
  Wait-MossReady
  & $node $initializer $AcceptanceRoot park
  Write-Output "PARK_MOSS_ACCEPTANCE_READY:http://127.0.0.1:$MossPort root=$AcceptanceRoot scode=$actualScodeVersion"
  Wait-Process -Id $moss.Id
} finally {
  if ($moss -and -not $moss.HasExited) { Stop-Process -Id $moss.Id }
  if ($stub -and -not $stub.HasExited) { Stop-Process -Id $stub.Id }
}
