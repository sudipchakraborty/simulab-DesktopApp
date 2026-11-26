<# .SYNOPSIS Build a native Windows application folder and Python wheel. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$pythonExecutable = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) { & (Join-Path $PSScriptRoot 'Setup.ps1') }
Push-Location $PSScriptRoot
try {
    & $pythonExecutable -m pip install 'pyinstaller>=6.11,<7' build
    if ($LASTEXITCODE -ne 0) { throw 'Packaging dependency installation failed.' }
    & $pythonExecutable -m build --wheel
    if ($LASTEXITCODE -ne 0) { throw 'Wheel build failed.' }
    & $pythonExecutable -m PyInstaller --noconfirm --windowed --onedir --name SimuLabDesktop --collect-data simulab_desktop --specpath build 'scripts\desktop_entry.py'
    if ($LASTEXITCODE -ne 0) { throw 'Native executable build failed.' }
    Copy-Item -LiteralPath 'README.md' -Destination 'dist\SimuLabDesktop\README.md' -Force
    Write-Host 'Built dist\SimuLabDesktop\SimuLabDesktop.exe (keep the whole folder together).'
} finally { Pop-Location }
