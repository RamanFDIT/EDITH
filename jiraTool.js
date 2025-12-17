import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config(); // Load variables from .env file

const JIRA_API_TOKEN = process.env.JIRA_TOKEN;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_DOMAIN = process.env.JIRA_DOMAIN;

export async function getJiraIssues({ jqlQuery }) {
    if(!JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_DOMAIN || !jqlQuery){
        throw new Error("Your Tokens do not load, U silly User");
        return;
    }
    const url = `https://${JIRA_DOMAIN}/rest/api/3/search`;
    const basicAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    try{
        const response = await fetch(url, {
        method: 'POST', // Jira search uses POST
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jql: jqlQuery,
            maxResults: 5, // Limit results for this test
            fields: ['key', 'summary', 'status', 'created', 'assignee'] // Specify which fields to return
        })
    });
    
    if(!response.ok){
        throw new Error(`Status isnot 200 U silly user response = ${response.status} and response text = ${response.statusText}`)
    }else{
        const data = await response.json();
        return JSON.stringify(data.issues);
    }
    }
    catch(error){
        console.error('Error fetching Jira issues:', error);
        throw error;
    }
};