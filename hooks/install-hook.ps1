# Install E.D.I.T.H. Git Hook
# ===========================
# Run this script to install the post-commit hook

$hookSource = Join-Path $PSScriptRoot "post-commit.ps1"
$gitHooksDir = Join-Path (git rev-parse --show-toplevel) ".git\hooks"
$hookDest = Join-Path $gitHooksDir "post-commit"

Write-Host ""
Write-Host "🤖 E.D.I.T.H. Git Hook Installer" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if .git exists
if (-not (Test-Path $gitHooksDir)) {
    Write-Host "❌ Error: .git/hooks directory not found." -ForegroundColor Red
    Write-Host "   Make sure you're in a Git repository." -ForegroundColor Yellow
    exit 1
}

# Create the hook file that calls our PowerShell script
$hookContent = @"
#!/bin/sh
# E.D.I.T.H. Post-Commit Hook - Calls PowerShell script
powershell.exe -ExecutionPolicy Bypass -File "`$(git rev-parse --show-toplevel)/hooks/post-commit.ps1"
"@

try {
    # Write the hook file
    Set-Content -Path $hookDest -Value $hookContent -Encoding UTF8 -NoNewline
    
    Write-Host "✅ Post-commit hook installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "   Location: $hookDest" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   EDITH will now analyze your commits automatically." -ForegroundColor White
    Write-Host "   Make sure the EDITH server is running on localhost:3000" -ForegroundColor Yellow
    Write-Host ""
} catch {
    Write-Host "❌ Error installing hook: $_" -ForegroundColor Red
    exit 1
}
