<#
.SYNOPSIS
    Compile the Legion solver to WebAssembly using Emscripten.

.DESCRIPTION
    Activates emsdk in this shell, then runs emcc to produce:
        frontend/public/wasm/legion.js     (ES-module factory)
        frontend/public/wasm/legion.wasm   (the actual WASM binary)

    Run setup_emsdk.ps1 once before using this.
#>
param(
    [string]$EmsdkDir = 'C:\_hey\Projects\c\emsdk',
    [string]$OutDir   = (Join-Path $PSScriptRoot 'web'),
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$envScript = Join-Path $EmsdkDir 'emsdk_env.ps1'
if (-not (Test-Path -LiteralPath $envScript)) {
    Write-Error "emsdk env script not found at $envScript. Run setup_emsdk.ps1 first."
}

Write-Output "Activating emsdk from $EmsdkDir ..."
$env:EMSDK_QUIET = '1'
. $envScript

$emcc = (Get-Command emcc -ErrorAction SilentlyContinue).Source
if (-not $emcc) {
    Write-Error "emcc not on PATH after sourcing emsdk env."
}
Write-Output "emcc: $emcc"

if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path

$exported = @(
    '_legion_solve_wasm',
    '_legion_sizeof_result',
    '_legion_sizeof_placement',
    '_legion_max_placements',
    '_legion_max_cells_per_piece',
    '_legion_board_rows',
    '_legion_board_cols',
    '_legion_offset_success',
    '_legion_offset_n_placements',
    '_legion_offset_iterations',
    '_legion_offset_final_board',
    '_legion_offset_placements',
    '_legion_placement_offset_piece_id',
    '_legion_placement_offset_anchor_x',
    '_legion_placement_offset_anchor_y',
    '_legion_placement_offset_transformation',
    '_legion_placement_offset_direction_free',
    '_legion_placement_offset_is_restricted',
    '_legion_placement_offset_n_cells',
    '_legion_placement_offset_cells_x',
    '_legion_placement_offset_cells_y',
    '_malloc',
    '_free'
)
$exportedJson = '[' + (($exported | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'

$runtime = @('ccall','cwrap','HEAP8','HEAPU8','HEAP16','HEAPU16','HEAP32','HEAPU32','HEAPF64')
$runtimeJson = '[' + (($runtime | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'

$srcs = @('legion.c','pieces.c','wasm_bindings.c')

$flags = @(
    '-std=c11',
    '-Wall', '-Wextra', '-Wno-unused-parameter',
    "-sEXPORTED_FUNCTIONS=$exportedJson",
    "-sEXPORTED_RUNTIME_METHODS=$runtimeJson",
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sENVIRONMENT=web,node',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=16777216',
    '-sSTACK_SIZE=2097152',
    '-sFILESYSTEM=0',
    '-sASSERTIONS=0'
)
if ($Debug) {
    $flags += @('-O0', '-g3', '-sASSERTIONS=2', '-sSAFE_HEAP=1')
} else {
    $flags += @('-O3', '-DNDEBUG')
}

$jsOut = Join-Path $OutDir 'legion.js'
Write-Output "Compiling: $($srcs -join ', ')"
Write-Output "Output:    $jsOut"
$allArgs = @($flags) + @($srcs) + @('-o', $jsOut)
& $emcc @allArgs
if ($LASTEXITCODE -ne 0) { Write-Error "emcc failed (exit $LASTEXITCODE)" }

$wasmOut = Join-Path $OutDir 'legion.wasm'
$jsSize   = (Get-Item $jsOut).Length
$wasmSize = (Get-Item $wasmOut).Length
Write-Output ""
Write-Output ("Built: legion.js   {0,8} bytes" -f $jsSize)
Write-Output ("Built: legion.wasm {0,8} bytes" -f $wasmSize)
