import { getRepoChecks } from './githubTool.js';
import './envConfig.js';

async function runTest() {
    console.log("🔍 Testing getRepoChecks Function...");

    // Get args from command line or use defaults
    // Usage: node testGithubChecks.js <owner> <repo> <ref>
    const args = process.argv.slice(2);
    
    // Default to a known repo with checks (e.g. VS Code) if no args provided
    const owner = args[0] || 'microsoft';
    const repo = args[1] || 'vscode';
    const ref = args[2] || 'main';

    console.log(`\n📋 Parameters:
    Owner: ${owner}
    Repo:  ${repo}
    Ref:   ${ref}
    `);

    try {
        console.log("⏳ Fetching checks...");
        const response = await getRepoChecks({ owner, repo, ref });
        
        // The tool returns a JSON string, so we try to parse it to verify
        // If it starts with "Error", it failed.
        if (response.startsWith("Error")) {
            console.error("❌ Test Failed:", response);
            return;
        }

        const data = JSON.parse(response);
        console.log("✅ Success!");
        
        const count = data.total_count !== undefined ? data.total_count : (data.check_runs ? data.check_runs.length : 'Unknown');
        console.log(`📊 Total Check Runs: ${count}`);

        if (data.check_runs && data.check_runs.length > 0) {
            console.log("\nRecent Checks:");
            data.check_runs.slice(0, 5).forEach(check => {
                console.log(` - [${check.conclusion || 'pending'}] ${check.name} (${check.status})`);
            });
        } else {
            console.log("Response structure:", Object.keys(data));
        }

    } catch (err) {
        console.error("💥 Exception:", err);
    }
}

runTest();
