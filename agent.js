import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { RunnableWithMessageHistory, RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import "./envConfig.js";
import { getValidToken } from "./oauthService.js";

import { EDITH_SYSTEM_PROMPT, getSystemPrompt } from "./systemPrompt.js";
import { generateImage } from "./imageTool.js";
import { getJiraIssues, createJiraIssue, updateJiraIssue, deleteJiraIssue, createJiraProject, listJiraProjects, createJiraSprint, updateJiraSprint, addIssuesToSprint, listJiraSprints } from "./jiraTool.js";
import { getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, findFreeTime } from "./calendarTool.js";
import { sendSlackMessage, sendSlackAnnouncement, sendSlackLink } from "./slackTool.js";
import { createRepository, getRepoIssues, createRepoIssue, listCommits, listPullRequests, getPullRequest, getCommit, getRepoChecks, listBranches, getRepoInfo, listRepositories } from "./githubTool.js";
import { getFigmaFileStructure, getFigmaComments, postFigmaComment } from "./figmaTool.js";
import { sendGmail, searchGmailContacts, getRecentEmails } from "./gmailTool.js";
import { readFile } from "./fileTool.js";

// =============================================================================
// LLM PROVIDER SELECTION
// Priority: GitHub Models (free cloud) → Gemini API key → Ollama (local)
// Lazy-initialized — the app can start and show the Connection page before
// the user has connected any accounts. The LLM is created on first use.
// =============================================================================

// =============================================================================
// LLM PROVIDER SELECTION
// No global LLM state — each user request gets its own instance.
// =============================================================================

function validateCredential(key, name) {
  if (!key) return false;
  const trimmed = key.trim();
  if (trimmed === '' || 
      trimmed.toLowerCase() === 'undefined' || 
      trimmed.toLowerCase() === 'null' || 
      trimmed.toLowerCase().includes('your_api_key') ||
      trimmed.length < 8) {
    console.warn(`[LLM] Ignoring invalid ${name}: "${trimmed.substring(0, 4)}..."`);
    return false;
  }
  return true;
}

// Cache LLM instances per user+provider to avoid re-creating on every message
const llmCache = new Map();
const LLM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track providers that returned 403 per user — avoids retrying a dead provider on every message
const blockedProviders = new Map(); // userId → { providers: Set, createdAt: number }
const BLOCKED_TTL = 30 * 60 * 1000; // 30 minutes — re-check occasionally in case user enrolls

export function clearLLMCacheForUser(userId) {
    const idStr = userId.toString();
    for (const key of llmCache.keys()) {
        if (key.startsWith(`${idStr}:`)) {
            llmCache.delete(key);
        }
    }
    blockedProviders.delete(idStr);
    console.log(`[LLM] Cleared cache and blocked providers for user ${idStr}`);
}

// Periodic cleanup of expired cache entries (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of llmCache) {
        if (now - entry.createdAt >= LLM_CACHE_TTL) llmCache.delete(key);
    }
    for (const [userId, entry] of blockedProviders) {
        if (now - entry.createdAt >= BLOCKED_TTL) blockedProviders.delete(userId);
    }
}, 10 * 60 * 1000);

async function getLLMForUser(userId, excludeProviders = new Set()) {
  // Merge caller exclusions with any providers blocked due to prior 403s
  const blocked = blockedProviders.get(userId);
  if (blocked && (Date.now() - blocked.createdAt < BLOCKED_TTL)) {
    for (const p of blocked.providers) excludeProviders.add(p);
  }

  const provider = (process.env.LLM_PROVIDER || 'auto').toLowerCase();

  const cacheKey = `${userId}:${provider}:${[...excludeProviders].sort().join(',')}`;
  const cached = llmCache.get(cacheKey);
  if (cached) {
    if (Date.now() - cached.createdAt < LLM_CACHE_TTL) {
      console.log(`[LLM] Cache hit for user ${userId} (${cached.provider})`);
      return { llm: cached.llm, classifier: cached.classifier, provider: cached.provider };
    }
    llmCache.delete(cacheKey);
  }

  // 1. GEMINI (Global Key - PRIMARY)
  // Note: We removed the user OAuth token approach for Gemini because the
  // 'generative-language' scope requires strict Google Cloud App Verification.
  if ((provider === 'gemini' || provider === 'auto') && !excludeProviders.has('gemini')) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (validateCredential(apiKey, 'Gemini API Key Config')) {
      console.log(`[LLM] Using Gemini 3 Flash for user ${userId} (Global Key)`);
      const llm = new ChatGoogleGenerativeAI("gemini-3-flash-preview", { apiKey: apiKey });
      const result = { llm, classifier: null, provider: 'gemini' };
      llmCache.set(cacheKey, { ...result, createdAt: Date.now() });
      return result;
    }
    if (provider === 'gemini') throw new Error("Gemini API key not configured in environment variables.");
  }

  // 2. GITHUB (GitHub Models via standard OAuth - Fallback)
  // We can use standard GitHub OAuth App tokens with the official GitHub Models endpoint.
  // This provides users with free gpt-4o requests without needing personal API keys.
  if ((provider === 'github' || provider === 'auto') && !excludeProviders.has('github')) {
    const githubToken = await getValidToken(userId, 'github');

    // We removed the strict 'ghp_' check because standard OAuth tokens ('ghu_' or 'gho_')
    // are officially supported by the models.github.ai endpoint.
    if (validateCredential(githubToken, 'GitHub Token')) {
      console.log(`[LLM] Using GitHub Models for user ${userId} (token prefix: ${githubToken.substring(0, 4)}, length: ${githubToken.length})`);

      const modelName = process.env.GITHUB_MODEL || 'gpt-4o';
      const ghBaseURL = 'https://models.github.ai/inference';
      const llm = new ChatOpenAI({
        modelName: modelName,
        openAIApiKey: githubToken,
        configuration: { baseURL: ghBaseURL, apiKey: githubToken },
      });
      const result = { llm, classifier: null, provider: 'github' };
      llmCache.set(cacheKey, { ...result, createdAt: Date.now() });
      return result;
    }
    if (provider === 'github') throw new Error("GitHub account not connected or Token invalid.");
  }

  // 4. OLLAMA (Local)
  if (provider === 'ollama') {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
    console.log(`[LLM] Using Ollama for user ${userId}`);
    const llm = new ChatOllama({ baseUrl: ollamaBaseUrl, model: ollamaModel });
    const result = { llm, classifier: null, provider: 'ollama' };
    llmCache.set(cacheKey, { ...result, createdAt: Date.now() });
    return result;
  }

  throw new Error("No LLM provider config available. Please connect Google/GitHub or run Ollama.");
}

// initLLM and ensureFreshLLM are removed in favor of getLLMForUser
// to ensure multi-user isolation.




// =============================================================================
// CUSTOM TOOL DEFINITIONS
// =============================================================================

// ---------------------------------------------------------------------------
// Per-user tool factory.
// Each tool's `func` is wrapped to inject `userId` as the second argument,
// ensuring every API call uses the correct user's OAuth tokens from the DB.
// Tools that don't need userId (image, file) are left unwrapped.
// ---------------------------------------------------------------------------

function createToolsForUser(userId, userTimezone, projectContext = null) {
  const imageTools = [
    new DynamicStructuredTool({
      name: "generate_image_nano_banana",
      description: "Generate an image from a text description using Google's Nano Banana (Gemini 2.5 Flash Image). Use this when the user asks to create, generate, draw, design, or visualise an image, picture, illustration, graphic, logo, or artwork. Returns the local URL path of the generated image.",
      schema: z.object({
        prompt: z.string().describe("REQUIRED: A detailed description of the image to generate. Be as descriptive as possible for best results."),
        aspectRatio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).optional().describe("Aspect ratio. '1:1' (square), '9:16' (portrait/phone), '16:9' (landscape/widescreen), '3:2' (photo), etc. Default is '1:1'."),
      }),
      func: generateImage,
    }),
  ];

  // --- JIRA TOOLS ---
  const jiraKey = projectContext?.jiraProjectKey || '';

  const jiraReadTools = [
    new DynamicStructuredTool({
      name: "search_jira_issues",
      description: jiraKey
        ? `Search Jira issues using JQL. You are scoped to project "${jiraKey}". Always include 'project = "${jiraKey}"' in your JQL. Do NOT search other projects unless the user explicitly asks. Example JQL: 'project = "${jiraKey}" AND status = Open'.`
        : "Search Jira issues using JQL. For FASTER searches, include the project key in the JQL (e.g., 'project = FDIT'). If user doesn't specify a project, call list_jira_projects first to discover available projects, then construct the JQL with the correct project key. Do NOT ask the user for the project key. Example JQL: 'project = FDIT AND status = Open'.",
      schema: z.object({
        jql: z.string().describe(jiraKey
          ? `REQUIRED: The JQL query string. Must include 'project = "${jiraKey}"' unless searching across all projects.`
          : "REQUIRED: The JQL query string. Should include 'project = KEY' for faster results. Use list_jira_projects to discover the key if not provided by the user."),
      }),
      func: (input) => getJiraIssues(input, userId, jiraKey),
    }),
    new DynamicStructuredTool({
      name: "list_jira_projects",
      description: jiraKey
        ? `List Jira projects. The current workspace is scoped to project "${jiraKey}". Only use this if the user explicitly asks to see all their Jira projects.`
        : "List all Jira projects the user has access to. Returns each project's key, name, and type. Use this when the user asks to find a project, check if a project exists, or list all projects/spaces.",
      schema: z.object({}),
      func: (input) => listJiraProjects(input, userId, jiraKey),
    }),
    new DynamicStructuredTool({
      name: "list_jira_sprints",
      description: jiraKey
        ? `List sprints for the current project "${jiraKey}". Returns each sprint's ID, name, state (active, future, closed), and dates.`
        : "List all sprints for a given Jira project. Returns each sprint's ID, name, state (active, future, closed), and dates. Use this when the user asks 'what sprint is active', 'show the backlog', or 'list sprints'.",
      schema: z.object({
        projectKey: z.string().optional().describe(jiraKey
          ? `Project Key. Defaults to "${jiraKey}" if not specified.`
          : "REQUIRED: The Project Key (e.g., 'FDIT')."),
        state: z.string().optional().describe("Optional filter for sprint state: 'active', 'future', or 'closed'.")
      }),
      func: (input) => listJiraSprints({ ...input, projectKey: input.projectKey || jiraKey }, userId),
    }),
  ];

  const jiraWriteTools = [
    new DynamicStructuredTool({
      name: "create_jira_issue",
      description: jiraKey
        ? `Create a Jira ticket in project "${jiraKey}". The projectKey defaults to "${jiraKey}" — do NOT use a different project unless the user explicitly specifies one. For WBS/hierarchy: create Epics first, then pass the Epic's key as 'parent' when creating Stories/Tasks underneath.`
        : "Create a Jira ticket. REQUIRES 'projectKey'. If user doesn't specify which project/space, use list_jira_projects to find the correct project key. Only ask the user if multiple projects exist and the correct one is ambiguous. For WBS/hierarchy: create Epics first, then pass the Epic's key as 'parent' when creating Stories/Tasks underneath.",
      schema: z.object({
        projectKey: z.string().optional().describe(jiraKey
          ? `Project Key. Defaults to "${jiraKey}".`
          : "REQUIRED: Project Key (e.g., 'FDIT'). Use list_jira_projects to discover if not provided by the user."),
        summary: z.string().describe("REQUIRED: Ticket title"),
        description: z.string().optional(),
        issueType: z.string().optional().describe("Issue type: 'Epic', 'Story', 'Task', 'Sub-task', or 'Bug'. Default: 'Task'."),
        parent: z.string().optional().describe("Parent issue key (e.g., 'PROJ-1') to create this issue under. Use for hierarchy: Stories under Epics, Tasks under Stories, Sub-tasks under Tasks."),
      }),
      func: (input) => createJiraIssue({ ...input, projectKey: input.projectKey || jiraKey }, userId),
    }),
    new DynamicStructuredTool({
      name: "update_jira_issue",
      description: "Update a Jira ticket's fields. REQUIRES 'issueKey' (e.g., 'FDIT-12'). If user doesn't specify the ticket key, search for it first using search_jira_issues. Only ask the user if the search returns multiple ambiguous matches. Supports: Status, Priority, Summary, Description, Assignee, Due Date, Labels, and Parent. Do NOT change the summary unless explicitly asked.",
      schema: z.object({
        issueKey: z.string().describe("REQUIRED: The ticket key (e.g., 'FDIT-12'). Use search_jira_issues to find it if not provided by the user."),
        summary: z.string().optional().describe("New title for the ticket."),
        description: z.string().optional().describe("New description text."),
        status: z.string().optional().describe("Target status to move to (e.g., 'In Progress', 'Done')."),
        priority: z.string().optional().describe("Target priority. MUST be one of: 'Highest', 'High', 'Medium', 'Low', 'Lowest'."),
        assignee: z.string().optional().describe("Account ID of the user to assign to."),
        duedate: z.string().optional().describe("Due date in 'YYYY-MM-DD' format."),
        labels: z.array(z.string()).optional().describe("Array of label strings."),
        parent: z.string().optional().describe("Key of the parent issue (e.g. for subtasks)."),
      }),
      func: (input) => updateJiraIssue(input, userId),
    }),
    new DynamicStructuredTool({
      name: "delete_jira_issue",
      description: "Delete a Jira ticket by its key. REQUIRES 'issueKey' (e.g., 'FDIT-123'). If user doesn't specify the ticket key, search for it first using search_jira_issues. Only ask the user if the search returns multiple ambiguous matches.",
      schema: z.object({
          issueKey: z.string().describe("REQUIRED: The ticket key to delete (e.g., 'FDIT-123'). Use search_jira_issues to find it if not provided by the user."),
      }),
      func: (input) => deleteJiraIssue(input, userId),
    }),
    new DynamicStructuredTool({
      name: "create_jira_project",
      description: "Create a new Jira Project (sometimes referred to as a Space). REQUIRES ADMIN RIGHTS. REQUIRES 'key' and 'name'. If the user provides a name but not a key, generate a reasonable uppercase key from the name (e.g., 'My Project' → 'MP'). Only ask the user if neither name nor key is provided.",
      schema: z.object({
          key: z.string().describe("REQUIRED: The Project Key (e.g., 'NEWPROJ'). Must be unique and uppercase. Derive from project name if not explicitly provided."),
          name: z.string().describe("REQUIRED: The name of the project. Ask the user if not provided."),
          description: z.string().optional().describe("Project description."),
          templateKey: z.string().optional().describe("Template key (default: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic')."),
          projectTypeKey: z.string().optional().describe("Type key (default: 'software')."),
      }),
      func: (input) => createJiraProject(input, userId),
    }),
    new DynamicStructuredTool({
      name: "create_jira_sprint",
      description: jiraKey
        ? `Create a new Jira Sprint on project "${jiraKey}"'s Agile board. The projectKey defaults to "${jiraKey}". REQUIRES 'name'. Can optionally supply startDate, endDate, and goal.`
        : "Create a new Jira Sprint on a project's Agile board. REQUIRES 'projectKey' and 'name'. Can optionally supply startDate, endDate, and goal.",
      schema: z.object({
          projectKey: z.string().optional().describe(jiraKey
            ? `Project Key. Defaults to "${jiraKey}".`
            : "REQUIRED: The Project Key (e.g., 'FDIT') where the sprint should be created."),
          name: z.string().describe("REQUIRED: The name of the sprint (e.g., 'Sprint 1')."),
          goal: z.string().optional().describe("Goal of the sprint."),
          startDate: z.string().optional().describe("Start date in ISO 8601 format (e.g., '2026-03-24T15:00:00.000Z')."),
          endDate: z.string().optional().describe("End date in ISO 8601 format (e.g., '2026-04-07T15:00:00.000Z')."),
      }),
      func: (input) => createJiraSprint({ ...input, projectKey: input.projectKey || jiraKey }, userId),
    }),
    new DynamicStructuredTool({
      name: "update_jira_sprint",
      description: "Update an existing Jira Sprint or start/close it. REQUIRES 'sprintId'. Use this to start a sprint by setting state to 'active', close it with 'closed', or change its name/dates/goal.",
      schema: z.object({
          sprintId: z.number().describe("REQUIRED: The numeric ID of the sprint."),
          name: z.string().optional().describe("New name for the sprint."),
          state: z.string().optional().describe("State to change the sprint to: 'active' (to start it) or 'closed' (to end it)."),
          goal: z.string().optional().describe("New goal for the sprint."),
          startDate: z.string().optional().describe("New start date in ISO 8601 format."),
          endDate: z.string().optional().describe("New end date in ISO 8601 format."),
      }),
      func: (input) => updateJiraSprint(input, userId),
    }),
    new DynamicStructuredTool({
      name: "add_issues_to_sprint",
      description: "Add one or more Jira issues/tickets to a specific sprint. REQUIRES 'sprintId' and an array of 'issues' (keys or IDs).",
      schema: z.object({
          sprintId: z.number().describe("REQUIRED: The numeric ID of the sprint."),
          issues: z.array(z.string()).describe("REQUIRED: Array of issue keys to add (e.g., ['FDIT-1', 'FDIT-2'])."),
      }),
      func: (input) => addIssuesToSprint(input, userId),
    }),
  ];

  // --- SLACK TOOLS ---
  const slackCustomTools = [
    new DynamicStructuredTool({
      name: "send_slack_message",
      description: "Send a message to a Slack channel. Use for team notifications, updates, or announcements.",
      schema: z.object({
        channel: z.string().optional().describe("Channel name (with or without #) or channel ID. Defaults to SLACK_DEFAULT_CHANNEL."),
        message: z.string().describe("The message text to send."),
      }),
      func: (input) => sendSlackMessage(input, userId),
    }),
    new DynamicStructuredTool({
      name: "send_slack_announcement",
      description: "Post a formatted announcement with title, body, and optional footer using Slack Block Kit. Great for deployment notices or status reports.",
      schema: z.object({
        channel: z.string().optional().describe("Channel name or ID. Defaults to SLACK_DEFAULT_CHANNEL."),
        title: z.string().describe("Announcement headline."),
        body: z.string().describe("Main content of the announcement."),
        footer: z.string().optional().describe("Optional footer text."),
        type: z.enum(['info', 'success', 'warning', 'error']).optional().describe("Type of announcement for emoji styling."),
      }),
      func: (input) => sendSlackAnnouncement(input, userId),
    }),
    new DynamicStructuredTool({
      name: "send_slack_link",
      description: "Share a URL with contextual message in a Slack channel. Perfect for sharing Jira tickets, GitHub PRs, or docs.",
      schema: z.object({
        channel: z.string().optional().describe("Channel name or ID. Defaults to SLACK_DEFAULT_CHANNEL."),
        url: z.string().describe("The URL to share."),
        context: z.string().optional().describe("Contextual message to accompany the link."),
      }),
      func: (input) => sendSlackLink(input, userId),
    }),
  ];

  // --- CALENDAR TOOLS ---
  const calendarTools = [
    new DynamicStructuredTool({
      name: "get_calendar_events",
      description: "Get upcoming events from Google Calendar. Use this to check what meetings or events are scheduled.",
      schema: z.object({
        maxResults: z.number().optional().describe("Maximum number of events to return. Default is 10."),
        timeMin: z.string().optional().describe("Start time for events query in ISO format (e.g., 2026-01-15T09:00:00). Defaults to now."),
        timeMax: z.string().optional().describe("End time for events query in ISO format. Optional."),
        calendarId: z.string().optional().describe("Calendar ID to query. Defaults to 'primary'."),
      }),
      func: (input) => getCalendarEvents(input, userId),
    }),
    new DynamicStructuredTool({
      name: "create_calendar_event",
      description: "Create a new event on Google Calendar. Use this to schedule meetings, appointments, or reminders. YOU must calculate ISO timestamps from natural language dates.",
      schema: z.object({
        summary: z.string().describe("Title of the event"),
        description: z.string().optional().describe("Description or notes for the event"),
        startDateTime: z.string().describe("Start date and time in ISO format (e.g., 2026-01-15T14:00:00). Calculate this from user's natural language like 'next Tuesday at 2pm'."),
        endDateTime: z.string().describe("End date and time in ISO format (e.g., 2026-01-15T15:00:00). Default to 1 hour after start if not specified."),
        location: z.string().optional().describe("Location of the event"),
        attendees: z.array(z.string()).optional().describe("Array of email addresses to invite"),
        timeZone: z.string().optional().describe("Timezone for the event (e.g., 'America/Toronto'). Defaults to user's timezone."),
      }),
      func: (input) => createCalendarEvent({ ...input, timeZone: input.timeZone || userTimezone }, userId),
    }),
    new DynamicStructuredTool({
      name: "update_calendar_event",
      description: "Update an existing event on Google Calendar. Use this to change meeting details.",
      schema: z.object({
        eventId: z.string().describe("The ID of the event to update"),
        summary: z.string().optional().describe("New title for the event"),
        description: z.string().optional().describe("New description for the event"),
        startDateTime: z.string().optional().describe("New start date and time in ISO format"),
        endDateTime: z.string().optional().describe("New end date and time in ISO format"),
        location: z.string().optional().describe("New location for the event"),
      }),
      func: (input) => updateCalendarEvent({ ...input, timeZone: input.timeZone || userTimezone }, userId),
    }),
    new DynamicStructuredTool({
      name: "delete_calendar_event",
      description: "Delete an event from Google Calendar.",
      schema: z.object({
        eventId: z.string().describe("The ID of the event to delete"),
      }),
      func: (input) => deleteCalendarEvent(input, userId),
    }),
    new DynamicStructuredTool({
      name: "find_free_time",
      description: "Check for free/busy time in a given time range. Use this to find available slots for scheduling.",
      schema: z.object({
        timeMin: z.string().describe("Start of time range to check in ISO format"),
        timeMax: z.string().describe("End of time range to check in ISO format"),
      }),
      func: (input) => findFreeTime({ ...input, timeZone: input.timeZone || userTimezone }, userId),
    }),
  ];

  // --- GITHUB TOOLS (custom) ---
  const githubReadTools = [
    new DynamicStructuredTool({
      name: "get_repo_issues",
      description: "List issues for a GitHub repository. Requires owner and repo name.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name (e.g., 'Hello-World')."),
      }),
      func: (input) => getRepoIssues(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_commits",
      description: "List recent commits for a GitHub repository.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        limit: z.number().optional().describe("Number of commits to return. Default 5."),
      }),
      func: (input) => listCommits(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_pull_requests",
      description: "List pull requests for a GitHub repository.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        state: z.string().optional().describe("PR state: 'open', 'closed', or 'all'. Default 'open'."),
      }),
      func: (input) => listPullRequests(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_pull_request",
      description: "Get details of a specific pull request.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        pullNumber: z.number().describe("The pull request number."),
      }),
      func: (input) => getPullRequest(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_commit",
      description: "Get details of a specific commit by SHA.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        sha: z.string().describe("The commit SHA."),
      }),
      func: (input) => getCommit(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_repo_checks",
      description: "Get check runs for a specific git ref (branch, tag, or SHA).",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        ref: z.string().describe("Git ref (branch name, tag, or commit SHA)."),
      }),
      func: (input) => getRepoChecks(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_branches",
      description: "List all branches for a GitHub repository, including which is the default branch and whether each is protected.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name (e.g., 'Hello-World')."),
      }),
      func: (input) => listBranches(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_repo_info",
      description: "Get detailed information about a GitHub repository including default branch, description, stars, forks, open issues, visibility, language, and topics.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
      }),
      func: (input) => getRepoInfo(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_repositories",
      description: "List GitHub repositories for the authenticated user or a specified user. Returns repo name, description, language, stars, and visibility.",
      schema: z.object({
        owner: z.string().optional().describe("GitHub username to list repos for. Omit to list your own repositories."),
        type: z.string().optional().describe("Filter type: 'all', 'owner', 'public', 'private', 'member'. Default 'all'."),
        sort: z.string().optional().describe("Sort by: 'created', 'updated', 'pushed', 'full_name'. Default 'updated'."),
        perPage: z.number().optional().describe("Number of repos to return (max 100). Default 30."),
      }),
      func: (input) => listRepositories(input, userId),
    }),
  ];

  const githubWriteTools = [
    new DynamicStructuredTool({
      name: "create_repository",
      description: "Create a new GitHub repository for the authenticated user.",
      schema: z.object({
        name: z.string().describe("Repository name."),
        description: z.string().optional().describe("Repository description."),
        isPrivate: z.boolean().optional().describe("Whether the repo should be private. Default false."),
      }),
      func: (input) => createRepository(input, userId),
    }),
    new DynamicStructuredTool({
      name: "create_repo_issue",
      description: "Create a new issue on a GitHub repository.",
      schema: z.object({
        owner: z.string().optional().describe("Repository owner. Defaults to the authenticated user's GitHub username."),
        repo: z.string().describe("Repository name."),
        title: z.string().describe("Issue title."),
        body: z.string().optional().describe("Issue body/description."),
      }),
      func: (input) => createRepoIssue(input, userId),
    }),
  ];

  // --- FIGMA TOOLS (custom) ---
  const figmaTools = [
    new DynamicStructuredTool({
      name: "get_figma_file_structure",
      description: "Get the structure (pages and frames) of a Figma design file. Requires the file key from the Figma URL.",
      schema: z.object({
        fileKey: z.string().describe("The Figma file key (from the URL: figma.com/file/KEY/Name)."),
      }),
      func: (input) => getFigmaFileStructure(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_figma_comments",
      description: "Get comments on a Figma file.",
      schema: z.object({
        fileKey: z.string().describe("The Figma file key."),
      }),
      func: (input) => getFigmaComments(input, userId),
    }),
    new DynamicStructuredTool({
      name: "post_figma_comment",
      description: "Post a comment on a Figma file.",
      schema: z.object({
        fileKey: z.string().describe("The Figma file key."),
        message: z.string().describe("The comment message to post."),
        node_id: z.string().optional().describe("Optional node ID to attach the comment to a specific element."),
      }),
      func: (input) => postFigmaComment(input, userId),
    }),
  ];

  // --- GMAIL TOOLS ---
  const gmailTools = [
    new DynamicStructuredTool({
      name: "send_gmail",
      description: "Send an email via Gmail. Use this when the user wants to email someone. ALWAYS confirm the recipient email, subject, and body with the user before sending. If the user refers to a person by name, use search_gmail_contacts FIRST to resolve their email address.",
      schema: z.object({
        to: z.string().describe("REQUIRED: Recipient email address."),
        subject: z.string().describe("REQUIRED: Email subject line."),
        body: z.string().describe("REQUIRED: Email body text."),
        cc: z.string().optional().describe("CC email address (comma-separated for multiple)."),
        bcc: z.string().optional().describe("BCC email address (comma-separated for multiple)."),
      }),
      func: (input) => sendGmail(input, userId),
    }),
    new DynamicStructuredTool({
      name: "search_gmail_contacts",
      description: "Search the user's email history to find someone's email address by name. Use this when the user says 'email John' or 'send it to Sarah' — resolve the name to an email address before sending. Returns matching contacts from sent/received emails.",
      schema: z.object({
        query: z.string().describe("REQUIRED: Person's name or partial email address to search for."),
      }),
      func: (input) => searchGmailContacts(input, userId),
    }),
    new DynamicStructuredTool({
      name: "get_recent_emails",
      description: "Get recent emails from the user's Gmail inbox. Use to check inbox, find specific emails, or summarize recent mail.",
      schema: z.object({
        maxResults: z.number().optional().describe("Maximum number of emails to return. Default 10, max 50."),
        query: z.string().optional().describe("Optional Gmail search query to filter emails (e.g., 'from:john', 'subject:meeting', 'is:unread')."),
      }),
      func: (input) => getRecentEmails(input, userId),
    }),
  ];

  // --- FILE TOOLS ---
  const fileTools = [
    new DynamicStructuredTool({
      name: "read_file",
      description: "Read an uploaded file — auto-detects type (.pdf, .docx, .txt, .md, .json, etc.) and extracts content. Use when the user has attached a file.",
      schema: z.object({
        filePath: z.string().describe("The server path to the uploaded file."),
      }),
      func: readFile,
    }),
  ];

  // Return all tools as a flat array — no category routing needed
  return [
    ...imageTools,
    ...jiraReadTools, ...jiraWriteTools,
    ...githubReadTools, ...githubWriteTools,
    ...figmaTools,
    ...calendarTools,
    ...slackCustomTools,
    ...gmailTools,
    ...fileTools,
  ];
}

// (Traffic Cop classifier removed — all tools now given to the LLM directly)

// =============================================================================
// CONFIRMATION DETECTION
// Detects when user is confirming/approving a previously proposed action
// =============================================================================

const CONFIRMATION_PHRASES = new Set([
    'go', 'yes', 'yep', 'yeah', 'yup', 'do it', 'proceed', 'confirmed',
    'approved', 'go ahead', 'sure', 'ok', 'okay', 'affirmative',
    'please do', 'go for it', 'make it happen', 'execute', 'run it',
    'do that', 'yes please', 'confirm', 'let\'s go', 'sounds good',
    'perfect', 'do it now', 'yes do it', 'go on', 'carry on',
    'continue', 'alright', 'right', 'please', 'absolutely', 'definitely'
]);

const FILLER_WORDS = new Set(['it', 'that', 'this', 'the', 'a', 'now', 'then']);

function isConfirmationMessage(message, chatHistory) {
    if (!chatHistory || chatHistory.length === 0) return false;

    const trimmed = message.trim().toLowerCase().replace(/[.!,?]+$/, '').trim();
    if (CONFIRMATION_PHRASES.has(trimmed)) return true;

    const words = trimmed.split(/\s+/);
    if (words.length > 4) return false;

    // Check if entire message is confirmation phrases + filler words
    let remaining = trimmed;
    const sortedPhrases = [...CONFIRMATION_PHRASES].sort((a, b) => b.length - a.length);
    for (const phrase of sortedPhrases) {
        remaining = remaining.replace(
            new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ''
        ).trim();
    }

    if (remaining === '') return true;
    return remaining.split(/\s+/).every(w => FILLER_WORDS.has(w));
}

// classifyIntent and getToolsForCategories removed — all tools given to agent directly
// (see git history for the removed Traffic Cop code)

// =============================================================================
// CHAT HISTORY PERSISTENCE
// =============================================================================

// Maximum number of recent messages to pass to the LLM/agent.
// Prevents the model from confusing old tool results with the current request.
const MAX_HISTORY_MESSAGES = 30;

/**
 * Trim history to the last N messages to avoid context pollution.
 * Old tool-call confirmations can cause the LLM to believe a new request
 * has already been completed ("hallucination via history").
 */
function trimHistory(messages) {
    if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
    return messages.slice(-MAX_HISTORY_MESSAGES);
}

// =============================================================================
// TOKEN ESTIMATION (for pre-flight GitHub Models limit check)
// =============================================================================

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil((typeof text === 'string' ? text : JSON.stringify(text)).length / 4);
}

function estimateMessagesTokens(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

const GITHUB_MODELS_SAFE_LIMIT = 7000;

function wouldExceedGitHubLimit(systemPromptText, history, userQuery) {
    const total = estimateTokens(systemPromptText)
        + estimateMessagesTokens(history)
        + estimateTokens(userQuery);
    return total > GITHUB_MODELS_SAFE_LIMIT;
}

/**
 * Sanitize history to remove AI messages that describe repeated tool failures.
 * This prevents the LLM from "learning" that a tool always fails and refusing
 * to call it again, even after the underlying issue is fixed.
 *
 * Only strips AI messages matching known error patterns. Human messages are
 * always preserved so the agent understands context.
 */
const TOOL_FAILURE_PATTERNS = [
    // Slack failures
    /not_in_channel/i,
    /channel_not_found/i,
    /missing_scope/i,
    /Failed to send Slack/i,
    /Failed to send announcement/i,
    /Failed to share link/i,
    /Slack API Error/i,
    /I am not currently a member/i,
    /not currently a member of/i,
    /precludes me from sending/i,
    // Jira failures (deprecated API, 410 Gone, etc.)
    /410 Gone/i,
    /API has been removed/i,
    /migrate to.*search\/jql/i,
    /recalcitrant/i,
    /no longer supported by Atlassian/i,
    /Jira API.*Error/i,
    /protocols are updated/i,
    // General failure patterns
    /repeatedly attempt/i,
    /consistently failed/i,
    /previous attempts.*failed/i,
    /decline to re-attempt/i,
    /fundamental issue with.*integration/i,
];

function sanitizeHistoryForTools(messages) {
    const now = new Date();
    
    return messages.filter((msg, index) => {
        const type = typeof msg._getType === 'function' ? msg._getType() : msg.type;
        
        // 1. Always keep human messages
        if (type === 'human') return true;

        const content = (msg.content || '').toString();

        // 2. AGE-BASED PRUNING: Only keep tool/AI messages from the last 10 turns (5 exchanges)
        // to prevent "hallucination via history" where the LLM thinks a past 
        // success fulfills a current request.
        const turnIndexFromEnd = messages.length - index;
        if (turnIndexFromEnd > 10) {
            console.log(`[History Sanitizer] Pruned old message (turn ${turnIndexFromEnd})`);
            return false;
        }

        // 3. FAILURE PATTERN PRUNING
        const isFailureMessage = TOOL_FAILURE_PATTERNS.some(pattern => pattern.test(content));
        if (isFailureMessage) {
            console.log(`[History Sanitizer] Stripped failure message: "${content.substring(0, 80)}..."`);
            return false;
        }

        // 4. HEAVY DATA PRUNING: If a tool output is massive (e.g., full file content or 50 tickets),
        // we keep the message but truncate the content to keep the LLM focused.
        if (content.length > 2000) {
            console.log(`[History Sanitizer] Truncated heavy message (${content.length} chars)`);
            msg.content = content.substring(0, 1500) + "\n\n[... CONTENT TRUNCATED BY E.D.I.T.H. TO PRESERVE FOCUS ...]";
        }

        return true;
    });
}

import { connectDB, Chat, User } from './db.js';

// Global cache variable (optional for performance, but database is the source of truth)
const historyCache = {}; 

class MongoChatMessageHistory extends BaseListChatMessageHistory {
    constructor(sessionId, userId) {
        super();
        this.sessionId = sessionId;
        this.userId = userId;
    }

    async ensureUser() {
        if (this.userId) return this.userId;
        throw new Error("History isolation requires a userId.");
    }

    async getMessages() {
        await this.ensureUser();
        try {
            const chat = await Chat.findOne({ userId: this.userId, sessionId: this.sessionId });
            if (!chat) return [];
            
            return chat.messages.map(msg => {
                switch (msg.role) {
                     case 'user': return new HumanMessage(msg.content);
                     case 'ai': return new AIMessage(msg.content);
                     default: return new HumanMessage(msg.content);
                }
            });
        } catch (e) {
            console.error("[History] Error reading from DB:", e);
            return [];
        }
    }

    async addMessage(message) {
        await this.ensureUser();
        const role = (message.getType ? message.getType() : message._getType()) === 'human' ? 'user' : 'ai';
        
        try {
            await Chat.findOneAndUpdate(
                { userId: this.userId, sessionId: this.sessionId },
                { 
                    $push: { messages: { role, content: message.content, timestamp: new Date() } },
                    $set: { lastUpdatedAt: new Date() }
                },
                { upsert: true }
            );
        } catch (e) {
            console.error("[History] Failed to save to DB:", e.message);
        }
    }

    async clear() {
        await this.ensureUser();
        await Chat.deleteOne({ userId: this.userId, sessionId: this.sessionId });
    }
}

function getMessageHistory(sessionId, userId) {
  return new MongoChatMessageHistory(sessionId, userId);
}

// =============================================================================
// DYNAMIC AGENT CREATION
// =============================================================================

// Create agent with fresh timestamp each time (don't cache system prompt)
function getOrCreateAgent(tools, userTimezone, userId, userLLM, userPrefs, projectContext = null) {
    // Always get fresh system prompt with current time
    let systemPrompt = getSystemPrompt(userTimezone, userPrefs);

    // Inject project context into the system prompt if available
    if (projectContext) {
        let projectBlock = '\n\n[PROJECT CONTEXT]\nThe user is working within a project workspace.';
        if (projectContext.jiraProjectKey) {
            projectBlock += `\n- Jira Project Key: ${projectContext.jiraProjectKey} (use as default for all Jira queries)`;
        }
        if (projectContext.githubRepo) {
            projectBlock += `\n- GitHub Repository: ${projectContext.githubRepo} (use as default owner/repo for all GitHub queries)`;
        }
        projectBlock += '\nWhen the user asks about issues, PRs, tickets without specifying a project or repo, default to these values.';
        // systemPrompt is a SystemMessage — append to its content
        if (typeof systemPrompt === 'string') {
            systemPrompt = systemPrompt + projectBlock;
        } else if (systemPrompt.content) {
            systemPrompt = new SystemMessage(systemPrompt.content + projectBlock);
        }
    }

    // Create a signature based on userId and tool names
    const toolSignature = `${userId}:${tools.map(t => t.name).sort().join(',')}`;

    // Don't cache agents - always create fresh to ensure current timestamp
    const agent = createReactAgent({
        llm: userLLM,
        tools,
        stateModifier: systemPrompt,
        recursionLimit: 30,
    });
    
    console.log(`[Agent Factory] Created agent with tools: ${toolSignature || '(none)'}`);
    return agent;
}

// The main processing function that classifies intent and routes to appropriate agent
async function processWithSemanticRouting(input) {
    process.env.ACTIVE_REQUEST = 'true';
    const { input: userQuery, chat_history, userId, timezone } = input;

    const { llm } = await getLLMForUser(userId);
    const history = sanitizeHistoryForTools(trimHistory(Array.isArray(chat_history) ? chat_history : []));

    // Get ALL tools for this user (no classification needed)
    const effectiveTimezone = timezone || 'UTC';
    const allTools = createToolsForUser(userId, effectiveTimezone);
    const isConfirmation = isConfirmationMessage(userQuery, history);

    console.log(`[Agent] ${allTools.length} tools available${isConfirmation ? ' (confirmation)' : ''}`);

    const agent = getOrCreateAgent(allTools, timezone, userId, llm, input.userPrefs);

    const now = new Date();
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: effectiveTimezone };
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: effectiveTimezone };
    const freshTimeReminder = new HumanMessage(
        `[TIME UPDATE] Current time is now: ${now.toLocaleTimeString('en-US', timeOptions)} on ${now.toLocaleDateString('en-US', dateOptions)}. Any times mentioned in previous messages are outdated — use ONLY this time.`
    );
    let toolNudge;
    if (isConfirmation) {
        toolNudge = new HumanMessage(
            `[CONTINUATION] The user is confirming/approving a plan you previously proposed. ` +
            `Review your most recent message in the conversation history and EXECUTE the action(s) you described. ` +
            `Do NOT ask for further confirmation. Do NOT re-propose the plan. Proceed to call the tools now. ` +
            `You have ${allTools.length} tools available. Use them to carry out the plan. ` +
            `You MUST cite the Receipt (ID/Link) in your confirmation.`
        );
    } else {
        toolNudge = new HumanMessage(
            `[FRESHNESS GUARD] You have ${allTools.length} tools available. ` +
            `The following request from the user is NEW and INDEPENDENT. ` +
            `Even if you see a similar request or tool result in the conversation history, ` +
            `you MUST invoke the appropriate tool again to fulfill this specific request. ` +
            `Past successes or failures do NOT apply here. ALWAYS call the tool fresh. ` +
            `Execute the action directly. Do NOT ask the user to confirm information you can discover with your tools. ` +
            `Do NOT say you cannot do something unless a tool actually returned an error. ` +
            `You MUST cite the new Receipt (ID/Link) in your confirmation.`
        );
    }
    const result = await agent.invoke(
        { messages: [...history, freshTimeReminder, toolNudge, new HumanMessage(userQuery)] },
        { recursionLimit: 30 }
    );

    return result;
}

// Streaming version for the server to use
export async function* streamWithSemanticRouting(userQuery, userId, timezone, userPrefs, sessionId = 'session-general', projectContext = null) {
    process.env.ACTIVE_REQUEST = 'true';

    let excludeProviders = new Set();
    let lastError = null;
    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {

        const { llm, provider: activeProvider } = await getLLMForUser(userId, excludeProviders);

        const messageHistory = getMessageHistory(sessionId, userId);
        const fullHistory = await messageHistory.getMessages();
        const history = sanitizeHistoryForTools(trimHistory(fullHistory));

        // Pre-flight: Check if request is too large for GitHub Models
        if (activeProvider === 'github') {
            const systemPromptText = getSystemPrompt(timezone, userPrefs);
            if (wouldExceedGitHubLimit(systemPromptText.content || systemPromptText, history, userQuery)) {
                console.warn(`[LLM] Request too large for GitHub Models (~${estimateTokens(userQuery)} query tokens). Routing to Gemini.`);
                excludeProviders.add('github');
                continue;
            }
        }

        // Get ALL tools for this user (no classification needed — LLM picks tools naturally)
        const allTools = createToolsForUser(userId, timezone || 'UTC', projectContext);
        const isConfirmation = isConfirmationMessage(userQuery, history);

        console.log(`[Agent] ${allTools.length} tools available${isConfirmation ? ' (confirmation)' : ''}`);

        // Create agent with all tools
        const agent = getOrCreateAgent(allTools, timezone, userId, llm, userPrefs, projectContext);

        // Stream events from the agent (inject fresh time reminder before user query)
        const agentNow = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone };
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: timezone };
        const agentTimeReminder = new HumanMessage(
            `[TIME UPDATE] Current time is now: ${agentNow.toLocaleTimeString('en-US', timeOptions)} on ${agentNow.toLocaleDateString('en-US', dateOptions)}. Any times mentioned in previous messages are outdated — use ONLY this time.`
        );
        // Conditional guard: CONTINUATION for confirmations, FRESHNESS GUARD for new requests
        let toolNudge;
        if (isConfirmation) {
            toolNudge = new HumanMessage(
                `[CONTINUATION] The user is confirming/approving a plan you previously proposed. ` +
                `Review your most recent message in the conversation history and EXECUTE the action(s) you described. ` +
                `Do NOT ask for further confirmation. Do NOT re-propose the plan. Proceed to call the tools now. ` +
                `You have ${allTools.length} tools available. Use them to carry out the plan. ` +
                `You MUST cite the Receipt (ID/Link) in your confirmation.`
            );
        } else {
            toolNudge = new HumanMessage(
                `[FRESHNESS GUARD] You have ${allTools.length} tools available. ` +
                `The following request from the user is NEW and INDEPENDENT. ` +
                `Even if you see a similar request or tool result in the conversation history, ` +
                `you MUST invoke the appropriate tool again to fulfill this specific request. ` +
                `Past successes or failures do NOT apply here. ALWAYS call the tool fresh. ` +
                `Execute the action directly. Do NOT ask the user to confirm information you can discover with your tools. ` +
                `Do NOT say you cannot do something unless a tool actually returned an error. ` +
                `You MUST cite the new Receipt (ID/Link) in your confirmation.`
            );
        }
        const stream = agent.streamEvents(
            { messages: [...history, agentTimeReminder, toolNudge, new HumanMessage(userQuery)] },
            { version: "v2", recursionLimit: 30 }
        );

        let completeResponse = "";
        const STREAM_TIMEOUT_MS = 45000;

        // Repeated tool call detector — catches hallucination loops
        const MAX_REPEATED_CALLS = 3;
        let lastToolCall = null;
        let repeatCount = 0;

        // Track total tool errors to bail early when tools keep failing
        let toolErrorCount = 0;
        const MAX_TOOL_ERRORS = 8;

        // Wrap stream with inactivity timeout (properly clears timers)
        async function* withTimeout(source, timeoutMs) {
            const iterator = source[Symbol.asyncIterator]();
            while (true) {
                let timer;
                try {
                    const raceResult = await Promise.race([
                        iterator.next(),
                        new Promise((_, reject) => {
                            timer = setTimeout(() => reject(new Error('Stream inactivity timeout')), timeoutMs);
                        }),
                    ]);
                    clearTimeout(timer);
                    if (raceResult.done) break;
                    yield raceResult.value;
                } catch (err) {
                    clearTimeout(timer);
                    throw err;
                }
            }
        }

        for await (const event of withTimeout(stream, STREAM_TIMEOUT_MS)) {
          try {
            // Track tool calls to detect hallucination loops
            if (event.event === "on_tool_start") {
                const toolName = event.name || '';
                const toolInput = JSON.stringify(event.data?.input || {});
                const callSignature = `${toolName}:${toolInput}`;

                if (callSignature === lastToolCall) {
                    repeatCount++;
                    if (repeatCount >= MAX_REPEATED_CALLS) {
                        console.warn(`[Agent] Halting: tool "${toolName}" called ${MAX_REPEATED_CALLS}+ times with identical args. Likely hallucination loop.`);
                        yield {
                            event: "on_chat_model_stream",
                            data: { chunk: { content: "\n\nI noticed I was repeating the same action. Let me stop here and summarize what I've done so far." } }
                        };
                        break;
                    }
                } else {
                    lastToolCall = callSignature;
                    repeatCount = 1;
                }
            }

            // Track tool errors — bail if tools keep failing
            if (event.event === "on_tool_end") {
                const rawOutput = event.data?.output;
                const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput || '');
                if (outputStr.includes('"status":"error"') || outputStr.includes('"status": "error"')) {
                    toolErrorCount++;
                    if (toolErrorCount >= MAX_TOOL_ERRORS) {
                        console.warn(`[Agent] Bailing: ${toolErrorCount} tool errors reached. Forcing summary response.`);
                        yield {
                            event: "on_chat_model_stream",
                            data: { chunk: { content: "\n\nI'm running into repeated errors with the tools. Let me summarize what I was able to do and what failed." } }
                        };
                        break;
                    }
                }
            }

            // Forward the event
            yield event;

            // Capture final response for history
            if (event.event === "on_chat_model_stream") {
                const content = event.data?.chunk?.content;
                if (content) {
                    completeResponse += content;
                }
            }
          } catch (eventErr) {
            console.error('[Agent] Error processing stream event:', eventErr.message);
            // Continue processing — don't break the stream for a single event error
          }
        }

        // Save to history after streaming completes
        await messageHistory.addMessage(new HumanMessage(userQuery));
        if (completeResponse) {
            await messageHistory.addMessage(new AIMessage(completeResponse));
        }

        process.env.ACTIVE_REQUEST = 'false';
        return; // success — exit the retry loop

        } catch (error) {
            lastError = error;
            const is401 = error.message?.includes('401') || error.status === 401;
            const is403 = error.message?.includes('403') || error.status === 403;
            const is413 = error.message?.includes('413') || error.status === 413;
            const is429 = error.message?.includes('429') || error.status === 429;
            const isGitHubProvider = !excludeProviders.has('github');

            if ((is401 || is403 || is413 || is429) && isGitHubProvider && attempt < MAX_ATTEMPTS - 1) {
                console.warn(`[LLM] GitHub Models returned ${is401 ? '401' : is413 ? '413' : is429 ? '429' : '403'} for user ${userId}. Falling back to next provider...`);
                // Evict cached GitHub LLM so subsequent requests don't retry it
                const providerKey = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
                llmCache.delete(`${userId}:${providerKey}:`);
                excludeProviders.add('github');

                // Permanently block for 401/403 (token invalid or account not enrolled), not 413 or 429 (request-specific)
                if (is401 || is403) {
                    blockedProviders.set(userId, {
                        providers: new Set(['github']),
                        createdAt: Date.now()
                    });
                }

                continue; // retry with next provider
            }
            break; // non-retryable error
        }
    }

    // If we get here, all attempts failed
    console.error("[Agent] Stream error:", lastError);
    yield {
        event: "on_chat_model_stream",
        data: { chunk: { content: `\n\nI encountered an error processing your request: ${lastError.message}` } }
    };
    process.env.ACTIVE_REQUEST = 'false';
}

const outputAdapter = (state) => {
   // Compatibility handling for different LangGraph versions/returns
   let messages = state.messages;
   
   // Sometimes the state is nested under the node name (e.g. 'agent')
   if (!messages && state.agent && state.agent.messages) {
       messages = state.agent.messages;
   }
   
   if (!messages || !Array.isArray(messages) || messages.length === 0) {
       // DEBUG: If state is missing, return keys to help diagnosis
       const keys = state ? Object.keys(state).join(", ") : "NULL_STATE";
       const dump = state ? JSON.stringify(state).substring(0, 500) : "N/A";
       return { output: `[System Error] agentGraph returned invalid state. Keys: ${keys}. Dump: ${dump}` };
   }
   const lastMessage = messages[messages.length - 1];
   return { output: lastMessage.content };
};

const agentChain = RunnableSequence.from([
    new RunnableLambda({ func: processWithSemanticRouting }),
    outputAdapter
]);

export const agentExecutor = new RunnableWithMessageHistory({
  runnable: agentChain,
  getMessageHistory: getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history", 
  outputMessagesKey: "output",
});

console.log(" Tactical Systems Ready.");
