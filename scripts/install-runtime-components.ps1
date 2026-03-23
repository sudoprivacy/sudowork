# Sudowork Runtime Components Installer
# Installs Node.js, Sudoclaw (OpenClaw), and Nexus to user's home directory
# Called by NSIS installer after files are copied

param(
    [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"

# Paths
$NexusDir = Join-Path $env:USERPROFILE ".nexus"
$NodeDir = Join-Path $NexusDir "node"
$SudoclawDir = Join-Path $NexusDir ".sudoclaw"
$NexusEnvDir = Join-Path $NexusDir "nexus_env"

# Resource paths - NSIS installs resources to $INSTDIR\resources\
# Script is located at $INSTDIR\resources\install-runtime-components.ps1
# Resources are in the same directory as this script
$AppResources = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $AppResources) {
    $AppResources = $PSScriptRoot
}

function Write-Log {
    param([string]$Message)
    Write-Host "[Sudowork] $Message"
}

function Install-NodeJS {
    $NodeZip = Join-Path $AppResources "node-win32-$Arch.zip"
    if (-not (Test-Path $NodeZip)) {
        Write-Log "Node.js bundle not found: $NodeZip"
        return $false
    }

    # Check if already installed
    $NodeExe = Join-Path $NodeDir "node-v24.9.0-win-$Arch\node.exe"
    if (Test-Path $NodeExe) {
        Write-Log "Node.js already installed at: $NodeExe"
        return $true
    }

    Write-Log "Installing Node.js..."
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null

    try {
        Expand-Archive -Path $NodeZip -DestinationPath $NodeDir -Force
        Write-Log "Node.js installed successfully"
        return $true
    } catch {
        Write-Log "Failed to install Node.js: $_"
        return $false
    }
}

function Install-Sudoclaw {
    $OpenclawTgz = Join-Path $AppResources "openclaw.tgz"
    if (-not (Test-Path $OpenclawTgz)) {
        Write-Log "OpenClaw bundle not found: $OpenclawTgz"
        return $false
    }

    # Check if already installed with dist/ and node_modules
    $EntryFile = Join-Path $SudoclawDir "cli\package\dist\entry.mjs"
    $NodeModules = Join-Path $SudoclawDir "cli\package\node_modules"
    if ((Test-Path $EntryFile) -and (Test-Path $NodeModules)) {
        Write-Log "Sudoclaw already installed"
        return $true
    }

    Write-Log "Installing Sudoclaw (OpenClaw)..."
    $CliDir = Join-Path $SudoclawDir "cli"
    $BinDir = Join-Path $SudoclawDir "bin"

    New-Item -ItemType Directory -Force -Path $CliDir | Out-Null
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    try {
        # Extract using tar (Windows 10+ has built-in tar)
        tar -xzf $OpenclawTgz -C $CliDir

        $PkgDir = Join-Path $CliDir "package"

        # Run npm install for platform-specific dependencies
        $NodeExe = Join-Path $NodeDir "node-v24.9.0-win-$Arch\node.exe"
        if (Test-Path $NodeExe) {
            Write-Log "Running npm install for Sudoclaw dependencies..."
            $NpmCli = Join-Path (Split-Path $NodeExe -Parent) "..\lib\node_modules\npm\bin\npm-cli.js"
            if (Test-Path $NpmCli) {
                & $NodeExe $NpmCli install --legacy-peer-deps --omit=dev 2>&1 | Out-Null
            }
        }

        # Create wrapper script
        $LauncherPath = Join-Path $PkgDir "launcher.mjs"
        $WrapperPath = Join-Path $BinDir "openclaw.cmd"

        # Create launcher.mjs
        $LauncherContent = @"
#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openclawPath = path.join(__dirname, 'openclaw.mjs');
let userArgs = process.argv.slice(2);
const isExecutablePath = (s) => typeof s === 'string' && (
  /node(\\.exe)?$/i.test(path.basename(s)) || /Sudowork(\\.exe)?$/i.test(path.basename(s))
);
while (userArgs.length > 0 && isExecutablePath(userArgs[0])) userArgs = userArgs.slice(1);
process.argv = ['node', openclawPath, ...userArgs];
await import('./openclaw.mjs');
"@
        Set-Content -Path $LauncherPath -Value $LauncherContent -Encoding UTF8

        # Create wrapper.cmd
        $WrapperContent = @"
@echo off
set "CLI=$LauncherPath"
set "OPENCLAW_STATE_DIR=$SudoclawDir"
set "BUNDLED_NODE=$NodeExe"
"%BUNDLED_NODE%" "%CLI%" %*
"@
        Set-Content -Path $WrapperPath -Value $WrapperContent -Encoding ASCII

        # Create default config
        $ConfigPath = Join-Path $SudoclawDir "openclaw.json"
        if (-not (Test-Path $ConfigPath)) {
            $DefaultConfig = @{
                agents = @{
                    defaults = @{
                        workspace = Join-Path $SudoclawDir "workspace"
                        model = @{ primary = "sudorouter/gemini-3-flash-preview"; fallbacks = @() }
                    }
                    list = @(@{ id = "main"; identity = @{ name = "OpenClaw"; emoji = "🦞" } })
                }
                models = @{
                    mode = "merge"
                    providers = @{
                        sudorouter = @{
                            baseUrl = "https://hk.sudorouter.ai/v1"
                            api = "google-generative-ai"
                            models = @(@{ id = "gemini-3-flash-preview"; name = "gemini-3-flash-preview" })
                        }
                    }
                }
                gateway = @{ port = 17863; mode = "local"; auth = @{ mode = "none" } }
            }
            $DefaultConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8
        }

        Write-Log "Sudoclaw installed successfully"
        return $true
    } catch {
        Write-Log "Failed to install Sudoclaw: $_"
        return $false
    }
}

function Install-Nexus {
    $NexusTgz = Join-Path $AppResources "nexus.tar.gz"
    if (-not (Test-Path $NexusTgz)) {
        Write-Log "Nexus bundle not found (optional): $NexusTgz"
        return $true  # Nexus is optional
    }

    # Check if already installed
    $MarkerFile = Join-Path $NexusEnvDir ".nexus-conda-ready"
    $NexusdBin = Join-Path $NexusEnvDir "bin\nexusd.exe"
    if ((Test-Path $MarkerFile) -and (Test-Path $NexusdBin)) {
        Write-Log "Nexus already installed"
        return $true
    }

    Write-Log "Installing Nexus..."

    # Remove old installation
    if (Test-Path $NexusEnvDir) {
        Remove-Item -Recurse -Force $NexusEnvDir
    }

    New-Item -ItemType Directory -Force -Path $NexusEnvDir | Out-Null

    try {
        tar -xzf $NexusTgz -C $NexusEnvDir

        # Create marker file
        Set-Content -Path $MarkerFile -Value "installed" -Encoding UTF8

        Write-Log "Nexus installed successfully"
        return $true
    } catch {
        Write-Log "Failed to install Nexus: $_"
        return $false
    }
}

# Main
Write-Log "Installing Sudowork runtime components (Arch: $Arch)..."
Write-Log "Resources path: $AppResources"

$Results = @{}
$Results["Node.js"] = Install-NodeJS
$Results["Sudoclaw"] = Install-Sudoclaw
$Results["Nexus"] = Install-Nexus

Write-Log "`nInstallation Summary:"
foreach ($key in $Results.Keys) {
    $status = if ($Results[$key]) { "OK" } else { "FAILED" }
    Write-Log "  $key : $status"
}

$Failed = $Results.Values | Where-Object { -not $_ }
if ($Failed) {
    Write-Log "`nSome components failed to install. Please check the logs above."
    exit 1
} else {
    Write-Log "`nAll components installed successfully!"
    exit 0
}