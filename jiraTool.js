import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
let JIRA_DOMAIN = process.env.JIRA_DOMAIN;

// SANITIZER: Prevents the "https://https://" crash
if (JIRA_DOMAIN) {
    JIRA_DOMAIN = JIRA_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// FIX: Accept 'jql' instead of 'jqlQuery'
// We also use a fallback in case the AI uses the other name
export async function getJiraIssues(input) {
    const jql = input.jql || input.jqlQuery || input.jql_query;

    if(!JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_DOMAIN || !jql){
        console.error("❌ E.D.I.T.H. Tool Error: Missing Credentials or Query.");
        console.error("   Input received:", JSON.stringify(input));
        throw new Error("Missing Jira credentials or JQL query. Check .env file.");
    }
    
    const url = `https://${JIRA_DOMAIN}/rest/api/3/search`;
    const basicAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    console.log(`🔍 E.D.I.T.H. accessing Jira: ${url}`);
    console.log(`QP JQL: ${jql}`);

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
            console.error(`❌ Jira API Error: ${response.status}`);
            throw new Error(`Jira API returned ${response.status}: ${errorText}`);
        } else {
            const data = await response.json();
            console.log(`✅ Success. Found ${data.issues.length} issues.`);
            return JSON.stringify(data.issues);
        }
    } catch(error){
        console.error('❌ Network Error in Jira Tool:', error);
        throw error;
    }
};