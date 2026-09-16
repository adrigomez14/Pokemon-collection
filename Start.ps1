param([switch]$Build, [switch]$Check)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $portableRoot = Join-Path $env:LOCALAPPDATA 'pokemon-collection-tools'
    $portable = Get-ChildItem -Path $portableRoot -Filter 'node-*-win-x64' -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($portable) { $env:PATH = "$($portable.FullName);$env:PATH" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Instala Node.js 24 LTS desde https://nodejs.org y vuelve a abrir la terminal.'
}
if (-not (Test-Path 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
}
if ($Check) {
    & npm.cmd run lint
    if ($LASTEXITCODE -ne 0) { throw 'Error de analisis estatico.' }
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Han fallado las pruebas.' }
    & npm.cmd run build
} elseif ($Build) {
    & npm.cmd run build
} else {
    Write-Host 'Pokefolio: abre http://localhost:5173. Pulsa Ctrl+C para detener.'
    & npm.cmd run dev -- --host localhost --port 5173 --strictPort
}
if ($LASTEXITCODE -ne 0) { throw 'La operacion no se completo correctamente.' }