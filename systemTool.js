import { exec } from 'child_process';
import os from 'os';

// --- LEVEL 1: READ ONLY (SAFE) ---
export async function getSystemStatus() {
    return JSON.stringify({
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        freeMem: (os.freemem() / 1024 / 1024).toFixed(0) + " MB",
        uptime: (os.uptime() / 3600).toFixed(1) + " Hrs"
    });
}
// --- LEVEL 2: OPEN APPLICATIONS (MODERATE RISK) ---
export async function openApplication(args) {
    const { appName, target } = args; // Now accepting optional 'target'
    const platform = os.platform(); 
    
    // Sanitize appName to prevent command injection (basic alpha-numeric + spaces)
    const safeAppName = appName.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    let safeTarget = "";

    // If target is provided (e.g. a URL or a file path), we need to handle it safely
    // We allow basic URL chars and common file path chars
    if (target) {
        // Very basic sanitization: remove quotes to prevent breaking out of string
        safeTarget = target.replace(/["']/g, ''); 
    }

    console.log(`🔍 Searching for: ${safeAppName} -> Target: ${safeTarget || "None"}`);

    let command = '';

    if (platform === 'win32') {
        // ROBUST WINDOWS SEARCH STRATEGY
        // 1. Search Registry 'App Paths' (High reliability for known apps like 'excel', 'chrome')
        // 2. Search Start Menu Shortcuts (Good for 'Visual Studio Code', 'Spotify')
        // 3. Search PATH (Good for 'notepad', 'calc')
        
        const psScript = `
        $appName = "${safeAppName}";
        $target = "${safeTarget}";
        $foundPath = $null;

        # 1. Check Registry App Paths
        $regKeys = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths", "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths";
        foreach ($key in $regKeys) {
            if (Test-Path $key) {
                # Find subkey that matches input (e.g. 'chrome' matches 'chrome.exe')
                $match = Get-ChildItem $key -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "*$appName*" } | Select-Object -First 1;
                if ($match) { 
                    $foundPath = (Get-ItemProperty $match.PSPath).'(default)';
                    break; 
                }
            }
        }

        # 2. Check Start Menu Shortcuts
        if (-not $foundPath) {
            $startMenuPaths = @(
                "C:\\ProgramData\\Microsoft\\Windows\\Start Menu",
                "$env:APPDATA\\Microsoft\\Windows\\Start Menu"
            );
            $foundPath = Get-ChildItem -Path $startMenuPaths -Recurse -Include *.lnk -ErrorAction SilentlyContinue | 
                Where-Object { 
                    # Match ignoring case and hyphens/spaces
                    ($_.BaseName -replace '[^a-zA-Z0-9]', '') -like "*$($appName -replace '[^a-zA-Z0-9]', '')*"
                } | 
                Select-Object -ExpandProperty FullName -First 1;
        }

        # 3. Check System PATH (Get-Command)
        if (-not $foundPath) {
            # Try exact match first
            $cmd = Get-Command $appName -ErrorAction SilentlyContinue;
            if (-not $cmd) {
                 # Try appending .exe if missing
                 $cmd = Get-Command "$appName.exe" -ErrorAction SilentlyContinue;
            }
            if ($cmd) { $foundPath = $cmd.Source }
        }

        # EXECUTE
        if ($foundPath) {
            Write-Output "Found: $foundPath";
            
            if ($target) {
                 # If we have a target (URL/File), force Start-Process with ArgumentList
                 # This is better than Invoke-Item for passing args
                 Start-Process -FilePath "$foundPath" -ArgumentList "$target"
            } else {
                 # Invoke-Item (Double Click equivalent)
                 Invoke-Item "$foundPath"
            }
            
        } else {
             # FINAL FALLBACK
             try {
                if ($target) {
                    Start-Process "$appName" -ArgumentList "$target" -ErrorAction Stop
                } else {
                    Start-Process "$appName" -ErrorAction Stop
                }
                Write-Output "Launched via direct command (PATH/ShellExecute)."
             } catch {
                Write-Error "Could not locate '$appName' in Registry, Start Menu, or PATH."
                exit 1
             }
        }
        `;

        // ENCODING STRATEGY: Base64 encode the command to avoid quoting issues
        const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
        command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`;

    } else if (platform === 'darwin') {
        command = `open -a "${safeAppName}"`; 
    } else {
        command = `xdg-open "${safeAppName}"`;
    }

    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve(`❌ Error: Application '${safeAppName}' not found. (Checked Registry, Start Menu, and System PATH).`);
                return;
            }
            resolve(`✅ Launched: ${stdout.trim()}`);
        });
    });
}

// --- LEVEL 4: TERMINAL ACCESS (DANGEROUS) ---
export async function executeSystemCommand(args) {
    const { command } = args;
    
    // 🔒 SAFETY LOCK REMOVED per user request
    console.log(`⚠️ SYSTEM COMMAND EXECUTING: ${command}`);

    return new Promise((resolve, reject) => {
        // 'cwd' ensures we run commands from the project root by default
        exec(command, { cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
                // We resolve errors as strings so the Agent can read them
                resolve(`❌ Command Failed: ${error.message}`);
                return;
            }
            if (stderr) {
                resolve(`⚠️ Stderr Output: ${stderr}`); 
                return;
            }
            resolve(`✅ Output:\n${stdout.trim() || "Done (No output)."}`);
        });
    });
}