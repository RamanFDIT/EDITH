import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
let JIRA_DOMAIN = process.env.JIRA_DOMAIN;

// SANITIZER
if (JIRA_DOMAIN) {
    JIRA_DOMAIN = JIRA_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Helper for Auth Header
const getAuthHeader = () => {
    return 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
};

// --- TOOL 1: SEARCH (The Fixed Version) ---
export async function getJiraIssues(input) {
    console.log("🔍 Jira Search Invoked:", JSON.stringify(input));
    
    // Check for 'jql' or 'query' to be safe
    const jql = input.jql || input.query || input.jqlQuery;

    if(!JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_DOMAIN || !jql){
        throw new Error("Missing credentials or query.");
    }
    
    // CRITICAL FIX: Using the /search/jql endpoint to prevent 410 Gone errors
    const url = `https://${JIRA_DOMAIN}/rest/api/3/search/jql`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jql: jql, 
                maxResults: 5,
                fields: ['key', 'summary', 'status', 'assignee', 'priority']
            })
        });
    
        if(!response.ok) {
            const txt = await response.text();
            throw new Error(`Jira API Error ${response.status}: ${txt}`);
        }
        const data = await response.json();
        return JSON.stringify(data.issues);
    } catch(error){
        return `Error searching Jira: ${error.message}`;
    }
};

// --- TOOL 2: CREATE ISSUE (New Capability) ---
export async function createJiraIssue(input) {
    console.log("📝 Jira Create Invoked:", JSON.stringify(input));

    const { projectKey, summary, description, issueType } = input;

    if (!projectKey || !summary) {
        throw new Error("Missing required fields: projectKey and summary are mandatory.");
    }

    const url = `https://${JIRA_DOMAIN}/rest/api/3/issue`;

    // Jira Cloud requires "Atlassian Document Format" (ADF) for descriptions
    const adfDescription = {
        type: "doc",
        version: 1,
        content: [
            {
                type: "paragraph",
                content: [
                    {
                        type: "text",
                        text: description || "No description provided."
                    }
                ]
            }
        ]
    };

    const bodyData = {
        fields: {
            project: { key: projectKey },
            summary: summary,
            description: adfDescription,
            issuetype: { name: issueType || "Task" } 
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create issue: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log(`✅ Ticket Created: ${data.key}`);
        return `Success! Created Jira Ticket: ${data.key} (ID: ${data.id}). Link: https://${JIRA_DOMAIN}/browse/${data.key}`;

    } catch (error) {
        return `Error creating ticket: ${error.message}`;
    }
}