<#
.SYNOPSIS
    One-time installer for Emscripten (emsdk) at C:\_hey\Projects\c\emsdk.

.DESCRIPTION
    Clones the emsdk repo, installs and activates the latest stable Emscripten release.
    After this, use build_wasm.ps1 to compile the solver to WebAssembly.

    Disk: ~1 GB. Network: a few hundred MB. Time: 3-10 min depending on connection.
#>
param(
    [string]$InstallDir = 'C:\_hey\Projects\c\emsdk',
    [string]$Version    = 'latest'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git is required but not found in PATH."
}

if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) {
    Write-Output "emsdk repo already exists at $InstallDir; updating."
    Set-Location -LiteralPath $InstallDir
    & git pull --ff-only
} else {
    Write-Output "Cloning emsdk into $InstallDir ..."
    $parent = Split-Path -Parent $InstallDir
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    & git clone --depth=1 https://github.com/emscripten-core/emsdk.git $InstallDir
    Set-Location -LiteralPath $InstallDir
}

$emsdkBat = Join-Path $InstallDir 'emsdk.bat'
if (-not (Test-Path -LiteralPath $emsdkBat)) {
    Write-Error "emsdk.bat not found at $emsdkBat after clone."
}

Write-Output "Installing Emscripten ($Version) ..."
& $emsdkBat install $Version
if ($LASTEXITCODE -ne 0) { Write-Error "emsdk install failed (exit $LASTEXITCODE)" }

Write-Output "Activating Emscripten ($Version) ..."
& $emsdkBat activate $Version
if ($LASTEXITCODE -ne 0) { Write-Error "emsdk activate failed (exit $LASTEXITCODE)" }

Write-Output ""
Write-Output "Done. emsdk installed at: $InstallDir"
Write-Output "To use emcc in a fresh shell, dot-source the env file:"
Write-Output "    . `"$InstallDir\emsdk_env.ps1`""
Write-Output "Or just run build_wasm.ps1 which does that for you."
