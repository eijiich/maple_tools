param(
    [string]$GccPath = "C:\_hey\Projects\c\mingw64\bin\gcc.exe",
    [switch]$Run,
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath $GccPath)) {
    Write-Error "gcc not found at $GccPath"
}

$flags = @('-std=c11', '-Wall', '-Wextra', '-Wno-unused-parameter')
if ($Debug) {
    $flags += @('-O0', '-g3', '-fno-omit-frame-pointer')
} else {
    $flags += @('-O3', '-DNDEBUG')
}

$src = @('legion.c', 'pieces.c', 'test.c')
$out = 'test_legion.exe'

Write-Output "Compiling: $($src -join ', ')"
& $GccPath @flags $src -o $out
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed (exit $LASTEXITCODE)" }
Write-Output "Built: $out"

if ($Run) {
    Write-Output "--- running ---"
    & ".\$out"
    Write-Output "exit code: $LASTEXITCODE"
}
