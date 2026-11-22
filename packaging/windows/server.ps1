# chatbrowser 便携启动器：用 Windows 自带 PowerShell 伺服 dist，
# 不依赖 exe，规避未签名可执行文件的拦截提示。
# 用法：双击 start-chatbrowser.cmd（或右键“使用 PowerShell 运行”）。
param(
  [int]$Port = 17890,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$prefix = "http://127.0.0.1:$Port/"
$healthUrl = $prefix + '__chatbrowser'
# 构建时由 scripts/build-desktop.mjs 替换为实际版本号
$appVersion = '__APP_VERSION__'

# 返回端口上已有实例的版本；无实例返回 $null，旧版（只有 ok）返回空字符串。
function Get-HealthVersion {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -ne 200) { return $null }
    try {
      $data = $response.Content | ConvertFrom-Json
      if ($data.app -eq 'chatbrowser') { return [string]$data.version }
    } catch {}
    if ($response.Content -eq 'ok') { return '' }
    return $null
  } catch {
    return $null
  }
}

function Open-Window {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($browser in $candidates) {
    if (Test-Path $browser) {
      Start-Process -FilePath $browser -ArgumentList "--app=$prefix"
      return
    }
  }
  Start-Process $prefix
}

# 已有实例：同版本直接开窗口；旧版本提示用户先关闭，避免显示旧界面
$existingVersion = Get-HealthVersion
if ($null -ne $existingVersion) {
  if ($existingVersion -eq $appVersion) {
    if (-not $NoOpen) { Open-Window }
    return
  }
  Write-Host "检测到旧版本的对话浏览器仍在运行（端口 $Port）。" -ForegroundColor Yellow
  Write-Host "请先关闭旧版窗口，再重新启动本程序。" -ForegroundColor Yellow
  Read-Host "按回车退出"
  return
}

if (-not (Test-Path (Join-Path $dist 'index.html'))) {
  Write-Host "未找到 dist/index.html，请确认解压完整。" -ForegroundColor Red
  Read-Host "按回车退出"
  return
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.woff2'= 'font/woff2'
  '.woff' = 'font/woff'
  '.json' = 'application/json'
  '.map'  = 'application/json'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "端口 $Port 被占用，无法启动。若旧版对话浏览器仍在运行，请先关闭它。" -ForegroundColor Red
  Read-Host "按回车退出"
  return
}

Write-Host "对话浏览器已启动：$prefix（关闭此窗口即停止服务）"
if (-not $NoOpen) { Open-Window }

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
  } catch {
    break
  }
  $request = $context.Request
  $response = $context.Response
  try {
    $pathPart = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
    if ($pathPart -eq '/__chatbrowser') {
      $payload = '{"app":"chatbrowser","version":"' + $appVersion + '"}'
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
      $response.ContentType = 'application/json'
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.Close()
      continue
    }
    $relative = $pathPart.TrimStart('/')
    if ($relative -eq '') { $relative = 'index.html' }
    $file = Join-Path $dist $relative
    if (-not (Test-Path $file -PathType Leaf)) {
      $file = Join-Path $dist 'index.html'
    }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
    $response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    if ($relative.StartsWith('static/')) {
      $response.Headers.Add('Cache-Control', 'public, max-age=31536000, immutable')
    } else {
      $response.Headers.Add('Cache-Control', 'no-cache')
    }
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
  } catch {
    try { $response.StatusCode = 500; $response.Close() } catch {}
  }
}
