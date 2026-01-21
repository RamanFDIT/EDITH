# E.D.I.T.H. Post-Commit Hook (Windows PowerShell Version)
# =========================================================
# This hook notifies EDITH after every commit.
#
# INSTALLATION:
# 1. Create a file called "post-commit" (no extension) in .git/hooks/
# 2. Add this single line to it:
#    powershell.exe -ExecutionPolicy Bypass -File "../../hooks/post-commit.ps1"
#
# Or copy this script directly and save as .git/hooks/post-commit (making it executable)

$EDITH_URL = "http://localhost:3000/api/hooks/commit-event"

# Get commit ID
$COMMIT_ID = git rev-parse HEAD

Write-Host "🤖 [E.D.I.T.H.] Analyzing commit $($COMMIT_ID.Substring(0,8))..." -ForegroundColor Cyan

# Call EDITH synchronously (fast enough for post-commit)
try {
    $body = @{ commitId = $COMMIT_ID } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri $EDITH_URL -Method Post -Body $body -ContentType "application/json" -TimeoutSec 5
    
    if ($response.success) {
        Write-Host "🤖 [E.D.I.T.H.] Analyzed: $($response.commit.message)" -ForegroundColor Green
    }
} catch {
    Write-Host "🤖 [E.D.I.T.H.] Server offline. Commit saved locally." -ForegroundColor Yellow
}

exit 0
