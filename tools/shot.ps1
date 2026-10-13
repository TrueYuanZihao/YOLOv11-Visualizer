<#
  开发辅助脚本：用无头 Edge 打开本地页面，截图 / 导出 DOM。
  用法：
    powershell -ExecutionPolicy Bypass -File tools\shot.ps1 -Url "index.html?debug=1&stage=12" -Out shots\s12.png
    powershell -ExecutionPolicy Bypass -File tools\shot.ps1 -Url "index.html" -Dom
#>
param(
  [string]$Url = 'index.html',
  [string]$Out = 'shots\app.png',
  [int]$W = 1680,
  [int]$H = 1000,
  [int]$VirtualTime = 12000,
  [switch]$Dom
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Error 'Edge not found'; exit 1 }

$full = Join-Path $root ($Url -replace '/', '\')
if (-not (Test-Path $full)) { $full = Join-Path $root $Url }
$fileUrl = 'file:///' + ($full -replace '\\', '/')
$ud = Join-Path $root 'shots\ud'
$outPath = Join-Path $root $Out
New-Item -ItemType Directory -Force -Path (Split-Path $outPath -Parent) | Out-Null

$args = @('--headless', '--disable-gpu', '--no-sandbox', "--user-data-dir=$ud",
          "--window-size=$W,$H", "--virtual-time-budget=$VirtualTime")
if ($Dom) {
  $args += '--dump-dom'
  $domFile = [IO.Path]::ChangeExtension($outPath, '.dom.txt')
  Start-Process -FilePath $edge -ArgumentList ($args + $fileUrl) -RedirectStandardOutput $domFile `
    -RedirectStandardError ([IO.Path]::ChangeExtension($outPath, '.err.txt')) -NoNewWindow -Wait
  Write-Host "dom -> $domFile"
  Select-String -Path $domFile -Pattern 'SELFTEST|<div id="errbox"[^>]*>(.{0,600})' -AllMatches |
    ForEach-Object { $_.Line.Trim() } | Select-Object -First 6
} else {
  $args += "--screenshot=$outPath"
  & $edge @args $fileUrl 2>$null | Out-Null
  Write-Host "shot -> $outPath ($((Get-Item $outPath -ErrorAction SilentlyContinue).Length) bytes)"
}
