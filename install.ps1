# Installs this Claude Code setup on the computer you run it on.
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Safe to run again after a git pull: it adds and updates, and never deletes
# skills or settings you already have.
param([switch]$SkipPlaywright)

$ErrorActionPreference = 'Continue'
$repo   = $PSScriptRoot
$claude = Join-Path $HOME '.claude'
$encHome = $HOME -replace '[^A-Za-z0-9]', '-'
$localPlugins = Join-Path $HOME 'claude-local-plugins'
New-Item -ItemType Directory -Force $claude | Out-Null

function Copy-Tree($src, $dst) {
  if (-not (Test-Path $src)) { return }
  robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Warning "Copy failed: $src" }
}

function Set-Prop($obj, $name, $value) {
  if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
  else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Write-Json($obj, $path) {
  $json = $obj | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
}

# Windows PowerShell 5 drops double quotes inside arguments to programs; escape them.
function Quote-Arg([string]$s) {
  if ($PSVersionTable.PSVersion -lt [version]'7.3') { return $s -replace '"', '\"' }
  return $s
}

$manifest = Get-Content "$repo\manifest.json" -Raw | ConvertFrom-Json

Write-Host '1/5 Skills, agents and commands'
foreach ($d in 'skills', 'agents', 'commands') { Copy-Tree "$repo\$d" "$claude\$d" }
if ((Test-Path "$repo\CLAUDE.md") -and -not (Test-Path "$claude\CLAUDE.md")) {
  Copy-Item "$repo\CLAUDE.md" "$claude\CLAUDE.md"
}

Write-Host '2/5 Plugins'
Copy-Tree "$repo\local-plugins" $localPlugins
$markets = @{}
foreach ($m in $manifest.marketplaces.PSObject.Properties) {
  $v = $m.Value
  switch ($v.source) {
    'directory' { $markets[$m.Name] = [ordered]@{ source = [ordered]@{ source = 'directory'; path = (Join-Path $localPlugins $v.local) } } }
    'github'    { $markets[$m.Name] = [ordered]@{ source = [ordered]@{ source = 'github'; repo = $v.repo } } }
    'git'       { $markets[$m.Name] = [ordered]@{ source = [ordered]@{ source = 'git'; url = $v.url } } }
  }
}

# Record the marketplaces and plugins in settings.json, keeping anything already there.
$settingsPath = "$claude\settings.json"
if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.bak" -Force
  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
} else {
  $settings = New-Object PSObject
}
if (-not $settings.PSObject.Properties['extraKnownMarketplaces']) { Set-Prop $settings 'extraKnownMarketplaces' (New-Object PSObject) }
if (-not $settings.PSObject.Properties['enabledPlugins'])         { Set-Prop $settings 'enabledPlugins' (New-Object PSObject) }
foreach ($name in $markets.Keys) {
  if ($name -ne 'claude-plugins-official') { Set-Prop $settings.extraKnownMarketplaces $name $markets[$name] }
}
foreach ($p in $manifest.enabledPlugins.PSObject.Properties) { Set-Prop $settings.enabledPlugins $p.Name $p.Value }
if ($manifest.theme -and -not $settings.PSObject.Properties['theme']) { Set-Prop $settings 'theme' $manifest.theme }
Write-Json $settings $settingsPath

$cli = Get-Command claude -ErrorAction SilentlyContinue
if ($cli) {
  foreach ($name in $markets.Keys) {
    $s = $markets[$name].source
    $arg = switch ($s.source) { 'directory' { $s.path } 'github' { $s.repo } 'git' { $s.url } }
    & claude plugin marketplace add $arg 2>&1 | Out-Host
  }
  foreach ($p in $manifest.enabledPlugins.PSObject.Properties) {
    if ($p.Value) { & claude plugin install $p.Name --scope user 2>&1 | Out-Host }
  }
} else {
  Write-Warning "The 'claude' command was not found. Plugins are listed in settings.json; see README if they don't appear."
}

Write-Host '3/5 MCP servers'
if ($cli) {
  foreach ($s in $manifest.mcpServers.PSObject.Properties) {
    $json = $s.Value | ConvertTo-Json -Depth 10 -Compress
    & claude mcp add-json $s.Name (Quote-Arg $json) --scope user 2>&1 | Out-Host
  }
} else {
  Write-Warning 'Skipped MCP servers (no claude command). See README.'
}

Write-Host '4/5 Memory'
if (Test-Path "$repo\memory") {
  Get-ChildItem "$repo\memory" -Directory | ForEach-Object {
    $key = $_.Name
    if ($key.StartsWith('HOME')) { $key = $encHome + $key.Substring(4) }
    Copy-Tree $_.FullName "$claude\projects\$key\memory"
  }
}

Write-Host '5/5 Playwright (screenshots for the MotionSites skill)'
if ($SkipPlaywright) {
  Write-Host 'Skipped.'
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m pip install --user --quiet playwright
  python -m playwright install chromium
} else {
  Write-Warning 'Python not found, so Playwright was skipped. Install Python 3, then run install.ps1 again.'
}

Write-Host ''
Write-Host 'Done. Quit and reopen Claude so it loads everything.'
