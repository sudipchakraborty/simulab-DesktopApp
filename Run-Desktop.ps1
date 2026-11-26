<# .SYNOPSIS Launch SimuLab Desktop in a hidden-console native Python window. #>
[CmdletBinding()]
param([string]$Project, [switch]$Console, [switch]$NoRestore)
$ErrorActionPreference = 'Stop'
$pythonExecutable = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    & (Join-Path $PSScriptRoot 'Setup.ps1')
}
$applicationArguments = @('-m', 'simulab_desktop')
if ($NoRestore) { $applicationArguments += '--no-restore' }
if ($Project) { $applicationArguments += $Project }
if ($Console) {
    & $pythonExecutable @applicationArguments
} else {
    $pythonWindowExecutable = Join-Path $PSScriptRoot '.venv\Scripts\pythonw.exe'
    $quotedArguments = $applicationArguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
    # pythonw has no console; the requested interactive Qt window must be shown.
    Start-Process -FilePath $pythonWindowExecutable -ArgumentList $quotedArguments -WorkingDirectory $PSScriptRoot -WindowStyle Normal
}
