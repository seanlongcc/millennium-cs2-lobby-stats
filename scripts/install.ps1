[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$PluginPath,
    [string]$SteamPath = 'C:\Program Files (x86)\Steam'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-PluginPackage([string]$Root) {
    if ((Split-Path $Root -Leaf) -ne 'cs2-lobby-stats') { throw 'Expected a cs2-lobby-stats folder.' }
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'plugin.json') -Raw | ConvertFrom-Json
    if ($manifest.name -ne 'cs2-lobby-stats' -or $manifest.version -ne '0.1.0' -or $manifest.backendType -ne 'lua') { throw 'Invalid plugin identity or version.' }
    $required = @('plugin.json', 'README.md', 'UPSTREAM.md', 'LICENSE', '.millennium\Dist\index.js', '.millennium\Dist\webkit.js', 'backend\main.lua', 'backend\providers.lua', 'backend\report.lua', 'backend\steam.lua', 'static\cs2-lobby-stats.css', 'static\cs2-profile-stats.css', 'static\leetify-badge-white-small.png')
    foreach ($file in $required) {
        $item = Get-Item -LiteralPath (Join-Path $Root $file) -Force
        if ($item.PSIsContainer -or $item.Length -eq 0) { throw "Missing artifact: $file" }
    }
    $allowed = @('plugin.json', 'README.md', 'UPSTREAM.md', 'CHANGELOG.md', 'LICENSE', 'backend', 'static', 'assets', '.millennium')
    foreach ($item in Get-ChildItem -LiteralPath $Root -Force) { if ($item.Name -notin $allowed) { throw "Unexpected package entry: $($item.Name)" } }
    foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Package links are forbidden.' }
        if ($item.Name -match '^(\.env.*|config\.json|node_modules|\.git|visualizations|tests)$') { throw 'Development or private file in package.' }
    }
}

$source = [IO.Path]::GetFullPath($PluginPath).TrimEnd('\', '/')
$steam = [IO.Path]::GetFullPath($SteamPath)
Assert-PluginPackage $source
$millennium = Join-Path $steam 'millennium'
$plugins = Join-Path $millennium 'plugins'
$target = Join-Path $plugins 'cs2-lobby-stats'
foreach ($directory in @($millennium, $plugins, $target)) {
    if (Test-Path -LiteralPath $directory) {
        if (((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing a linked installation destination.' }
    }
}
if (Test-Path -LiteralPath $target) {
    $existing = Get-Content -LiteralPath (Join-Path $target 'plugin.json') -Raw | ConvertFrom-Json
    if ($existing.name -ne 'cs2-lobby-stats') { throw 'Destination belongs to another plugin.' }
}
if (-not $PSCmdlet.ShouldProcess($target, 'Install CS2 Lobby Stats with backup')) { return }

$token = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$stageRoot = Join-Path $millennium ('.tracker-stage-' + $token)
$staged = Join-Path $stageRoot 'cs2-lobby-stats'
$backup = Join-Path (Join-Path $millennium 'backups') ('cs2-lobby-stats-' + $token)
$backedUp = $false
$installed = $false
try {
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -Recurse -Force
    Assert-PluginPackage $staged
    New-Item -ItemType Directory -Path $plugins -Force | Out-Null
    if (Test-Path -LiteralPath $target) {
        New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
        Move-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
        $backedUp = $true
    }
    Move-Item -LiteralPath $staged -Destination $target -ErrorAction Stop
    $installed = $true
    Assert-PluginPackage $target
}
catch {
    if ($installed -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Recurse -Force }
    if ($backedUp -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $backup -Destination $target -ErrorAction Stop }
    throw
}
finally {
    if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
}
Write-Output "Installed: $target"
if ($backedUp) { Write-Output "Backup: $backup" }
Write-Output 'Enable CS2 Lobby Stats in Millennium. Restart Steam when ready; this installer does not stop it.'
