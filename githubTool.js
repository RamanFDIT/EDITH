import fetch from 'node-fetch';
import './envConfig.js';

// Check both variable names to ensure connection
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;

// --- HELPER: Generic Fetcher ---
async function githubFetch(url) {
    if (!GITHUB_TOKEN) throw new Error('GitHub Token not found in .env');
    
    console.log(`🔍 Accessing GitHub: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
        throw new Error(`GitHub Status: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}

// --- REPOSITORY MANAGEMENT (NEW) ---
export async function createRepository(args) {
    console.log("📝 GitHub Create Repo Invoked:", JSON.stringify(args));
    const { name, description, isPrivate } = args;

    if (!GITHUB_TOKEN) throw new Error('GitHub Token not found.');
    if (!name) throw new Error('Repository name is required.');

    try {
        const response = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                description: description || "Created by E.D.I.T.H.",
                private: !!isPrivate
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`GitHub API Error: ${txt}`);
        }

        const data = await response.json();
        return `Success! Created Repository '${data.full_name}'. URL: ${data.html_url}`;
    } catch (error) {
        return `Error creating repository: ${error.message}`;
    }
}

// --- ISSUES ---
export async function getRepoIssues(args) {
  const { owner, repo } = args;
  if (!owner || !repo) throw new Error('Owner and Repo required.');
  try {
    const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/issues`);
    return JSON.stringify(data.map(i => ({ 
        number: i.number, 
        title: i.title, 
        state: i.state, 
        user: i.user.login 
    })));
  } catch (error) {
    return `Error fetching issues: ${error.message}`;
  }
}

export async function createRepoIssue(args) {
    console.log("📝 GitHub Create Issue Invoked:", JSON.stringify(args));
    const { owner, repo, title, body } = args;

    if (!GITHUB_TOKEN) throw new Error('GitHub Token not found.');
    if (!owner || !repo || !title) throw new Error('Owner, Repo, and Title are required.');

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, body: body || "Created by E.D.I.T.H." })
        });

        if (!response.ok) throw new Error(`GitHub API Error: ${await response.text()}`);
        const data = await response.json();
        return `Success! Created Issue #${data.number}. URL: ${data.html_url}`;
    } catch (error) {
        return `Error creating issue: ${error.message}`;
    }
}

// --- COMMITS & PRs ---
export async function listCommits(args) {
    const { owner, repo, limit = 5 } = args;
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`);
        return JSON.stringify(data.map(c => ({
            sha: c.sha.substring(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            date: c.commit.author.date
        })));
    } catch (error) {
        return `Error listing commits: ${error.message}`;
    }
}

export async function listPullRequests(args) {
    const { owner, repo, state = 'open' } = args;
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}`);
        return JSON.stringify(data.map(pr => ({
            number: pr.number,
            title: pr.title,
            user: pr.user.login,
            state: pr.state,
            url: pr.html_url
        })));
    } catch (error) {
        return `Error listing PRs: ${error.message}`;
    }
}

export async function getPullRequest(args) {
    const { owner, repo, pullNumber } = args;
    try {
        const pr = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`);
        return JSON.stringify({
            number: pr.number,
            title: pr.title,
            body: pr.body,
            state: pr.state,
            merged: pr.merged,
            commits: pr.commits,
            changed_files: pr.changed_files
        });
    } catch (error) {
        return `Error getting PR #${pullNumber}: ${error.message}`;
    }
}

export async function getCommit(args) {
    const { owner, repo, sha } = args;
    try {
        const c = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`);
        return JSON.stringify({
            sha: c.sha,
            author: c.commit.author.name,
            message: c.commit.message,
            stats: c.stats,
            files: c.files.map(f => f.filename)
        });
    } catch (error) {
        return `Error getting commit ${sha}: ${error.message}`;
    }
}

export async function getRepoChecks(args) {
    const { owner, repo, ref } = args;
    if (!owner || !repo || !ref) throw new Error('Owner, Repo, and Ref are required.');
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`);
        return JSON.stringify(data);
    } catch (error) {
        return `Error getting checks for ${ref}: ${error.message}`;
    }
}