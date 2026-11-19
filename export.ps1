# Copies this computer's Claude Code setup into this repo.
# Run it on the computer where you added new skills or plugins, then push.
#   powershell -ExecutionPolicy Bypass -File export.ps1 -Push
#
# Never copied: your login (.credentials.json), chat history, caches.
param([switch]$Push)

$ErrorActionPreference = 'Continue'
$repo   = $PSScriptRoot
$claude = Join-Path $HOME '.claude'
$encHome = $HOME -replace '[^A-Za-z0-9]', '-'

function Copy-Tree($src, $dst) {
  if (-not (Test-Path $src)) { return }
  # /MIR keeps the repo copy identical; linked skill folders are copied as real files.
  robocopy $src $dst /MIR /XD .git node_modules __pycache__ .venv /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Warning "Copy failed: $src" }
}

function Write-Json($obj, $path) {
  $json = $obj | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
}

Write-Host 'Copying skills, agents and commands...'
foreach ($d in 'skills', 'agents', 'commands') { Copy-Tree "$claude\$d" "$repo\$d" }
if (Test-Path "$claude\CLAUDE.md") { Copy-Item "$claude\CLAUDE.md" "$repo\CLAUDE.md" -Force }

Write-Host 'Reading plugins and marketplaces...'
$settings = Get-Content "$claude\settings.json" -Raw | ConvertFrom-Json
$known = $null
if (Test-Path "$claude\plugins\known_marketplaces.json") {
  $known = Get-Content "$claude\plugins\known_marketplaces.json" -Raw | ConvertFrom-Json
}

$marketplaces = [ordered]@{}
$sources = @()
if ($settings.extraKnownMarketplaces) { $sources += $settings.extraKnownMarketplaces.PSObject.Properties }
if ($known) { $sources += $known.PSObject.Properties }
if (Test-Path "$repo\local-plugins") { Remove-Item "$repo\local-plugins" -Recurse -Force }
foreach ($m in $sources) {
  if ($marketplaces.Contains($m.Name)) { continue }
  $src = $m.Value.source
  if ($src.source -eq 'directory') {
    # Plugins that only exist on this computer travel inside the repo.
    Copy-Tree $src.path "$repo\local-plugins\$($m.Name)"
    $marketplaces[$m.Name] = [ordered]@{ source = 'directory'; local = $m.Name }
  } elseif ($src.source -eq 'github') {
    $marketplaces[$m.Name] = [ordered]@{ source = 'github'; repo = $src.repo }
  } elseif ($src.source -eq 'git') {
    $marketplaces[$m.Name] = [ordered]@{ source = 'git'; url = $src.url }
  }
}

Write-Host 'Reading MCP servers...'
$mcp = $null
try {
  $mcp = (Get-Content "$HOME\.claude.json" -Raw | ConvertFrom-Json).mcpServers
} catch {
  # Windows PowerShell rejects keys that differ only by case; Python reads the file fine.
  $py = "import json,os;print(json.dumps(json.load(open(os.path.expanduser('~/.claude.json'))).get('mcpServers',{})))"
  $mcp = (python -c $py) | ConvertFrom-Json
}
$servers = [ordered]@{}
if ($mcp) {
  foreach ($s in $mcp.PSObject.Properties) {
    $cfg = $s.Value
    $hasEnv     = $cfg.env -and @($cfg.env.PSObject.Properties).Count -gt 0
    $hasHeaders = $cfg.headers -and @($cfg.headers.PSObject.Properties).Count -gt 0
    if ($hasEnv -or $hasHeaders) {
      Write-Warning "Skipped MCP server '$($s.Name)': it holds keys or tokens. Add it by hand on the other computer."
      continue
    }
    # A command installed under this user's folder becomes a plain name found on PATH.
    if ($cfg.command -and $cfg.command.StartsWith($HOME, 'OrdinalIgnoreCase')) {
      $cfg.command = [IO.Path]::GetFileNameWithoutExtension($cfg.command)
    }
    $servers[$s.Name] = $cfg
  }
}

$enabled = [ordered]@{}
if ($settings.enabledPlugins) {
  foreach ($p in $settings.enabledPlugins.PSObject.Properties) { $enabled[$p.Name] = $p.Value }
}

Write-Json ([ordered]@{
  marketplaces   = $marketplaces
  enabledPlugins = $enabled
  mcpServers     = $servers
  theme          = $settings.theme
}) "$repo\manifest.json"

Write-Host 'Copying memory...'
if (Test-Path "$repo\memory") { Remove-Item "$repo\memory" -Recurse -Force }
Get-ChildItem "$claude\projects" -Directory | ForEach-Object {
  $mem = Join-Path $_.FullName 'memory'
  if (Test-Path $mem) {
    # Store folder names without the Windows user name so they map onto any computer.
    $key = $_.Name
    if ($key.StartsWith($encHome)) { $key = 'HOME' + $key.Substring($encHome.Length) }
    Copy-Tree $mem "$repo\memory\$key"
  }
}

Write-Host 'Export done.'
if ($Push) {
  git -C $repo add -A
  git -C $repo commit -m "Sync from $env:COMPUTERNAME on $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git -C $repo push
}
