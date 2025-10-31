import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config(); // Load variables from .env file

const GITHUB_TOKEN = process.env.GITHUB_PAT;

/**
 * Fetches issues for a specific GitHub repository.
 * @param {string} owner - The owner of the repository (username or organization).
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Array<object>>} - A promise that resolves to an array of issue objects.
 */
export async function getRepoIssues(owner, repo) {
  if (!GITHUB_TOKEN) {
    throw new Error('GitHub PAT not found in .env file');
  }
  if (!owner || !repo) {
    throw new Error('Both owner and repo parameters are required for getRepoIssues.');
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
  console.log(`Tool: Fetching issues from: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        // --- Concept from Docs ---
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json', 
        'X-GitHub-Api-Version': '2022-11-28'     
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API Error! Status: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`Tool: Found ${data.length} issues for ${owner}/${repo}.`);
    return data;

  } catch (error) {
    console.error('Error in getRepoIssues tool:', error);
    throw error;
  }
}



