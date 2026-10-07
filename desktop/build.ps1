$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js LTS first: https://nodejs.org' }
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'Install the .NET 8 SDK first: https://dotnet.microsoft.com/download/dotnet/8.0' }
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    dotnet publish "$PSScriptRoot/Groove.Windows/Groove.Windows.csproj" -c Release -r win-x64 --self-contained true -o "$PSScriptRoot/publish"
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
    $downloads = Join-Path $root 'public/downloads'
    New-Item -ItemType Directory -Path $downloads -Force | Out-Null
    Compress-Archive -Path "$PSScriptRoot/publish/*" -DestinationPath "$downloads/Groove-Windows-x64.zip" -Force
    Write-Host "Portable ZIP: $downloads/Groove-Windows-x64.zip"
    Write-Host "Groove is ready: $PSScriptRoot\publish\Groove.exe"
    Write-Host 'Keep all publish folder files together. Microsoft Edge WebView2 Runtime must be installed.'
} finally {
    Pop-Location
}
