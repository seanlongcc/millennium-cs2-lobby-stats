[CmdletBinding()]
param([switch]$SkipBuild)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'plugin.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne 'cs2-lobby-stats' -or $manifest.version -ne '0.1.0' -or $manifest.version -ne $package.version) { throw 'Plugin identity/version mismatch.' }
if (-not $SkipBuild) {
    Push-Location $repositoryRoot
    try {
        pnpm typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Type-check failed.' }
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    finally { Pop-Location }
}
$dist = Join-Path $repositoryRoot 'dist'
$stage = Join-Path $dist ('.staging-' + [Guid]::NewGuid().ToString('N'))
$plugin = Join-Path $stage 'cs2-lobby-stats'
$archive = Join-Path $dist 'cs2-lobby-stats-v0.1.0.zip'
try {
    New-Item -ItemType Directory -Path (Join-Path $plugin '.millennium\Dist') -Force | Out-Null
    foreach ($file in @('plugin.json','README.md','UPSTREAM.md','CHANGELOG.md','LICENSE')) { Copy-Item -LiteralPath (Join-Path $repositoryRoot $file) -Destination $plugin }
    foreach ($folder in @('backend','static','assets')) { Copy-Item -LiteralPath (Join-Path $repositoryRoot $folder) -Destination $plugin -Recurse }
    foreach ($file in @('index.js','webkit.js')) { Copy-Item -LiteralPath (Join-Path $repositoryRoot ('.millennium\Dist\' + $file)) -Destination (Join-Path $plugin '.millennium\Dist') }
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
}
finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
Write-Output $archive
