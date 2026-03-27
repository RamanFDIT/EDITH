import fetch from 'node-fetch';
import './envConfig.js';
import { getValidToken, getStoredTokens } from './oauthService.js';

// ---------------------------------------------------------------------------
// Per-user Jira credential helpers.
// Uses getValidToken(userId, 'jira') for the access token and
// getStoredTokens(userId, 'jira') for cloud_id/cloud_url metadata.
// ---------------------------------------------------------------------------

async function getJiraCredentials(userId) {
    const accessToken = await getValidToken(userId, 'jira');
    if (!accessToken) {
        throw new Error('Jira is not connected. Please click "Connect" next to Jira in Settings.');
    }
    const tokens = await getStoredTokens(userId, 'jira');
    const cloudId = tokens?.cloud_id || '';
    const cloudUrl = tokens?.cloud_url || '';
    return { accessToken, cloudId, cloudUrl };
}

function getJiraBaseUrl(cloudId) {
    if (cloudId) {
        return `https://api.atlassian.com/ex/jira/${cloudId}`;
    }
    // Fallback to env-based domain for legacy setups
    let domain = (process.env.JIRA_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${domain}`;
}

function getAuthHeader(accessToken) {
    return `Bearer ${accessToken}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Jira API request timed out after ${timeoutMs / 1000}s: ${url}`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// --- TOOL 1: SEARCH (The Fixed Version) ---
export async function getJiraIssues(input, userId) {
    console.log("🔍 Jira Search Invoked:", JSON.stringify(input));

    const jql = input.jql || input.query || input.jqlQuery;
    if (!jql) throw new Error("Missing JQL query.");

    const { accessToken, cloudId } = await getJiraCredentials(userId);
    const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/search/jql`;

    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
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
        if (!data.issues || data.issues.length === 0) {
            return JSON.stringify({ 
                status: "no_results_found", 
                message: `No Jira issues matched the JQL query: "${jql}"`,
                suggestion: "Try a broader search or verify the project key and issue status."
            });
        }
        return JSON.stringify(data.issues);
    } catch(error){
        return JSON.stringify({ 
            status: "error", 
            message: `Error searching Jira: ${error.message}`,
            suggestion: "Check your JQL syntax or Jira connection status."
        });
    }
};

// --- TOOL 2: CREATE ISSUE ---
export async function createJiraIssue(input, userId) {
    console.log("📝 Jira Create Invoked:", JSON.stringify(input));

    const { projectKey, summary, description, issueType, parent } = input;

    if (!projectKey || !summary) {
        throw new Error("Missing required fields: projectKey and summary are mandatory.");
    }

    const { accessToken, cloudId } = await getJiraCredentials(userId);
    const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/issue`;

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

    // Add parent link for hierarchy (Stories under Epics, Tasks under Stories, etc.)
    if (parent) {
        bodyData.fields.parent = { key: parent };
    }

    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
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
        const domain = (process.env.JIRA_DOMAIN || '').trim();
        const link = domain
            ? `https://${domain}/browse/${data.key}`
            : (data.self ? data.self.replace(/\/rest\/api\/.*/, `/browse/${data.key}`) : data.key);
        return JSON.stringify({
            status: "success",
            message: `Created Jira Ticket: ${data.key}`,
            key: data.key,
            id: data.id,
            link
        });

    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error creating ticket: ${error.message}` });
    }
}

// --- TOOL 3: UPDATE ISSUE & STATUS ---
export async function updateJiraIssue(input, userId) {
    console.log("📝 Jira Update Invoked:", JSON.stringify(input));
    const { issueKey, summary, description, status, priority, assignee, duedate, labels, parent } = input;

    const { accessToken, cloudId } = await getJiraCredentials(userId);
    if (!issueKey) throw new Error("Issue Key (e.g., FDIT-1) is required.");

    if (!status && !summary && !description && !priority && !assignee && !duedate && !labels && !parent) {
        return JSON.stringify({ status: "no_action", message: "No updates requested. Provide at least one field to update." });
    }

    let results = [];
    let success = true;

    // 1. HANDLE STATUS CHANGE (Transitions)
    if (status) {
        try {
            // A. Get available transitions for this ticket
            const transUrl = `${getJiraBaseUrl(cloudId)}/rest/api/3/issue/${issueKey}/transitions`;
            const transRes = await fetchWithTimeout(transUrl, {
                method: 'GET',
                headers: { 'Authorization': getAuthHeader(accessToken), 'Accept': 'application/json' }
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
                results.push(`Could not move to '${status}'. Available states: ${transData.transitions.map(t => `${t.name} (-> ${t.to ? t.to.name : '?'})`).join(", ")}`);
                success = false;
            } else {
                // C. Perform the transition
                const moveRes = await fetchWithTimeout(transUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': getAuthHeader(accessToken),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ transition: { id: transition.id } })
                });

                if (moveRes.status === 204) {
                    results.push(`Status updated to '${transition.name}'`);
                } else {
                    const errorText = await moveRes.text();
                    results.push(`Failed to move status. Code: ${moveRes.status}. Response: ${errorText}`);
                    success = false;
                }
            }
        } catch (e) {
            results.push(`Status Error: ${e.message}`);
            success = false;
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

            const updateUrl = `${getJiraBaseUrl(cloudId)}/rest/api/3/issue/${issueKey}`;
            const updateRes = await fetchWithTimeout(updateUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': getAuthHeader(accessToken),
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyData)
            });

            if (updateRes.status === 204) {
                results.push(`Fields updated successfully.`);
            } else {
                const txt = await updateRes.text();
                results.push(`Update Failed: ${txt}`);
                success = false;
            }
        } catch (e) {
            results.push(`Field Update Error: ${e.message}`);
            success = false;
        }
    }

    return JSON.stringify({
        status: success ? "success" : "partial_success_or_failure",
        message: results.join(" "),
        issueKey: issueKey
    });
}

// --- TOOL 4: DELETE ISSUE ---
export async function deleteJiraIssue(input, userId) {
    console.log("🗑️ Jira Delete Invoked:", JSON.stringify(input));
    const { issueKey } = input;

    const { accessToken, cloudId } = await getJiraCredentials(userId);
    if (!issueKey) throw new Error("Issue Key (e.g., FDIT-1) is required.");

    const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/issue/${issueKey}`;

    try {
        const response = await fetchWithTimeout(url, {
            method: 'DELETE',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json'
            }
        });

        if (response.status === 204) {
             return JSON.stringify({ status: "success", message: `Successfully deleted ticket ${issueKey}.` });
        } else {
            const txt = await response.text();
            throw new Error(`Failed to delete issue: ${response.status} - ${txt}`);
        }
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error deleting ticket: ${error.message}` });
    }
}

// --- TOOL 5: LIST JIRA PROJECTS ---
export async function listJiraProjects(input, userId) {
    console.log("📋 Jira List Projects Invoked");

    const { accessToken, cloudId } = await getJiraCredentials(userId);
    const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/project`;

    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`Jira API Error ${response.status}: ${txt}`);
        }
        const data = await response.json();
        const projects = data.map(p => ({ key: p.key, name: p.name, type: p.projectTypeKey }));

        if (projects.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: "No Jira projects found." });
        }

        return JSON.stringify(projects);
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing Jira projects: ${error.message}` });
    }
}

// --- TOOL 6: CREATE JIRA PROJECT ---
export async function createJiraProject(input, userId) {
    console.log("🏗️ Jira Create Project Invoked:", JSON.stringify(input));
    const { key, name, templateKey, projectTypeKey, description } = input;

    const { accessToken, cloudId, cloudUrl } = await getJiraCredentials(userId);
    if (!key || !name) throw new Error("Project Key (e.g., 'TEST') and Name are required.");

    try {
        // 1. Fetch Current User to assign as Lead
        const myselfUrl = `${getJiraBaseUrl(cloudId)}/rest/api/3/myself`;
        const myselfRes = await fetchWithTimeout(myselfUrl, {
            method: 'GET',
            headers: { 'Authorization': getAuthHeader(accessToken), 'Accept': 'application/json' }
        });

        if (!myselfRes.ok) throw new Error("Could not fetch current user to assign as Project Lead.");
        const myself = await myselfRes.json();
        const leadAccountId = myself.accountId;

        // 2. Create Project
        const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/project`;
        const bodyData = {
            key: key.toUpperCase(),
            name: name,
            projectTypeKey: projectTypeKey || "software",
            projectTemplateKey: templateKey || "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
            description: description || `Project created by EDITH for ${name}`,
            leadAccountId: leadAccountId,
            assigneeType: "PROJECT_LEAD"
        };

        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (response.status === 201) {
            const data = await response.json();
            const domain = cloudUrl ? cloudUrl.replace(/^https?:\/\//, '') : (process.env.JIRA_DOMAIN || '').trim();
            const link = domain ? `https://${domain}/browse/${data.key}` : data.key;
            return JSON.stringify({
                status: "success",
                message: `Successfully created project '${name}' (Key: ${data.key})`,
                key: data.key,
                id: data.id,
                link
            });
        } else {
            const txt = await response.text();
            throw new Error(`Failed to create project: ${response.status} - ${txt}`);
        }
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error creating project: ${error.message}` });
    }
}

// ---------------------------------------------------------------------------
// SPRINT TOOLS (using REST API v3 + JQL — no Agile API scopes needed)
// ---------------------------------------------------------------------------

// Helper: Extract unique sprint objects from JQL search results
// Sprint data can live in fields.sprint, fields.closedSprints, or a customfield (e.g. customfield_10020)
function extractSprintsFromIssues(issues) {
    const sprintMap = new Map();

    function addSprint(s) {
        if (s && s.id && !sprintMap.has(s.id)) {
            sprintMap.set(s.id, {
                id: s.id,
                name: s.name,
                state: s.state,
                startDate: s.startDate || null,
                endDate: s.endDate || null,
                goal: s.goal || null
            });
        }
    }

    for (const issue of issues) {
        const fields = issue.fields || {};

        // Check direct sprint field
        if (fields.sprint) addSprint(fields.sprint);

        // Check closedSprints array
        if (Array.isArray(fields.closedSprints)) {
            fields.closedSprints.forEach(addSprint);
        }

        // Scan all customfields for sprint-shaped data
        for (const [key, val] of Object.entries(fields)) {
            if (!key.startsWith('customfield_')) continue;
            // Single sprint object
            if (val && typeof val === 'object' && !Array.isArray(val) && val.id && val.state && val.name) {
                addSprint(val);
            }
            // Array of sprint objects
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && typeof item === 'object' && item.id && item.state && item.name) {
                        addSprint(item);
                    }
                }
            }
        }
    }
    return [...sprintMap.values()];
}

// --- TOOL 7: CREATE SPRINT (requires Jira Software API — uses Agile REST API) ---
export async function createJiraSprint(input, userId) {
    console.log("🏃‍♂️ Jira Create Sprint Invoked:", JSON.stringify(input));
    const { name, projectKey, startDate, endDate, goal } = input;

    if (!name || !projectKey) throw new Error("Sprint Name and Project Key are required.");

    const { accessToken, cloudId } = await getJiraCredentials(userId);

    try {
        // First get the board ID for this project
        const boardUrl = `${getJiraBaseUrl(cloudId)}/rest/agile/1.0/board?projectKeyOrId=${projectKey}`;
        const boardResponse = await fetchWithTimeout(boardUrl, {
            method: 'GET',
            headers: { 'Authorization': getAuthHeader(accessToken), 'Accept': 'application/json' }
        });

        if (!boardResponse.ok) {
            const txt = await boardResponse.text();
            if (boardResponse.status === 401) {
                throw new Error(`Jira Software API access denied. To create sprints, add "Jira Software" API with Agile scopes in your Atlassian Developer Console app permissions.`);
            }
            throw new Error(`Failed to fetch boards: ${boardResponse.status} - ${txt}`);
        }

        const boardData = await boardResponse.json();
        if (!boardData.values || boardData.values.length === 0) {
            throw new Error(`No agile boards found for project ${projectKey}. A board is required to create a sprint.`);
        }
        const originBoardId = boardData.values[0].id;

        const url = `${getJiraBaseUrl(cloudId)}/rest/agile/1.0/sprint`;
        const bodyData = { name, originBoardId, goal: goal || "" };
        if (startDate) bodyData.startDate = startDate;
        if (endDate) bodyData.endDate = endDate;

        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error(`[Jira Agile] Create sprint failed — Status: ${response.status}, Body: ${txt}`);
            throw new Error(`Failed to create sprint: ${response.status} - ${txt}`);
        }

        const data = await response.json();
        return JSON.stringify({
            status: "success",
            message: `Successfully created sprint '${data.name}' (ID: ${data.id}) on Board ${originBoardId}.`,
            sprintId: data.id,
            boardId: originBoardId
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error creating sprint: ${error.message}` });
    }
}

// --- TOOL 8: UPDATE / START SPRINT (requires Jira Software API) ---
export async function updateJiraSprint(input, userId) {
    console.log("🏃‍♂️ Jira Update Sprint Invoked:", JSON.stringify(input));
    const { sprintId, name, state, startDate, endDate, goal } = input;

    if (!sprintId) throw new Error("Sprint ID is required.");
    if (!name && !state && !startDate && !endDate && !goal) {
        throw new Error("No update parameters provided (name, state, startDate, endDate, goal).");
    }

    const { accessToken, cloudId } = await getJiraCredentials(userId);

    try {
        const url = `${getJiraBaseUrl(cloudId)}/rest/agile/1.0/sprint/${sprintId}`;
        const bodyData = {};
        if (name) bodyData.name = name;
        if (state) bodyData.state = state;
        if (startDate) bodyData.startDate = startDate;
        if (endDate) bodyData.endDate = endDate;
        if (goal) bodyData.goal = goal;

        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) {
            const txt = await response.text();
            if (response.status === 401) {
                throw new Error(`Jira Software API access denied. To update sprints, add "Jira Software" API with Agile scopes in your Atlassian Developer Console app permissions.`);
            }
            console.error(`[Jira Agile] Update sprint failed — Status: ${response.status}, Body: ${txt}`);
            throw new Error(`Failed to update sprint: ${response.status} - ${txt}`);
        }

        const data = await response.json();
        return JSON.stringify({
            status: "success",
            message: `Successfully updated sprint ${sprintId} (State: ${data.state}).`,
            sprintId: data.id,
            state: data.state
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error updating sprint: ${error.message}` });
    }
}

// --- TOOL 9: ADD ISSUES TO SPRINT (requires Jira Software API) ---
export async function addIssuesToSprint(input, userId) {
    console.log("📝 Jira Add Issues To Sprint Invoked:", JSON.stringify(input));
    const { sprintId, issues } = input;

    if (!sprintId || !issues || !Array.isArray(issues) || issues.length === 0) {
        throw new Error("Sprint ID and an array of Issue keys are required.");
    }

    const { accessToken, cloudId } = await getJiraCredentials(userId);

    try {
        const url = `${getJiraBaseUrl(cloudId)}/rest/agile/1.0/sprint/${sprintId}/issue`;
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ issues })
        });

        if (!response.ok && response.status !== 204) {
             const txt = await response.text();
             if (response.status === 401) {
                 throw new Error(`Jira Software API access denied. To manage sprint issues, add "Jira Software" API with Agile scopes in your Atlassian Developer Console app permissions.`);
             }
             console.error(`[Jira Agile] Add issues to sprint failed — Status: ${response.status}, Body: ${txt}`);
             throw new Error(`Failed to add issues to sprint: ${response.status} - ${txt}`);
        }

        return JSON.stringify({
            status: "success",
            message: `Successfully added ${issues.length} issue(s) to sprint ${sprintId}.`,
            sprintId: sprintId,
            issues: issues
        });
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error adding issues to sprint: ${error.message}` });
    }
}

// --- TOOL 10: LIST JIRA SPRINTS (via JQL — uses REST API v3, no Agile scopes needed) ---
export async function listJiraSprints(input, userId) {
    console.log("📋 Jira List Sprints Invoked:", JSON.stringify(input));
    const { projectKey, state } = input;

    if (!projectKey) throw new Error("Project Key (e.g., 'FDIT') is required.");

    const { accessToken, cloudId } = await getJiraCredentials(userId);

    try {
        // Build JQL based on requested sprint state
        let jql;
        if (state === 'active') {
            jql = `project = "${projectKey}" AND sprint in openSprints()`;
        } else if (state === 'closed') {
            jql = `project = "${projectKey}" AND sprint in closedSprints()`;
        } else if (state === 'future') {
            jql = `project = "${projectKey}" AND sprint in futureSprints()`;
        } else {
            // All sprints — search for any issue that has a sprint
            jql = `project = "${projectKey}" AND sprint is not EMPTY`;
        }

        const url = `${getJiraBaseUrl(cloudId)}/rest/api/3/search/jql`;
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Authorization': getAuthHeader(accessToken),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jql,
                maxResults: 50,
                fields: ['*navigable']
            })
        });

        if (!response.ok) {
            const txt = await response.text();
            console.error(`[Jira] Sprint search failed — Status: ${response.status}, Body: ${txt}`);
            throw new Error(`Failed to search sprints: ${response.status} - ${txt}`);
        }

        const data = await response.json();
        if (!data.issues || data.issues.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: `No sprints found for project ${projectKey}${state ? ` in state '${state}'` : ''}.` });
        }

        const sprints = extractSprintsFromIssues(data.issues);

        // Filter by requested state if needed (JQL handles most cases, but closedSprints field may include extras)
        const filtered = state
            ? sprints.filter(s => s.state === state)
            : sprints;

        if (filtered.length === 0) {
            return JSON.stringify({ status: "no_results_found", message: `No sprints found for project ${projectKey}${state ? ` in state '${state}'` : ''}.` });
        }

        return JSON.stringify(filtered);
    } catch (error) {
        return JSON.stringify({ status: "error", message: `Error listing sprints: ${error.message}` });
    }
}