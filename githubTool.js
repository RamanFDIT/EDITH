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

// --- AUTO-OWNER: Fetch authenticated user's GitHub username ---
async function resolveOwner(owner, userId) {
    if (owner) return owner;
    try {
        const data = await githubFetch('https://api.github.com/user', userId);
        return data.login;
    } catch {
        throw new Error('Owner is required. Connect GitHub or specify the repository owner.');
    }
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
            if (response.status === 403) {
                throw new Error(
                    `GitHub 403 Forbidden: Cannot create repository. ` +
                    `Please go to Settings, disconnect GitHub, and reconnect to grant updated permissions.`
                );
            }
            if (response.status === 422) {
                throw new Error(`Repository '${name}' already exists or the name is invalid.`);
            }
            throw new Error(`GitHub API Error (${response.status}): ${txt}`);
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
  let { owner, repo } = args;
  owner = await resolveOwner(owner, userId);
  if (!repo) throw new Error('Repo name is required.');
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
    let { owner, repo, title, body } = args;

    const token = await getGitHubToken(userId);
    owner = await resolveOwner(owner, userId);
    if (!repo || !title) throw new Error('Repo and Title are required.');

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

        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 403) {
                throw new Error(
                    `GitHub 403 Forbidden: You don't have permission to create issues on ${owner}/${repo}. ` +
                    `Your GitHub token may lack the required 'repo' scope. ` +
                    `Please go to Settings, disconnect GitHub, and reconnect to grant updated permissions.`
                );
            }
            if (response.status === 404) {
                throw new Error(
                    `GitHub 404: Repository '${owner}/${repo}' not found. ` +
                    `Check the owner and repo name, or ensure your token has access to private repositories.`
                );
            }
            throw new Error(`GitHub API Error (${response.status}): ${errorText}`);
        }
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
    let { owner, repo, limit = 5 } = args;
    owner = await resolveOwner(owner, userId);
    if (!repo) throw new Error('Repo name is required.');
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
    let { owner, repo, state = 'open' } = args;
    owner = await resolveOwner(owner, userId);
    if (!repo) throw new Error('Repo name is required.');
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
    let { owner, repo, pullNumber } = args;
    owner = await resolveOwner(owner, userId);
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
    let { owner, repo, sha } = args;
    owner = await resolveOwner(owner, userId);
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
    let { owner, repo, ref } = args;
    owner = await resolveOwner(owner, userId);
    if (!repo || !ref) throw new Error('Repo and Ref are required.');
    try {
        const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}/check-runs`, userId);
        return JSON.stringify({ status: "success", checks: data });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error getting checks for ${ref}: ${error.message}` });
    }
}

export async function listBranches(args, userId) {
    let { owner, repo } = args;
    owner = await resolveOwner(owner, userId);
    if (!repo) throw new Error('Repo name is required.');
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
    let { owner, repo } = args;
    owner = await resolveOwner(owner, userId);
    if (!repo) throw new Error('Repo name is required.');
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

// --- LIST REPOSITORIES ---
export async function listRepositories(args, userId) {
    let { owner, type = 'all', sort = 'updated', perPage = 30 } = args;
    try {
        let url;
        if (owner) {
            url = `https://api.github.com/users/${owner}/repos?type=${type}&sort=${sort}&per_page=${perPage}`;
        } else {
            url = `https://api.github.com/user/repos?type=${type}&sort=${sort}&per_page=${perPage}`;
        }
        const data = await githubFetch(url, userId);
        if (!data || data.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: "No repositories found." });
        }
        const repos = data.map(r => ({
            name: r.name,
            fullName: r.full_name,
            description: r.description,
            visibility: r.visibility,
            language: r.language,
            stars: r.stargazers_count,
            updatedAt: r.updated_at,
            url: r.html_url,
        }));
        return JSON.stringify({ status: "success", repositories: repos });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing repositories: ${error.message}` });
    }
}