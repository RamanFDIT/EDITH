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

export async function getJiraIssues(input) {
    console.log("🔍 Jira Tool Invoked. Input keys:", Object.keys(input));

    // Check for 'jql' or 'query'
    const jql = input.jql || input.query || input.jqlQuery;

    if(!JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_DOMAIN || !jql){
        console.error("❌ E.D.I.T.H. Tool Error: Missing Data.");
        throw new Error(`Tool execution failed. Missing 'jql' parameter. Received input: ${JSON.stringify(input)}`);
    }
    
    // FIX: Updated URL to the new '/search/jql' endpoint (Mandatory update)
    const url = `https://${JIRA_DOMAIN}/rest/api/3/search/jql`;
    const basicAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    console.log(`🔍 Accessing Jira (New API): ${url} with JQL: ${jql}`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jql: jql, 
                maxResults: 5,
                fields: ['key', 'summary', 'status', 'created', 'assignee', 'priority']
            })
        });
    
        if(!response.ok){
            const errorText = await response.text();
            throw new Error(`Jira API returned ${response.status}: ${errorText}`);
        } else {
            const data = await response.json();
            console.log(`✅ Success. Found ${data.issues.length} issues.`);
            return JSON.stringify(data.issues);
        }
    } catch(error){
        return `Error searching Jira: ${error.message}`;
    }
};