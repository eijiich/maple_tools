<#
.SYNOPSIS
    Bundle launcher.py + web/ assets into a single Windows executable.

.DESCRIPTION
    Uses PyInstaller --onefile to produce solver/dist/legion-solver.exe.
    Recipients double-click the .exe; it starts a local server, opens their
    browser to the page, and the console window is the "stop" handle.

    Output: solver/dist/legion-solver.exe (typically 10-15 MB — Python runtime).
#>
param(
    [string]$Python = 'C:\Program Files\Python312\python.exe',
    [switch]$KeepBuild
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Error "python not found at $Python"
}

# Confirm PyInstaller is importable
& $Python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "PyInstaller not installed. Run:  $Python -m pip install --user pyinstaller"
}

$dist  = Join-Path $PSScriptRoot 'dist'
$build = Join-Path $PSScriptRoot '.pyinst_build'
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

# Refresh the web assets that ship with the exe — they get copied from solver/web/.
$webSrc = Join-Path $PSScriptRoot 'web'

Write-Output "Bundling launcher.py + web/ into a single .exe..."
$pyinstArgs = @(
    '--noconfirm',
    '--onefile',
    '--console',
    '--name', 'legion-solver',
    '--distpath', $dist,
    '--workpath', $build,
    '--specpath', $build,
    '--add-data', "$webSrc;web",
    (Join-Path $PSScriptRoot 'launcher.py')
)
# Suppress PyInstaller's chatty info-to-stderr (PowerShell would otherwise
# treat it as errors under ErrorActionPreference=Stop).
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $Python -m PyInstaller @pyinstArgs 2>&1 | Out-Host
$exit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($exit -ne 0) { Write-Error "PyInstaller failed (exit $exit)" }

$exe = Join-Path $dist 'legion-solver.exe'
if (-not (Test-Path $exe)) { Write-Error "expected $exe but it wasn't produced" }

Write-Output ""
Write-Output ("Built: {0}" -f $exe)
Write-Output ("Size:  {0:N1} MB" -f ((Get-Item $exe).Length / 1MB))

if (-not $KeepBuild) {
    Remove-Item -Recurse -Force $build -ErrorAction SilentlyContinue
}
