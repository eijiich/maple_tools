<#
.SYNOPSIS
    Build a single self-contained legion-solver.html from the modular sources.

.DESCRIPTION
    Produces solver/dist/legion-solver.html — one file with WASM (embedded as
    base64), all JS bundled into an inline IIFE, and all CSS inlined.
    Recipients just double-click; no server / no Python / no installs needed.

    Pipeline:
      1. Recompile WASM with -sSINGLE_FILE=1 so the binary embeds into legion.js.
      2. esbuild bundles app.mjs → wasm.mjs → legion.js into one IIFE.
      3. PowerShell stitches inline <style> + inline <script> into the HTML.

    Build artifacts live in solver/.build_single/ (deleted afterwards).
    Doesn't touch solver/web/ — your dev workflow is unaffected.
#>
param(
    [string]$EmsdkDir = 'C:\_hey\Projects\c\emsdk',
    [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# --- emsdk env ---
$envScript = Join-Path $EmsdkDir 'emsdk_env.ps1'
if (-not (Test-Path $envScript)) { Write-Error "emsdk env not found at $envScript" }
$env:EMSDK_QUIET = '1'
. $envScript

$emcc = (Get-Command emcc -ErrorAction SilentlyContinue).Source
if (-not $emcc) { Write-Error "emcc not on PATH after activating emsdk" }

# --- npx (from emsdk's bundled node) ---
$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxCmd) { Write-Error "npx not found (Node should come with emsdk)" }
$npx = $npxCmd.Source

# --- directories ---
$webSrc = Join-Path $PSScriptRoot 'web'
$temp   = Join-Path $PSScriptRoot '.build_single'
$dist   = Join-Path $PSScriptRoot 'dist'
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
New-Item -ItemType Directory -Path $temp | Out-Null

# Copy modular sources into temp
Copy-Item (Join-Path $webSrc '*.mjs') $temp
Copy-Item (Join-Path $webSrc 'style.css') $temp
Copy-Item (Join-Path $webSrc 'index.html') $temp

# --- Step 1: compile WASM with SINGLE_FILE -----------------------------------
Write-Output "[1/3] Compiling WASM (single-file mode)..."
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

$flags = @(
    '-std=c11',
    '-Wall', '-Wextra', '-Wno-unused-parameter',
    '-O3', '-DNDEBUG',
    "-sEXPORTED_FUNCTIONS=$exportedJson",
    "-sEXPORTED_RUNTIME_METHODS=$runtimeJson",
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sENVIRONMENT=web',
    '-sSINGLE_FILE=1',        # <-- embeds WASM as base64 in the JS glue
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=16777216',
    '-sSTACK_SIZE=2097152',
    '-sFILESYSTEM=0',
    '-sASSERTIONS=0'
)
$srcs = @(
    (Join-Path $PSScriptRoot 'legion.c'),
    (Join-Path $PSScriptRoot 'pieces.c'),
    (Join-Path $PSScriptRoot 'wasm_bindings.c')
)
$jsOut = Join-Path $temp 'legion.js'
$emccArgs = @($flags) + @($srcs) + @('-o', $jsOut)
& $emcc @emccArgs
if ($LASTEXITCODE -ne 0) { Write-Error "emcc failed (exit $LASTEXITCODE)" }
$jsSize = (Get-Item $jsOut).Length
Write-Output ("       legion.js (with embedded WASM): {0:N0} bytes" -f $jsSize)

# --- Step 2: bundle JS into one IIFE -----------------------------------------
Write-Output "[2a/3] Bundling worker (esbuild)..."
$workerEntry  = Join-Path $temp 'worker.mjs'
$workerBundle = Join-Path $temp 'worker-bundle.js'

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $npx --yes esbuild $workerEntry --bundle --format=iife --minify --platform=browser --target=es2020 --outfile=$workerBundle 2>&1 | Out-Host
$esbuildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($esbuildExit -ne 0) { Write-Error "worker esbuild failed (exit $esbuildExit)" }
Write-Output ("       worker-bundle.js: {0:N0} bytes" -f (Get-Item $workerBundle).Length)

Write-Output "[2b/3] Bundling main app (esbuild)..."
$entryPoint = Join-Path $temp 'app.mjs'
$bundleOut  = Join-Path $temp 'bundle.js'

$ErrorActionPreference = 'Continue'
& $npx --yes esbuild $entryPoint --bundle --format=iife --minify --platform=browser --target=es2020 --outfile=$bundleOut 2>&1 | Out-Host
$esbuildExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($esbuildExit -ne 0) { Write-Error "main esbuild failed (exit $esbuildExit)" }

Write-Output "[2c/3] Injecting worker source (base64) into main bundle..."
$placeholder = '__LEGION_WORKER_SRC_PLACEHOLDER__'
$bundleContent = [System.IO.File]::ReadAllText($bundleOut, [System.Text.UTF8Encoding]::new($false))
$workerBytes   = [System.IO.File]::ReadAllBytes($workerBundle)
# base64 of the raw bytes: always safe to embed inside any JS string literal,
# no escaping concerns no matter what the worker bundle contains.
$workerB64     = [System.Convert]::ToBase64String($workerBytes)
$workerLiteral = "'" + $workerB64 + "'"
$needleDQ = '"' + $placeholder + '"'
$needleSQ = "'" + $placeholder + "'"
$replaced = $false
if ($bundleContent.Contains($needleDQ)) {
    $bundleContent = $bundleContent.Replace($needleDQ, $workerLiteral)
    $replaced = $true
} elseif ($bundleContent.Contains($needleSQ)) {
    $bundleContent = $bundleContent.Replace($needleSQ, $workerLiteral)
    $replaced = $true
}
if (-not $replaced) {
    Write-Error "placeholder not found in main bundle - was wasm.mjs edited?"
}
[System.IO.File]::WriteAllText($bundleOut, $bundleContent, [System.Text.UTF8Encoding]::new($false))
$bundleSize = (Get-Item $bundleOut).Length
Write-Output ("       bundle.js (with embedded base64 worker): {0:N0} bytes" -f $bundleSize)
$bundleSize = (Get-Item $bundleOut).Length
Write-Output ("       bundle.js: {0:N0} bytes" -f $bundleSize)

# --- Step 3: inline into HTML ------------------------------------------------
Write-Output "[3/3] Inlining CSS + JS into HTML..."
# IMPORTANT: read with -Encoding utf8 so multi-byte chars (·, —, etc.) don't
# get reinterpreted as Windows-1252 and re-encoded into mojibake.
$htmlTemplate = Get-Content (Join-Path $temp 'index.html') -Raw -Encoding utf8
$css = Get-Content (Join-Path $temp 'style.css') -Raw -Encoding utf8
$js  = Get-Content $bundleOut -Raw -Encoding utf8

# IMPORTANT: use literal String.Replace, NOT PowerShell's -replace operator.
# -replace interprets $1, $2, $& as regex backreferences inside the replacement
# string, which would mangle $(...) patterns in the bundled JS and drop large
# chunks of the script body.
$linkTag   = '<link rel="stylesheet" href="./style.css" />'
$scriptTag = '<script type="module" src="./app.mjs"></script>'
$cssBlock  = "<style>`n" + $css + "`n</style>"
$jsBlock   = "<script>`n" + $js + "`n</script>"
$html = $htmlTemplate.Replace($linkTag, $cssBlock).Replace($scriptTag, $jsBlock)

$outFile = Join-Path $dist 'legion-solver.html'
[System.IO.File]::WriteAllText($outFile, $html, [System.Text.UTF8Encoding]::new($false))
$outSize = (Get-Item $outFile).Length
Write-Output ""
Write-Output ("Built: {0}" -f $outFile)
Write-Output ("Size:  {0:N0} bytes ({1:N1} KB)" -f $outSize, ($outSize / 1024))

if (-not $KeepTemp) { Remove-Item -Recurse -Force $temp }
