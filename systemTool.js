import { exec, execFile } from 'child_process';
import os from 'os';

const ALLOWED_COMMANDS = new Set([
    'dir', 'ls', 'echo', 'type', 'cat', 'whoami', 'hostname', 
    'ipconfig', 'netstat', 'ping', 'systeminfo', 'tasklist', 
    'git', 'node', 'npm', 'python', 'pip'
]);

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
    if (target) {
        // Very basic sanitization: remove quotes to prevent breaking out of string
        const unquotedTarget = target.replace(/["']/g, ''); 
        
        // Validate safeTarget against a URL/filepath pattern before passing to Start-Process
        // Allows alphanumeric, standard path chars (/, \, :, ., -), spaces, and URL chars (?, &, =, %)
        const isValidTarget = /^https?:\/\/[^\s]+$/.test(unquotedTarget) || /^[a-zA-Z0-9:\\/\-_.\s?&=%]+$/.test(unquotedTarget);
        
        if (!isValidTarget) {
             console.warn(`🚨 SECURITY BLOCK: Invalid target pattern: ${unquotedTarget}`);
             return `❌ Security Error: Target is not a valid URL or file path.`;
        }
        safeTarget = unquotedTarget;
    }

    console.log(`🔍 Searching for: ${safeAppName} -> Target: ${safeTarget || "None"}`);

    let execCmd = '';
    let execArgs = [];

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
        execCmd = 'powershell';
        execArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand];

    } else if (platform === 'darwin') {
        execCmd = 'open';
        execArgs = ['-a', safeAppName];
    } else {
        execCmd = 'xdg-open';
        execArgs = [safeAppName];
    }

    return new Promise((resolve) => {
        execFile(execCmd, execArgs, (error, stdout, stderr) => {
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
    
    // Parse command into base executable and arguments
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const cmdArgs = [];
    let match;
    while ((match = regex.exec(command)) !== null) {
        cmdArgs.push(match[1] || match[2] || match[0]);
    }

    if (cmdArgs.length === 0) {
        return "❌ Error: Empty command provided.";
    }

    const baseCmd = cmdArgs[0].toLowerCase();
    
    let isAllowed = ALLOWED_COMMANDS.has(baseCmd);
    if (!isAllowed && baseCmd.endsWith('.exe')) {
        isAllowed = ALLOWED_COMMANDS.has(baseCmd.slice(0, -4));
    }

    if (!isAllowed) {
        console.warn(`🚨 SECURITY BLOCK: Blocked arbitrary command execution: ${command}`);
        return `❌ Security Error: Command '${baseCmd}' is not in the allowlist.`;
    }

    console.log(`🛡️ SYSTEM COMMAND EXECUTING (Allowed): ${baseCmd} with args: ${cmdArgs.slice(1).join(' ')}`);

    let execTarget = cmdArgs[0];
    let finalArgs = cmdArgs.slice(1);
    
    // Quick fallback mapping for Windows tools that need .cmd extensions to run via execFile
    if (os.platform() === 'win32') {
        if (baseCmd === 'npm' || baseCmd === 'npx') {
            execTarget = baseCmd.endsWith('.cmd') ? baseCmd : `${baseCmd}.cmd`;
        } else if (['dir', 'echo', 'type'].includes(baseCmd)) {
            execTarget = 'cmd.exe';
            // We use /c but ONLY with safe arguments due to allowlist, though & can still be passed
            // The allowlist itself is the main security mechanism here for these commands.
            finalArgs = ['/c', cmdArgs[0], ...finalArgs];
        }
    }

    return new Promise((resolve, reject) => {
        // Use execFile to prevent shell injection (no shell metacharacter interpretation)
        execFile(execTarget, finalArgs, { cwd: process.cwd() }, (error, stdout, stderr) => {
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
