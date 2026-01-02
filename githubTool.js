import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// FIX: Check for GITHUB_TOKEN (matches README) OR GITHUB_PAT (common backup)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;

export async function getRepoIssues(args) {
  console.log("🔍 GitHub Tool Invoked with:", JSON.stringify(args));
  
  const { owner, repo } = args;

  if (!GITHUB_TOKEN) {
    console.error("❌ E.D.I.T.H. Tool Error: Missing GitHub Token.");
    throw new Error('GitHub Token not found in .env file (Checked GITHUB_TOKEN and GITHUB_PAT).');
  }
  if (!owner || !repo) {
    throw new Error('Both "owner" and "repo" parameters are required.');
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
  console.log(`🔍 Accessing GitHub: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json', 
        'X-GitHub-Api-Version': '2022-11-28'     
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API Error! Status: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ Success. Found ${data.length} issues.`);
    
    // Simplify the data to save tokens
    const simplifiedIssues = data.map(issue => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.html_url,
      // Fix: Handle null body gracefully
      body: issue.body ? issue.body.substring(0, 200) + "..." : "No description",
      user: issue.user ? issue.user.login : 'unknown'
    }));

    return JSON.stringify(simplifiedIssues);

  } catch (error) {
    console.error('❌ Network Error in GitHub Tool:', error);
    return `Error fetching GitHub issues: ${error.message}`;
  }
}