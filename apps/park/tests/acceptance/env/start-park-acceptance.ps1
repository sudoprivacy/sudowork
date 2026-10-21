param(
  [string]$AcceptanceRoot = 'C:\work\sudo_workspace_v3\park-acceptance',
  [int]$MossPort = 4174,
  [int]$ParkPort = 4176
)

$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $AcceptanceRoot 'acceptance.json') -Raw -Encoding utf8 | ConvertFrom-Json
$sudoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')).Path
$env:MOSS_BASE_URL = "http://127.0.0.1:$MossPort"
$env:PARK_PUBLIC_ORIGIN = "http://127.0.0.1:$ParkPort"
$env:PARK_PUBLIC_PROXY_HMAC_KEY = $settings.proxyHmacKey
$env:PARK_SESSION_HMAC_KEY = $settings.sessionHmacKey
$env:PARK_TOKEN_AES_KEY = $settings.tokenAesKey
$env:PARK_SESSION_DB = Join-Path $AcceptanceRoot 'park-sessions.sqlite'
$env:PORT = [string]$ParkPort
$node = (Get-Command node).Source
$park = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory (Join-Path $sudoRoot 'apps\park') `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $AcceptanceRoot 'park-console.log') `
  -RedirectStandardError (Join-Path $AcceptanceRoot 'park-error.log')
try {
  Wait-Process -Id $park.Id
} finally {
  if (-not $park.HasExited) { Stop-Process -Id $park.Id }
}
