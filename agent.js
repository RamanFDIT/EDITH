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
import { createRepository, getRepoIssues, createRepoIssue, listCommits, listPullRequests, getPullRequest, getCommit, getRepoChecks, listBranches, getRepoInfo } from "./githubTool.js";
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
      console.log(`[LLM] Using Gemini for user ${userId} (Global Key)`);
      const llm = new ChatGoogleGenerativeAI("gemini-2.5-flash", { apiKey: apiKey });
      const classifier = new ChatGoogleGenerativeAI("gemini-2.0-flash-lite", { apiKey: apiKey, temperature: 0 });
      const result = { llm, classifier, provider: 'gemini' };
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
      const classifier = new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        openAIApiKey: githubToken,
        temperature: 0,
        configuration: { baseURL: ghBaseURL, apiKey: githubToken },
      });
      const result = { llm, classifier, provider: 'github' };
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
    const classifier = new ChatOllama({ baseUrl: ollamaBaseUrl, model: ollamaModel, temperature: 0 });
    const result = { llm, classifier, provider: 'ollama' };
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

function createToolsForUser(userId) {
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
  const jiraReadTools = [
    new DynamicStructuredTool({
      name: "search_jira_issues",
      description: "Search Jira issues using JQL. For FASTER searches, include the project key in the JQL (e.g., 'project = FDIT'). If user doesn't specify a project, call list_jira_projects first to discover available projects, then construct the JQL with the correct project key. Do NOT ask the user for the project key. Example JQL: 'project = FDIT AND status = Open'.",
      schema: z.object({
        jql: z.string().describe("REQUIRED: The JQL query string. Should include 'project = KEY' for faster results. Use list_jira_projects to discover the key if not provided by the user."),
      }),
      func: (input) => getJiraIssues(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_jira_projects",
      description: "List all Jira projects the user has access to. Returns each project's key, name, and type. Use this when the user asks to find a project, check if a project exists, or list all projects/spaces.",
      schema: z.object({}),
      func: (input) => listJiraProjects(input, userId),
    }),
    new DynamicStructuredTool({
      name: "list_jira_sprints",
      description: "List all sprints for a given Jira project. Returns each sprint's ID, name, state (active, future, closed), and dates. Use this when the user asks 'what sprint is active', 'show the backlog', or 'list sprints'.",
      schema: z.object({
        projectKey: z.string().describe("REQUIRED: The Project Key (e.g., 'FDIT')."),
        state: z.string().optional().describe("Optional filter for sprint state: 'active', 'future', or 'closed'.")
      }),
      func: (input) => listJiraSprints(input, userId),
    }),
  ];

  const jiraWriteTools = [
    new DynamicStructuredTool({
      name: "create_jira_issue",
      description: "Create a Jira ticket. REQUIRES 'projectKey'. If user doesn't specify which project/space, use list_jira_projects to find the correct project key. Only ask the user if multiple projects exist and the correct one is ambiguous. For WBS/hierarchy: create Epics first, then pass the Epic's key as 'parent' when creating Stories/Tasks underneath.",
      schema: z.object({
        projectKey: z.string().describe("REQUIRED: Project Key (e.g., 'FDIT'). Use list_jira_projects to discover if not provided by the user."),
        summary: z.string().describe("REQUIRED: Ticket title"),
        description: z.string().optional(),
        issueType: z.string().optional().describe("Issue type: 'Epic', 'Story', 'Task', 'Sub-task', or 'Bug'. Default: 'Task'."),
        parent: z.string().optional().describe("Parent issue key (e.g., 'PROJ-1') to create this issue under. Use for hierarchy: Stories under Epics, Tasks under Stories, Sub-tasks under Tasks."),
      }),
      func: (input) => createJiraIssue(input, userId),
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
      description: "Create a new Jira Sprint on a project's Agile board. REQUIRES 'projectKey' and 'name'. Can optionally supply startDate, endDate, and goal.",
      schema: z.object({
          projectKey: z.string().describe("REQUIRED: The Project Key (e.g., 'FDIT') where the sprint should be created."),
          name: z.string().describe("REQUIRED: The name of the sprint (e.g., 'Sprint 1')."),
          goal: z.string().optional().describe("Goal of the sprint."),
          startDate: z.string().optional().describe("Start date in ISO 8601 format (e.g., '2026-03-24T15:00:00.000Z')."),
          endDate: z.string().optional().describe("End date in ISO 8601 format (e.g., '2026-04-07T15:00:00.000Z')."),
      }),
      func: (input) => createJiraSprint(input, userId),
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
        timeZone: z.string().optional().describe("Timezone for the event. Defaults to system timezone."),
      }),
      func: (input) => createCalendarEvent(input, userId),
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
      func: (input) => updateCalendarEvent(input, userId),
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
      func: (input) => findFreeTime(input, userId),
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

  // Category map for this user's tools
  const toolsByCategory = {
    jira_read:    jiraReadTools,
    jira_write:   jiraWriteTools,
    github_read:  githubReadTools,
    github_write: githubWriteTools,
    figma:        figmaTools,
    calendar:     calendarTools,
    slack:        slackCustomTools,
    gmail:        gmailTools,
    image:        imageTools,
    files:        fileTools,
    general:      [],
  };

  return toolsByCategory;
}

// =============================================================================
// SEMANTIC CLASSIFIER (The Traffic Cop)
// =============================================================================

const CLASSIFIER_PROMPT = `You are a fast intent classifier for an AI assistant named E.D.I.T.H.
Your ONLY job is to classify the user's message into ONE OR MORE categories.

CATEGORIES:
- jira_read: Reading/searching Jira tickets, issues, epics, sprints, backlogs (queries, lookups, listing)
- jira_write: Creating, updating, or deleting Jira tickets, issues, projects
- github_read: Reading GitHub data: commits, PRs, issues, checks, branches, repo info, default branch (queries, lookups, listing)
- github_write: Creating repos, issues, or any write operation on GitHub
- figma: Anything about designs, mockups, UI/UX, wireframes, Figma files, design comments
- calendar: Anything about scheduling, meetings, appointments, events, calendar, free time, availability, reminders
- slack: Sending messages to Slack, posting announcements, notifying team, messaging channels, team notifications
- gmail: Sending emails, reading inbox, checking mail, finding someone's email address, emailing a person
- image: Generating images, pictures, illustrations, graphics, logos, artwork, drawings, visualisations
- files: Reading uploaded documents, files, PDFs, Word docs, summarizing attached documents
- general: Casual conversation, greetings, questions that don't need tools, chitchat

RULES:
1. Output ONLY the category name(s), comma-separated if multiple apply
2. If unsure, output "general"
3. Do NOT explain, do NOT add any other text
4. Be fast and decisive
5. For queries that both read and write, include both (e.g., jira_read,jira_write)

EXAMPLES:
User: "How many epics do I have?" -> jira_read
User: "Check my open PRs on the EDITH repo" -> github_read
User: "Hello, how are you?" -> general
User: "Create a ticket for the login bug" -> jira_write
User: "Update ticket FDIT-123 to done" -> jira_write
User: "List all my Jira tickets and mark the first one done" -> jira_read,jira_write
User: "Read the comments on the dashboard design" -> figma
User: "What branches does the EDITH repo have?" -> github_read
User: "What's the default branch?" -> github_read
User: "Create a new repo called test-app" -> github_write
User: "What meetings do I have today?" -> calendar
User: "Schedule a call with John next Tuesday at 2pm" -> calendar
User: "Am I free tomorrow afternoon?" -> calendar
User: "Cancel my 3pm meeting" -> calendar
User: "Tell the dev-team I fixed the bug" -> slack
User: "Post to #general that deployment is complete" -> slack
User: "Notify the team about the new release" -> slack
User: "Send an email to John about the meeting" -> gmail
User: "What emails did I get today?" -> gmail
User: "Email Sarah the project update" -> gmail
User: "Check my inbox" -> gmail
User: "Generate an image of a sunset over mountains" -> image
User: "Draw me a logo for my app" -> image
User: "Create a picture of a robot" -> image
User: "Read the uploaded file" -> files
User: "Summarize that document" -> files
User: "What does the PDF say?" -> files

User message: `;

// Define keywords for the "Fast Pass"
const KEYWORD_MAP = {
    jira_read: [
        'list tickets', 'show tickets', 'get tickets', 'search jira', 'find ticket',
        'how many epics', 'what tickets', 'show epics', 'backlog', 'sprint status',
        'list projects', 'show projects', 'find project', 'what projects', 'jira projects',
        'list spaces', 'show spaces', 'find space', 'what spaces', 'my spaces',
        'check space', 'check project', 'does project exist', 'does space exist',
        'look for project', 'look for space', 'which projects', 'which spaces',
        'list sprints', 'show sprints', 'find sprint'
    ],
    jira_write: [
        'create ticket', 'make ticket', 'new ticket', 'update ticket', 'delete ticket',
        'mark as done', 'change status', 'assign to', 'set priority', 'create issue',
        'create epic', 'create project', 'create space', 'new project', 'new space',
        'make task', 'create task', 'new task', 'create sprint', 'new sprint',
        'start sprint', 'end sprint', 'close sprint', 'update sprint', 'add to sprint', 'sprint planning',
        'in progress', 'into progress', 'move to', 'move into', 'mark done', 'mark complete',
        'to done', 'transition', 'to do', 'move these', 'move all'
    ],
    github_read: [
        'list commits', 'show commits', 'check pr', 'list pr', 'show pull requests',
        'get checks', 'repo status', 'list issues', 'list branches', 'show branches',
        'what branches', 'default branch', 'main branch', 'repo info', 'repository info'
    ],
    github_write: [
        'create repo', 'new repository', 'create issue', 'make issue'
    ],
    figma: [
        'figma', 'design', 'mockup', 'wireframe', 'ux', 'ui', 'color', 'frame', 
        'layer', 'canvas', 'prototype', 'comment' 
    ],
    system: [
        'open app', 'open application', 'launch', 'open ', 'start ', 'run command', 'terminal', 'cpu usage',
        'memory usage', 'system status', 'disk space', 'battery', 'connect', 'how do i connect'
    ],
    calendar: [
        'schedule', 'meeting', 'meetings', 'appointment', 'calendar', 'event', 'events',
        'free time', 'availability', 'busy', 'remind', 'reminder', 'book', 'block time',
        'tomorrow', 'yesterday', 'next week', 'this week', 'today', 'tonight',
        'what do i have', 'do i have', 'anything scheduled', 'anything on my',
        'what\'s on my', 'what is on my', 'check my calendar', 'show my calendar',
        'my schedule', 'my agenda', 'upcoming', 'plans for', 'what\'s happening',
        'this evening', 'this morning', 'this afternoon',
        'any tasks', 'any events', 'any meetings',
        'schedule a task', 'schedule task', 'add to calendar', 'put on calendar',
        'create an event', 'create event', 'book a meeting', 'set a reminder',
        'add a meeting', 'block out time', 'schedule for'
    ],
    files: [
        'document', 'pdf', 'docx', 'word doc', 'file',
        'read file', 'read that', 'summarize', 'summary',
        'that document', 'the file', 'the document',
        'brief me', 'overview', 'contents of', 'what does it say',
        'attached', 'attachment', 'uploaded',
        'file tools', 'attached the following'
    ],
    slack: [
        'slack', 'tell the team', 'notify team', 'post to', 'announce', 'message channel',
        'send message', 'tell dev', 'tell #', 'post announcement', 'team notification'
    ],
    gmail: [
        'email', 'gmail', 'send email', 'send mail', 'mail to', 'email to',
        'inbox', 'check mail', 'check email', 'recent emails', 'unread emails',
        'send it to', 'email them', 'email him', 'email her', 'email that',
        'mail it', 'compose email', 'write email', 'draft email',
        'send an email', 'email address', 'mail him', 'mail her', 'mail them',
        'send that email', 'forward email', 'reply email', 'my emails',
        'send it via email', 'shoot an email', 'drop an email', 'fire off an email'
    ],
    image: [
        'generate image', 'create image', 'draw', 'make a picture', 'generate a picture',
        'create a logo', 'make an image', 'illustration', 'visualize', 'visualise',
        'generate art', 'create art', 'make art', 'dall-e', 'dalle', 'artwork',
        'render an image', 'design a logo', 'generate a logo', 'picture of',
        'create photo', 'make picture', 'generate photo', 'make a photo',
        'generate a photo', 'create a picture', 'create a drawing', 'sketch',
        'render a', 'paint', 'create graphic', 'make graphic',
        'draw me', 'draw a', 'image of', 'photo of', 'logo of', 'graphic of',
        'make me an image', 'make me a picture', 'make me a logo', 'make me a graphic',
        'generate me', 'create me an image', 'create me a picture',
        'design an image', 'design a picture', 'design a graphic',
        'can you draw', 'can you generate', 'can you create an image',
        'show me an image', 'show me a picture', 'depict', 'depiction'
    ]
};

// Fallback keywords that map to both read and write
const FALLBACK_KEYWORD_MAP = {
    jira: ['jira', 'ticket', 'sprint', 'epic', 'kanban', 'issue', 'bug', 'board', 'space', 'backlog', 'status'],
    github: ['github', 'repo', 'pr', 'pull request', 'commit', 'branch', 'push', 'merge', 'clone', 'checks'],
};

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

async function classifyIntent(userMessage, chatHistory = [], classifier) {
    const lowerMsg = userMessage.toLowerCase();
    const detectedCategories = new Set();

    // 0. CONFIRMATION CHECK: Is this a short affirmation confirming a prior AI proposal?
    if (isConfirmationMessage(userMessage, chatHistory)) {
        console.log("[Traffic Cop] ✅ Confirmation detected. Scanning full context (human + AI)...");

        // For confirmations, look further back (8 messages) to account for tool call/response messages
        // that push the original human request out of a shorter window
        const recentMessages = chatHistory.slice(-8);
        const recentContext = recentMessages.map(m => {
            const content = typeof m.content === 'string' ? m.content : '';
            return content;
        }).join(' ').toLowerCase();

        const contextCategories = new Set();

        // Check for tool names in AI messages to detect service context
        const TOOL_SERVICE_MAP_CONFIRM = {
            jira: 'jira', search_jira: 'jira', create_jira: 'jira', update_jira: 'jira', delete_jira: 'jira',
            list_jira: 'jira', add_issues_to_sprint: 'jira',
            github: 'github', create_repo: 'github', get_repo: 'github', list_commits: 'github',
            list_branches: 'github', get_commit: 'github', get_pull: 'github', list_pull: 'github',
            send_gmail: 'gmail', search_gmail: 'gmail', get_recent_emails: 'gmail',
            calendar: 'calendar', create_calendar: 'calendar', get_calendar: 'calendar',
            send_slack: 'slack', get_figma: 'figma',
        };

        for (const msg of recentMessages) {
            if (msg.additional_kwargs?.tool_calls) {
                for (const tc of msg.additional_kwargs.tool_calls) {
                    const toolName = tc.function?.name || '';
                    for (const [prefix, service] of Object.entries(TOOL_SERVICE_MAP_CONFIRM)) {
                        if (toolName.includes(prefix)) {
                            contextCategories.add(`${service}_read`);
                            contextCategories.add(`${service}_write`);
                            // For non-read/write categories (gmail, calendar, slack, figma), add directly
                            if (!['jira', 'github'].includes(service)) {
                                contextCategories.add(service);
                            }
                        }
                    }
                }
            }
        }

        for (const [service, keywords] of Object.entries(FALLBACK_KEYWORD_MAP)) {
            if (keywords.some(k => recentContext.includes(k))) {
                contextCategories.add(`${service}_read`);
                contextCategories.add(`${service}_write`);
            }
        }
        for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
            if (keywords.some(k => recentContext.includes(k))) {
                contextCategories.add(category);
            }
        }

        if (contextCategories.size > 0 && contextCategories.size <= 6) {
            console.log(`[Traffic Cop] ✅ Confirmation routed: ${Array.from(contextCategories)}`);
            return { categories: Array.from(contextCategories), isConfirmation: true };
        }

        return { categories: ['general'], isConfirmation: true };
    }

    // 0.5 GREETING CHECK: If the user just says hello, don't drag in 16 tools
    const isGreeting = /^(hi|hello|hey|yo|greetings|good morning|good afternoon|good evening|sup)\s*([.!?]*)$/i.test(lowerMsg);
    if (isGreeting) {
        console.log("[Traffic Cop] 👋 Greeting detected. Routing to General directly.");
        return { categories: ['general'], isConfirmation: false };
    }

    // 1. FAST PASS: Check specific keywords first (< 1ms)
    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(k => lowerMsg.includes(k))) {
            detectedCategories.add(category);
        }
    }

    // 2. ALWAYS check fallback keywords (even if fast-pass found something)
    // This ensures "open jira tickets" detects jira, not just system
    for (const [service, keywords] of Object.entries(FALLBACK_KEYWORD_MAP)) {
        if (keywords.some(k => lowerMsg.includes(k))) {
            detectedCategories.add(`${service}_read`);
            detectedCategories.add(`${service}_write`);
        }
    }

    // TIME-CONTEXT DISAMBIGUATION: If both Jira and Calendar detected, prefer Calendar when time context present
    if (detectedCategories.size > 0) {
        const hasJira = [...detectedCategories].some(c => c.startsWith('jira'));
        const hasCalendar = detectedCategories.has('calendar');
        const hasTimeContext = /\b(\d{1,2}[:\s]?\d{0,2}\s*(am|pm)|at\s+\d|tomorrow|tonight|this\s+(morning|afternoon|evening)|next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(lowerMsg);

        if (hasJira && hasTimeContext) {
            if (hasCalendar) {
                // Both detected + time context → remove Jira, keep Calendar
                for (const cat of [...detectedCategories]) {
                    if (cat.startsWith('jira')) detectedCategories.delete(cat);
                }
                console.log(`[Traffic Cop] 📅 Time-context disambiguation: preferring Calendar over Jira`);
            } else {
                // Only Jira detected but time context → add Calendar so LLM can decide
                detectedCategories.add('calendar');
                console.log(`[Traffic Cop] 📅 Time-context detected with Jira: adding Calendar tools`);
            }
        }
    }

    if (detectedCategories.size > 0) {
        console.log(`[Traffic Cop] ⚡ Fast-Pass Intent: ${Array.from(detectedCategories)}`);
        return { categories: Array.from(detectedCategories), isConfirmation: false };
    }

    // 3. CONTEXT PASS: For short messages OR messages with reference words, check conversation context
    const wordCount = userMessage.split(' ').length;
    const hasReferenceWord = /\b(that|it|this|the file|the document|the pdf|same|above|previous)\b/i.test(userMessage);
    
    if ((wordCount < 10 || hasReferenceWord) && chatHistory.length > 0) {
        console.log("[Traffic Cop] Follow-up detected (short or reference word). Checking conversation context...");
        
        // Look at the last few messages to determine context
        const recentMessages = chatHistory.slice(-4); // Last 2 exchanges (human + AI each)
        
        // Match human prompts for service keywords
        const recentUserMessages = recentMessages.filter(m => {
            const type = typeof m._getType === 'function' ? m._getType() : m.type;
            return type === 'human';
        });
        const recentContext = recentUserMessages.map(m => m.content || '').join(' ').toLowerCase();

        // Also extract tool names from AI messages to detect service context
        // (e.g., if AI called search_jira_issues, the follow-up "try again" should route to jira)
        const recentAIMessages = recentMessages.filter(m => {
            const type = typeof m._getType === 'function' ? m._getType() : m.type;
            return type === 'ai';
        });
        const aiContext = recentAIMessages.map(m => {
            // Check for tool_calls in additional_kwargs or direct content
            const toolNames = [];
            if (m.additional_kwargs?.tool_calls) {
                for (const tc of m.additional_kwargs.tool_calls) {
                    if (tc.function?.name) toolNames.push(tc.function.name);
                }
            }
            // Also check content for tool name patterns
            const content = (typeof m.content === 'string' ? m.content : '').toLowerCase();
            return [...toolNames, content].join(' ');
        }).join(' ').toLowerCase();

        // Check if recent context mentions any service keywords
        const contextCategories = new Set();

        // Map tool name prefixes to services
        const TOOL_SERVICE_MAP = {
            jira: 'jira', search_jira: 'jira', create_jira: 'jira', update_jira: 'jira', delete_jira: 'jira',
            list_jira: 'jira', add_issues_to_sprint: 'jira',
            github: 'github', create_repo: 'github', get_repo: 'github', list_commits: 'github',
            list_branches: 'github', get_commit: 'github', get_pull: 'github', list_pull: 'github',
        };

        for (const [toolPrefix, service] of Object.entries(TOOL_SERVICE_MAP)) {
            if (aiContext.includes(toolPrefix)) {
                contextCategories.add(`${service}_read`);
                contextCategories.add(`${service}_write`);
            }
        }

        for (const [service, keywords] of Object.entries(FALLBACK_KEYWORD_MAP)) {
            if (keywords.some(k => recentContext.includes(k))) {
                contextCategories.add(`${service}_read`);
                contextCategories.add(`${service}_write`);
            }
        }

        // Also check specific keywords in context
        for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
            if (keywords.some(k => recentContext.includes(k))) {
                contextCategories.add(category);
            }
        }
        
        // Only return if it resolved to a reasonably small set of categories (prevent 30 tool nightmare)
        if (contextCategories.size > 0 && contextCategories.size <= 4) {
            console.log(`[Traffic Cop] 🔗 Context-Pass Intent (follow-up): ${Array.from(contextCategories)}`);
            return { categories: Array.from(contextCategories), isConfirmation: false };
        }
    }

    if (wordCount < 5) {
        console.log("[Traffic Cop] Short query with no context. Defaulting to General.");
        return { categories: ['general'], isConfirmation: false };
    }

    // 4. SLOW PASS: Fallback to LLM for ambiguous queries
    try {
        let contextBlock = "";
        if (chatHistory.length > 0) {
            contextBlock = "[Recent Chat History]\n" + chatHistory.slice(-4).map(m => {
                const role = (typeof m._getType === 'function' ? m._getType() : m.type) === 'human' ? 'User' : 'E.D.I.T.H.';
                return `${role}: ${m.content}`;
            }).join('\n') + "\n\nUser message: ";
        }
        
        // Safety check for CLASSIFIER_PROMPT
        const promptBase = (typeof CLASSIFIER_PROMPT === 'string') ? CLASSIFIER_PROMPT : "Classify user intent: ";
        const prompt = promptBase.replace('User message: ', contextBlock ? contextBlock : 'User message: ');
        
        if (!classifier) {
            console.warn("[Traffic Cop] Classifier LLM missing, defaulting to General.");
            return { categories: ['general'], isConfirmation: false };
        }

        const response = await classifier.invoke(prompt + userMessage);
        const categories = response.content.toLowerCase().trim().split(',').map(c => c.trim());
        const VALID_CATEGORIES = new Set([
            'jira_read', 'jira_write', 'github_read', 'github_write',
            'figma', 'calendar', 'slack', 'gmail', 'image', 'files', 'general'
        ]);
        const validCategories = categories.filter(c => VALID_CATEGORIES.has(c));

        if (validCategories.length === 0) return { categories: ['general'], isConfirmation: false };

        console.log(`[Traffic Cop] Intent classified: ${validCategories.join(', ')}`);
        return { categories: validCategories, isConfirmation: false };
    } catch (error) {
        console.error("[Traffic Cop] Classification error:", error.message);
        return { categories: ['general'], isConfirmation: false };
    }
}

function getToolsForCategories(categories, toolsByCategory) {
    const tools = new Set();

    for (const category of categories) {
        const categoryTools = toolsByCategory[category] || [];
        categoryTools.forEach(tool => tools.add(tool));
    }

    // If no tools selected (general conversation), return empty array
    return Array.from(tools);
}

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
// DYNAMIC AGENT CREATION (Traffic Cop Pattern)
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
    // input usually contains { input, chat_history, userId, timezone } 
    // when coming from agentExecutor.invoke
    const { input: userQuery, chat_history, userId, timezone } = input;
    
    // We MUST initialize the LLM for this specific user
    const { llm, classifier } = await getLLMForUser(userId);
    
    const history = sanitizeHistoryForTools(trimHistory(Array.isArray(chat_history) ? chat_history : []));
    
    // Step 1: Classify intent using the Traffic Cop (now with context)
    const { categories, isConfirmation } = await classifyIntent(userQuery, history, classifier);

    // Step 2: Get the appropriate tools for the classified categories (per-user)
    const userToolsByCategory = createToolsForUser(userId);
    const selectedTools = getToolsForCategories(categories, userToolsByCategory);

    console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}${isConfirmation ? ' (confirmation)' : ''}`);

    // Step 3: Handle "general" conversation directly with LLM (no agent needed)
    if (selectedTools.length === 0) {
        console.log("[Traffic Cop] General conversation - using direct LLM call");

        const systemPrompt = getSystemPrompt(timezone, input.userPrefs);
        let guardMessage;
        if (isConfirmation) {
            guardMessage = new SystemMessage(
                "[CONTINUATION] The user is confirming something you previously said. " +
                "Review your recent conversation and respond appropriately. " +
                "If the user is confirming an action plan but you don't have the right tools available, " +
                "let them know and ask them to rephrase the specific action request."
            );
        } else {
            guardMessage = new SystemMessage(
                "[SYSTEM NOTICE] IMPORTANT: You have NO tools available in this response. " +
                "You CANNOT perform any actions such as sending emails, creating tickets, " +
                "posting messages, reading files, scheduling events, or querying APIs. " +
                "Do NOT pretend to execute actions or fabricate results. " +
                "If the user asks you to perform an action, tell them clearly and honestly " +
                "that you were unable to route their request to the appropriate tool, " +
                "and ask them to rephrase or be more specific."
            );
        }
        const now = new Date();
        const effectiveTimezone = timezone || 'UTC';
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: effectiveTimezone };
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: effectiveTimezone };
        const freshTimeReminder = new SystemMessage(
            `[TIME UPDATE] Current time is now: ${now.toLocaleTimeString('en-US', timeOptions)} on ${now.toLocaleDateString('en-US', dateOptions)}. Any times mentioned in previous messages are outdated — use ONLY this time.`
        );
        // Merge all system-level content into a single SystemMessage so that
        // Gemini doesn't crash with "System message should be the first one".
        const combinedSystemContent = systemPrompt.content
            + '\n\n' + guardMessage.content
            + '\n\n' + freshTimeReminder.content;
        const messages = [
            new SystemMessage(combinedSystemContent),
            ...history,
            new HumanMessage(userQuery)
        ];

        const response = await llm.invoke(messages);
        return { messages: [...history, new HumanMessage(userQuery), response] };
    }

    // Step 4: Get or create an agent with these specific tools
    const agent = getOrCreateAgent(selectedTools, timezone, userId, llm, input.userPrefs);

    // Step 5: Execute the agent (inject fresh time reminder before user query)
    const now = new Date();
    const effectiveTimezone = timezone || 'UTC';
    const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: effectiveTimezone };
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: effectiveTimezone };
    const freshTimeReminder = new HumanMessage(
        `[TIME UPDATE] Current time is now: ${now.toLocaleTimeString('en-US', timeOptions)} on ${now.toLocaleDateString('en-US', dateOptions)}. Any times mentioned in previous messages are outdated — use ONLY this time.`
    );
    // Conditional guard: CONTINUATION for confirmations, FRESHNESS GUARD for new requests
    let toolNudge;
    if (isConfirmation) {
        toolNudge = new HumanMessage(
            `[CONTINUATION] The user is confirming/approving a plan you previously proposed. ` +
            `Review your most recent message in the conversation history and EXECUTE the action(s) you described. ` +
            `Do NOT ask for further confirmation. Do NOT re-propose the plan. Proceed to call the tools now. ` +
            `You have ${selectedTools.length} tools available. Use them to carry out the plan. ` +
            `You MUST cite the Receipt (ID/Link) in your confirmation.`
        );
    } else {
        toolNudge = new HumanMessage(
            `[FRESHNESS GUARD] You have ${selectedTools.length} tools available. ` +
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

        const { llm, classifier, provider: activeProvider } = await getLLMForUser(userId, excludeProviders);

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

        // Step 1: Classify intent using the Traffic Cop (with conversation context)
        const { categories, isConfirmation } = await classifyIntent(userQuery, history, classifier);

        // Auto-include file tools when files are attached
        if (userQuery.includes('Read them using your file tools')) {
            if (!categories.includes('files')) {
                categories.push('files');
                console.log('[Traffic Cop] Files detected in request — added files category');
            }
        }

        // Step 2: Get the appropriate tools for the classified categories (per-user)
        const userToolsByCategory = createToolsForUser(userId);
        const selectedTools = getToolsForCategories(categories, userToolsByCategory);

        console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}${isConfirmation ? ' (confirmation)' : ''}`);

        // Step 3: Handle "general" conversation directly with LLM (no agent needed)
        if (selectedTools.length === 0) {
            console.log("[Traffic Cop] General conversation - using direct LLM call");

            // getSystemPrompt() already returns a SystemMessage — don't double-wrap
            const systemPrompt = getSystemPrompt(timezone, userPrefs);
            let guardMessage;
            if (isConfirmation) {
                guardMessage = new SystemMessage(
                    "[CONTINUATION] The user is confirming something you previously said. " +
                    "Review your recent conversation and respond appropriately. " +
                    "If the user is confirming an action plan but you don't have the right tools available, " +
                    "let them know and ask them to rephrase the specific action request."
                );
            } else {
                guardMessage = new SystemMessage(
                    "[SYSTEM NOTICE] IMPORTANT: You have NO tools available in this response. " +
                    "You CANNOT perform any actions such as sending emails, creating tickets, " +
                    "posting messages, reading files, scheduling events, or querying APIs. " +
                    "Do NOT pretend to execute actions or fabricate results. " +
                    "If the user asks you to perform an action, tell them clearly and honestly " +
                    "that you were unable to route their request to the appropriate tool, " +
                    "and ask them to rephrase or be more specific."
                );
            }
            // Inject a fresh time reminder right before the user query so the LLM
            // doesn't rely on stale timestamps from earlier in the conversation history.
            const now = new Date();
            const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone };
            const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: timezone };
            const freshTimeReminder = new SystemMessage(
                `[TIME UPDATE] Current time is now: ${now.toLocaleTimeString('en-US', timeOptions)} on ${now.toLocaleDateString('en-US', dateOptions)}. Any times mentioned in previous messages are outdated — use ONLY this time.`
            );
            // Merge all system-level content into a single SystemMessage so that
            // Gemini doesn't crash with "System message should be the first one".
            let combinedSystemContent = systemPrompt.content
                + '\n\n' + guardMessage.content
                + '\n\n' + freshTimeReminder.content;

            if (projectContext) {
                let projectBlock = '\n\n[PROJECT CONTEXT]\nThe user is working within a project workspace.';
                if (projectContext.jiraProjectKey) {
                    projectBlock += `\n- Jira Project Key: ${projectContext.jiraProjectKey} (use as default for all Jira queries)`;
                }
                if (projectContext.githubRepo) {
                    projectBlock += `\n- GitHub Repository: ${projectContext.githubRepo} (use as default owner/repo for all GitHub queries)`;
                }
                projectBlock += '\nWhen the user asks about issues, PRs, tickets without specifying a project or repo, default to these values.';
                combinedSystemContent += projectBlock;
            }

            const messages = [
                new SystemMessage(combinedSystemContent),
                ...history,
                new HumanMessage(userQuery)
            ];

            const stream = await llm.stream(messages);

            let completeResponse = "";
            for await (const chunk of stream) {
                const content = chunk.content;
                if (content) {
                    completeResponse += content;
                    yield {
                        event: "on_chat_model_stream",
                        data: { chunk: { content } }
                    };
                }
            }

            // Save to history after streaming completes
            await messageHistory.addMessage(new HumanMessage(userQuery));
            if (completeResponse) {
                await messageHistory.addMessage(new AIMessage(completeResponse));
            }
            process.env.ACTIVE_REQUEST = 'false';
            return;
        }

        // Step 4: Get or create an agent with these specific tools
        const agent = getOrCreateAgent(selectedTools, timezone, userId, llm, userPrefs, projectContext);

        // Step 5: Stream events from the agent (inject fresh time reminder before user query)
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
                `You have ${selectedTools.length} tools available. Use them to carry out the plan. ` +
                `You MUST cite the Receipt (ID/Link) in your confirmation.`
            );
        } else {
            toolNudge = new HumanMessage(
                `[FRESHNESS GUARD] You have ${selectedTools.length} tools available. ` +
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
        const MAX_TOOL_ERRORS = 4;

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
                        console.warn(`[Traffic Cop] Halting: tool "${toolName}" called ${MAX_REPEATED_CALLS}+ times with identical args. Likely hallucination loop.`);
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
                if (outputStr.includes('"status":"error"') || outputStr.includes('Error') || outputStr.includes('Failed')) {
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
