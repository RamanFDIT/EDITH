import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_API_TOKEN = process.env.JIRA_TOKEN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;

export async function getJiraIssues({ jqlQuery }) {
    if(!JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_DOMAIN || !jqlQuery){
        throw new Error("Missing Jira credentials or JQL query.");
    }
    
    // FIX: Removed '/jql' from the end
    const url = `https://${JIRA_DOMAIN}/rest/api/3/search`;
    const basicAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jql: jqlQuery,
                maxResults: 5,
                fields: ['key', 'summary', 'status', 'created', 'assignee']
            })
        });
    
        if(!response.ok){
            // Improve error logging
            const errorText = await response.text();
            throw new Error(`Jira API Error: ${response.status} ${response.statusText} - ${errorText}`);
        } else {
            const data = await response.json();
            return JSON.stringify(data.issues);
        }
    } catch(error){
        console.error('Error fetching Jira issues:', error);
        throw error; // Propagate error so the Agent knows it failed
    }
};