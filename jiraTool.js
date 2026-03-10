import fetch from 'node-fetch';
import './envConfig.js';

// ---------------------------------------------------------------------------
// Lazy credential helpers — read from process.env at call-time so tokens
// injected by oauthService.js (after user clicks "Connect → Jira") work
// without restarting the app.
// ---------------------------------------------------------------------------

function getJiraDomain() {
    let domain = (process.env.JIRA_DOMAIN || '').trim();
    if (domain) {
        domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    return domain;
}

function getOAuthToken() {
    return (process.env.JIRA_OAUTH_TOKEN || '').trim();
}

function getApiToken() {
    return (process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN || '').trim();
}

function getEmail() {
    return (process.env.JIRA_EMAIL || '').trim();
}

// Helper for Auth Header — supports both OAuth2 Bearer and legacy Basic auth
const getAuthHeader = () => {
    const oauthToken = getOAuthToken();
    if (oauthToken) {
        // OAuth2.0 Bearer token (from oauthService.js)
        return `Bearer ${oauthToken}`;
    }
    // Legacy: Basic auth with email + API token
    const email = getEmail();
    const apiToken = getApiToken();
    return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
};

/**
 * Check if Jira credentials are available (either OAuth or legacy)
 */
function hasCredentials() {
    const domain = getJiraDomain();
    if (getOAuthToken() && domain) return true;
    if (getApiToken() && getEmail() && domain) return true;
    return false;
}

// --- TOOL 1: SEARCH (The Fixed Version) ---
export async function getJiraIssues(input) {
    console.log("🔍 Jira Search Invoked:", JSON.stringify(input));
    
    // Check for 'jql' or 'query' to be safe
    const jql = input.jql || input.query || input.jqlQuery;

    if(!hasCredentials() || !jql){
        throw new Error("Missing Jira credentials or query. Connect Jira via OAuth in Settings, or set JIRA_API_TOKEN + JIRA_EMAIL + JIRA_DOMAIN.");
    }
    
    const url = `https://${getJiraDomain()}/rest/api/3/search/jql`;

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

// --- TOOL 2: CREATE ISSUE ---
export async function createJiraIssue(input) {
    console.log("📝 Jira Create Invoked:", JSON.stringify(input));

    const { projectKey, summary, description, issueType } = input;

    if (!projectKey || !summary) {
        throw new Error("Missing required fields: projectKey and summary are mandatory.");
    }

    const url = `https://${getJiraDomain()}/rest/api/3/issue`;

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
        return `Success! Created Jira Ticket: ${data.key} (ID: ${data.id}). Link: https://${getJiraDomain()}/browse/${data.key}`;

    } catch (error) {
        return `Error creating ticket: ${error.message}`;
    }
}

// --- TOOL 3: UPDATE ISSUE & STATUS ---
export async function updateJiraIssue(input) {
    console.log("📝 Jira Update Invoked:", JSON.stringify(input));
    const { issueKey, summary, description, status, priority, assignee, duedate, labels, parent } = input;

    if (!hasCredentials()) {
        throw new Error("Missing Jira credentials. Connect Jira via OAuth in Settings.");
    }
    if (!issueKey) throw new Error("Issue Key (e.g., FDIT-1) is required.");

    if (!status && !summary && !description && !priority && !assignee && !duedate && !labels && !parent) {
        return "⚠️ No updates requested. Please provide status, summary, description, priority, assignee, due date, labels, or parent.";
    }

    let results = [];

    // 1. HANDLE STATUS CHANGE (Transitions)
    if (status) {
        try {
            // A. Get available transitions for this ticket
            const transUrl = `https://${getJiraDomain()}/rest/api/3/issue/${issueKey}/transitions`;
            const transRes = await fetch(transUrl, {
                method: 'GET',
                headers: { 'Authorization': getAuthHeader(), 'Accept': 'application/json' }
            });
            
            if (!transRes.ok) {
                const errText = await transRes.text();
                throw new Error(`Could not fetch transitions (Status: ${transRes.status}): ${errText}`);
            }
            const transData = await transRes.json();

            // B. Find the transition ID that matches the requested status name
            const transition = transData.transitions.find(t => 
                t.name.toLowerCase() === status.toLowerCase() || 
                (t.to && t.to.name.toLowerCase() === status.toLowerCase())
            );

            if (!transition) {
                results.push(`❌ Could not move to '${status}'. Available states: ${transData.transitions.map(t => `${t.name} (-> ${t.to ? t.to.name : '?'})`).join(", ")}`);
            } else {
                // C. Perform the transition
                const moveRes = await fetch(transUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': getAuthHeader(),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ transition: { id: transition.id } })
                });

                if (moveRes.status === 204) {
                    results.push(`✅ Status updated to '${transition.name}'`);
                } else {
                    const errorText = await moveRes.text();
                    results.push(`❌ Failed to move status. Code: ${moveRes.status}. Response: ${errorText}`);
                }
            }
        } catch (e) {
            results.push(`❌ Status Error: ${e.message}`);
        }
    }

    // 2. HANDLE FIELD UPDATES (Summary / Description / Priority / Assignee / DueDate / Labels / Parent)
    if (summary || description || priority || assignee || duedate || labels || parent) {
        try {
            const bodyData = { fields: {} };
            if (summary) bodyData.fields.summary = summary;
            if (priority) bodyData.fields.priority = { name: priority };
            if (assignee) bodyData.fields.assignee = { accountId: assignee };
            if (duedate) bodyData.fields.duedate = duedate;
            if (labels) bodyData.fields.labels = Array.isArray(labels) ? labels : labels.split(',').map(l => l.trim());
            if (parent) bodyData.fields.parent = { key: parent };
            if (description) {
                bodyData.fields.description = {
                    type: "doc",
                    version: 1,
                    content: [{
                        type: "paragraph",
                        content: [{ type: "text", text: description }]
                    }]
                };
            }

            const updateUrl = `https://${getJiraDomain()}/rest/api/3/issue/${issueKey}`;
            const updateRes = await fetch(updateUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': getAuthHeader(),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyData)
            });

            if (updateRes.status === 204) {
                results.push(`✅ Fields updated successfully.`);
            } else {
                const txt = await updateRes.text();
                results.push(`❌ Update Failed: ${txt}`);
            }
        } catch (e) {
            results.push(`❌ Field Update Error: ${e.message}`);
        }
    }

    return results.join(" ");
}

// --- TOOL 4: DELETE ISSUE ---
export async function deleteJiraIssue(input) {
    console.log("🗑️ Jira Delete Invoked:", JSON.stringify(input));
    const { issueKey } = input;

    if (!hasCredentials()) {
        throw new Error("Missing Jira credentials. Connect Jira via OAuth in Settings.");
    }
    if (!issueKey) throw new Error("Issue Key (e.g., FDIT-1) is required.");

    const url = `https://${getJiraDomain()}/rest/api/3/issue/${issueKey}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': getAuthHeader(),
                'Accept': 'application/json'
            }
        });

        if (response.status === 204) {
             return `✅ Successfully deleted ticket ${issueKey}.`;
        } else {
            const txt = await response.text();
            throw new Error(`Failed to delete issue: ${response.status} - ${txt}`);
        }
    } catch (error) {
        return `Error deleting ticket: ${error.message}`;
    }
}

// --- TOOL 5: CREATE JIRA PROJECT ---
export async function createJiraProject(input) {
    console.log("🏗️ Jira Create Project Invoked:", JSON.stringify(input));
    const { key, name, templateKey, projectTypeKey, description } = input;

    if (!hasCredentials()) {
        throw new Error("Missing Jira credentials. Connect Jira via OAuth in Settings.");
    }
    if (!key || !name) throw new Error("Project Key (e.g., 'TEST') and Name are required.");

    try {
        // 1. Fetch Current User to assign as Lead
        const myselfUrl = `https://${getJiraDomain()}/rest/api/3/myself`;
        const myselfRes = await fetch(myselfUrl, {
            method: 'GET',
            headers: { 'Authorization': getAuthHeader(), 'Accept': 'application/json' }
        });
        
        if (!myselfRes.ok) throw new Error("Could not fetch current user to assign as Project Lead.");
        const myself = await myselfRes.json();
        const leadAccountId = myself.accountId;

        // 2. Create Project
        const url = `https://${getJiraDomain()}/rest/api/3/project`;
        const bodyData = {
            key: key.toUpperCase(),
            name: name,
            projectTypeKey: projectTypeKey || "software", // 'software' or 'business'
            projectTemplateKey: templateKey || "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic", 
            description: description || `Project created by EDITH for ${name}`,
            leadAccountId: leadAccountId,
            assigneeType: "PROJECT_LEAD"
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (response.status === 201) {
            const data = await response.json();
            return `✅ Successfully created project '${name}' (Key: ${data.key}). ID: ${data.id}. Link: https://${getJiraDomain()}/browse/${data.key}`;
        } else {
            const txt = await response.text();
            throw new Error(`Failed to create project: ${response.status} - ${txt}`);
        }
    } catch (error) {
        return `Error creating project: ${error.message}`;
    }
}