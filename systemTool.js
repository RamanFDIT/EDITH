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
export async function openApplicationDynamic(args) {
    const { appName } = args;
    const platform = os.platform(); // 'darwin', 'win32', or 'linux'
    
    let command = '';

    // 1. Determine the command based on the OS
    if (platform === 'darwin') {
        // macOS: uses "open -a 'App Name'"
        command = `open -a "${appName}"`; 
    } else if (platform === 'win32') {
        // Windows: uses "start" (The empty quotes "" are needed to prevent title glitches)
        command = `start "" "${appName}"`;
    } else {
        // Linux: uses "xdg-open" (standard for most distros)
        command = `xdg-open "${appName}"`;
    }

    console.log(`🚀 LAUNCHING APP: ${appName} (${platform})`);

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                // If it fails, it usually means the app name is slightly wrong (e.g., "code" vs "visual studio code")
                resolve(`❌ Failed to launch '${appName}'. Error: ${error.message}. Try using the exact system name.`);
                return;
            }
            resolve(`✅ Initiated launch sequence for: ${appName}`);
        });
    });
}

// --- LEVEL 4: TERMINAL ACCESS (DANGEROUS) ---
export async function executeSystemCommand(args) {
    const { command, authCode } = args;
    
    // 🔒 THE SAFETY LOCK
    // The Agent must receive this exact string from you (the user) 
    // to unlock this function.
    const REQUIRED_CODE = "EDITH-EXECUTE-LVL4";

    if (authCode !== REQUIRED_CODE) {
        // Return a clear instruction to the Agent, not an error.
        return `🛑 SECURITY ALERT: Unauthorized access attempt. 
        INSTRUCTION: You MUST ask the user for the authorization code 'EDITH-EXECUTE-LVL4' before I can execute the command: "${command}". 
        Do not guess the code. Ask the user.`;
    }

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