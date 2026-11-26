<#
.SYNOPSIS
Create a private Python environment and install the native application.
.DESCRIPTION
Qt Essentials is sufficient; no browser engine is installed by this project.
Node 24+ is required for actual MCU execution. Arduino CLI is optional for custom builds.
#>
[CmdletBinding()]
param([switch]$Development)
$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$pythonExecutable = Join-Path $projectDirectory '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    & python -m venv (Join-Path $projectDirectory '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed. Install Python 3.11+.' }
}
$installTarget = if ($Development) { "$projectDirectory[dev]" } else { $projectDirectory }
& $pythonExecutable -m pip install -e $installTarget
if ($LASTEXITCODE -ne 0) { throw 'Application installation failed.' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { & $nodeCommand.Source --version } else { Write-Warning 'Install Node.js 24+ to execute compiled firmware. Native circuit editing is available now.' }
Write-Host 'Ready. Run .\Run-Desktop.ps1'
