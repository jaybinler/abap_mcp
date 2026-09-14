$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$catalog = node -e "const fs=require('fs');const tools=fs.readdirSync('dist/handlers').filter(f=>f.endsWith('Handlers.js')).flatMap(f=>Object.values(require('./dist/handlers/'+f)).filter(C=>typeof C==='function' && typeof C.prototype?.getTools==='function').flatMap(C=>new C(null).getTools().map(t=>({name:t.name,description:t.description}))));const m=JSON.parse(fs.readFileSync('manifest.json','utf8'));m.tools=tools;m.version=JSON.parse(fs.readFileSync('package.json','utf8')).version;fs.writeFileSync('manifest.json',JSON.stringify(m,null,2));"
if ($LASTEXITCODE -ne 0) { throw 'Tool catalog failed' }
$root = (Get-Location).Path
$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$manifest.version = (Get-Content package.json -Raw | ConvertFrom-Json).version


$stage = Join-Path ([IO.Path]::GetTempPath()) ('dassian-mcpb-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath dist -Destination $stage -Recurse
foreach ($file in @('package.json','package-lock.json','manifest.json','README.md','LICENSE')) { Copy-Item -LiteralPath $file -Destination $stage }
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') | Out-Null
Get-ChildItem scripts -Filter '*.py' | Copy-Item -Destination (Join-Path $stage 'scripts')
Push-Location -LiteralPath $stage
try {
  npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed' }
} finally { Pop-Location }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = $stage + '.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($file in Get-ChildItem dist -File -Recurse) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\','/')
    $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $relative }
    if (!$entry) { throw "Missing file: $relative" }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
    finally { $stream.Dispose(); $sha.Dispose() }
    $localSha = [Security.Cryptography.SHA256]::Create()
    try { $localHash = [BitConverter]::ToString($localSha.ComputeHash([IO.File]::ReadAllBytes($file.FullName))).Replace('-','') } finally { $localSha.Dispose() }
    if ($hash -ne $localHash) { throw "Hash mismatch: $relative" }
  }
} finally { $zip.Dispose() }
Copy-Item -LiteralPath $archive -Destination (Join-Path $root 'dassian-adt.mcpb') -Force
Write-Host "Verified $($manifest.version): $($manifest.tools.Count) tools; all compiled file hashes match."
Write-Host "Staging retained: $stage"
