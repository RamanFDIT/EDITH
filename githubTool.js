import fetch from 'node-fetch';
import './envConfig.js';
import { getValidToken } from './oauthService.js';

// Per-user token helper
async function getGitHubToken(userId) {
    const token = await getValidToken(userId, 'github');
    if (!token) throw new Error('GitHub is not connected. Please click "Connect" next to GitHub in Settings.');
    return token;
}

// --- HELPER: Generic Fetcher ---
async function githubFetch(url, userId) {
    const token = await getGitHubToken(userId);
    
    console.log(`🔍 Accessing GitHub: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Status: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return await response.json();
}

// --- REPOSITORY MANAGEMENT (NEW) ---
export async function createRepository(args, userId) {
    console.log("📝 GitHub Create Repo Invoked:", JSON.stringify(args));
    const { name, description, isPrivate } = args;

    const token = await getGitHubToken(userId);
    if (!name) throw new Error('Repository name is required.');

    try {
        const response = await fetch('https://api.github.com/user/repos', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
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
        return JSON.stringify({
            status: "success",
            message: `Created Repository '${data.full_name}'`,
            fullName: data.full_name,
            url: data.html_url
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error creating repository: ${error.message}` });
    }
}

// --- ISSUES ---
export async function getRepoIssues(args, userId) {
  const { owner, repo } = args;
  if (!owner || !repo) throw new Error('Owner and Repo required.');
  try {
    const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/issues`, userId);
    if (!data || data.length === 0) {
        return JSON.stringify({ status: "no_results_found", message: `No issues found for ${owner}/${repo}.` });
    }
    const issues = data.map(i => ({ 
        number: i.number, 
        title: i.title, 
        state: i.state, 
        user: i.user.login 
    }));
    return JSON.stringify({ status: "success", issues });
  } catch (error) {
    return JSON.stringify({ status: "error", message: `Error fetching issues: ${error.message}` });
  }
}

export async function createRepoIssue(args, userId) {
    console.log("📝 GitHub Create Issue Invoked:", JSON.stringify(args));
    const { owner, repo, title, body } = args;

    const token = await getGitHubToken(userId);
    if (!owner || !repo || !title) throw new Error('Owner, Repo, and Title are required.');

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title, body: body || "Created by E.D.I.T.H." })
        });

        if (!response.ok) throw new Error(`GitHub API Error: ${await response.text()}`);
        const data = await response.json();
        return JSON.stringify({
            status: "success",
            message: `Created Issue #${data.number} in ${owner}/${repo}`,
            issueNumber: data.number,
            url: data.html_url
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error creating issue: ${error.message}` });
    }
}

// --- COMMITS & PRs ---
export async function listCommits(args, userId) {
    const { owner, repo, limit = 5 } = args;
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`, userId);
        if (!data || data.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: `No commits found for ${owner}/${repo}.` });
        }
        const commits = data.map(c => ({
            sha: c.sha.substring(0, 7),
            message: c.commit.message.split('\n')[0],
            author: c.commit.author.name,
            date: c.commit.author.date
        }));
        return JSON.stringify({ status: "success", commits });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing commits: ${error.message}` });
    }
}

export async function listPullRequests(args, userId) {
    const { owner, repo, state = 'open' } = args;
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}`, userId);
        if (!data || data.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: `No ${state} pull requests found for ${owner}/${repo}.` });
        }
        const pulls = data.map(pr => ({
            number: pr.number,
            title: pr.title,
            user: pr.user.login,
            state: pr.state,
            url: pr.html_url
        }));
        return JSON.stringify({ status: "success", pullRequests: pulls });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing PRs: ${error.message}` });
    }
}

export async function getPullRequest(args, userId) {
    const { owner, repo, pullNumber } = args;
    try {
        const pr = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, userId);
        return JSON.stringify({
            status: "success",
            pullRequest: {
                number: pr.number,
                title: pr.title,
                body: pr.body,
                state: pr.state,
                merged: pr.merged,
                commits: pr.commits,
                changed_files: pr.changed_files,
                url: pr.html_url
            }
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error getting PR #${pullNumber}: ${error.message}` });
    }
}

export async function getCommit(args, userId) {
    const { owner, repo, sha } = args;
    try {
        const c = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, userId);
        return JSON.stringify({
            status: "success",
            commit: {
                sha: c.sha,
                author: c.commit.author.name,
                message: c.commit.message,
                stats: c.stats,
                files: c.files.map(f => f.filename)
            }
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error getting commit ${sha}: ${error.message}` });
    }
}

export async function getRepoChecks(args, userId) {
    const { owner, repo, ref } = args;
    if (!owner || !repo || !ref) throw new Error('Owner, Repo, and Ref are required.');
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`, userId);
        return JSON.stringify({ status: "success", checks: data });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error getting checks for ${ref}: ${error.message}` });
    }
}

export async function listBranches(args, userId) {
    const { owner, repo } = args;
    if (!owner || !repo) throw new Error('Owner and Repo are required.');
    try {
        const branches = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`, userId);
        const repoData = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, userId);
        const defaultBranch = repoData.default_branch;

        return JSON.stringify({
            status: "success",
            defaultBranch,
            totalBranches: branches.length,
            branches: branches.map(b => ({
                name: b.name,
                isDefault: b.name === defaultBranch,
                protected: b.protected,
                lastCommitSha: b.commit?.sha?.substring(0, 7),
            })),
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing branches: ${error.message}` });
    }
}

export async function getRepoInfo(args, userId) {
    const { owner, repo } = args;
    if (!owner || !repo) throw new Error('Owner and Repo are required.');
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, userId);
        return JSON.stringify({
            status: "success",
            repo: {
                fullName: data.full_name,
                description: data.description,
                defaultBranch: data.default_branch,
                visibility: data.visibility,
                language: data.language,
                stars: data.stargazers_count,
                forks: data.forks_count,
                openIssues: data.open_issues_count,
                watchers: data.watchers_count,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                pushedAt: data.pushed_at,
                htmlUrl: data.html_url,
                topics: data.topics || [],
            },
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error getting repo info: ${error.message}` });
    }
}