<#
.SYNOPSIS
    Serve solver/web on http://localhost:<port>/ for local browser testing.

.DESCRIPTION
    Wraps Python's http.server. Required because WASM cannot be loaded via file:// .
    Stops on Ctrl-C.
#>
param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) {
    $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Error "python not found in PATH."
}

Write-Output "Serving $PSScriptRoot at http://localhost:$Port/"
Write-Output "Open: http://localhost:$Port/index.html"
Write-Output "Ctrl-C to stop."
& $python (Join-Path $PSScriptRoot '_serve.py') $Port
