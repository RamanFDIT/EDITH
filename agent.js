import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import fs from 'fs';
import path from 'path';
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { RunnableWithMessageHistory, RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import "./envConfig.js";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

// --- MCP replaces: githubTool, figmaTool, fileTool, slackTool ---
// Custom tools without MCP equivalents are imported directly:
import { EDITH_SYSTEM_PROMPT, getSystemPrompt } from "./systemPrompt.js";
import { getSystemStatus, executeSystemCommand, openApplication } from "./systemTool.js";
import { transcribeAudio, generateSpeech } from "./audioTool.js";
import { generateImage } from "./imageTool.js";
// No MCP server configured for Jira, Calendar & Slack — keep as custom tools:
import { getJiraIssues, createJiraIssue, updateJiraIssue, deleteJiraIssue, createJiraProject } from "./jiraTool.js";
import { getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, findFreeTime } from "./calendarTool.js";
import { sendSlackMessage, sendSlackAnnouncement, sendSlackLink } from "./slackTool.js";


const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) throw new Error("GOOGLE_API_KEY not found.");

// --- MAIN LLM (for agent execution) ---
const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  model: "gemini-3-flash-preview", 
});

// --- CLASSIFIER LLM (small, fast model for intent classification) ---
const classifierLlm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  model: "gemini-2.0-flash-lite",  // Fast, lightweight model for classification
  temperature: 0, // Deterministic
});

console.log(" E.D.I.T.H. Online (Gemini 3 Flash) - Semantic Classification Enabled.");

// =============================================================================
// MCP CLIENT INITIALIZATION
// =============================================================================

// Load MCP server config (maps server names -> stdio commands)
const mcpConfigPath = path.join(process.cwd(), 'mcp-config.json');
const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));

// Connect to each MCP server individually so one failure doesn't kill the app
const mcpClients = {};   // name -> MultiServerMCPClient (one per server)
let mcpTools = [];

for (const [name, srv] of Object.entries(mcpConfig.servers)) {
  // Merge process.env with any env vars defined in mcp-config.json
  // This allows the UI settings (which populate process.env) to override hardcoded values
  const mergedEnv = { ...(srv.env || {}), ...process.env };

  // Specifically map UI config keys to MCP expected keys if they differ
  if (name === 'github' && process.env.GITHUB_PAT) {
    mergedEnv.GITHUB_PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PAT;
  }
  if (name === 'slack' && process.env.SLACK_BOT_TOKEN) {
    mergedEnv.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    mergedEnv.SLACK_TEAM_ID = process.env.SLACK_TEAM_ID;
  }
  if (name === 'figma' && process.env.FIGMA_TOKEN) {
    mergedEnv.FIGMA_API_KEY = process.env.FIGMA_TOKEN;
  }

  const singleConfig = {
    [name]: {
      transport: "stdio",
      command: srv.command,
      args: srv.args || [],
      env: mergedEnv,
    },
  };

  try {
    const client = new MultiServerMCPClient(singleConfig);
    const tools = await client.getTools();
    // Tag each tool with the server it came from (for categorization)
    for (const tool of tools) {
      tool._mcpServerName = name;
    }
    mcpClients[name] = client;
    mcpTools.push(...tools);
    console.log(`[MCP] ✅ "${name}" connected — ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);
  } catch (err) {
    console.warn(`[MCP] ⚠️  "${name}" FAILED to connect: ${err.message}`);
    console.warn(`[MCP]    Skipping "${name}" — its tools will not be available this session.`);
  }
}

console.log(`[MCP] Loaded ${mcpTools.length} total tools from ${Object.keys(mcpClients).length}/${Object.keys(mcpConfig.servers).length} MCP servers.`);

// Unified close helper (used by server.js shutdown)
export const mcpClient = {
  async close() {
    await Promise.allSettled(
      Object.values(mcpClients).map(c => c.close())
    );
  }
};

// =============================================================================
// CUSTOM TOOL DEFINITIONS (no MCP equivalent)
// =============================================================================

const systemTools = [
  new DynamicStructuredTool({
    name: "system_status_report",
    description: "Get current hardware and OS status.",
    schema: z.object({}),
    func: getSystemStatus,
  }),
  new DynamicStructuredTool({
    name: "execute_terminal_command",
    description: "EXECUTE SHELL COMMANDS. Use for file manipulation, running scripts, or system ops.",
    schema: z.object({
      command: z.string().describe("The shell command to run (e.g., 'ls -la', 'mkdir test')."),
    }),
    func: executeSystemCommand,
  }),
  new DynamicStructuredTool({
    name: "launch_application",
    description: "Launch any application on the user's computer. ARGUMENT is the app name.",
    schema: z.object({
      appName: z.string().describe("The name of the application (e.g., 'Google Chrome', 'Spotify')."),
      target: z.string().optional().describe("Optional URL or file to open with the application (e.g., 'https://figma.com', 'mydoc.txt')."),
    }),
    func: openApplication,
  }),
];

const audioTools = [
  new DynamicStructuredTool({
    name: "transcribe_audio_whisper",
    description: "Transcribe an audio file to text using OpenAI Whisper. Requires a valid file path.",
    schema: z.object({
        filePath: z.string().describe("Absolute path to the audio file (mp3, wav, m4a)."),
    }),
    func: transcribeAudio,
  }),
  new DynamicStructuredTool({
    name: "generate_speech_elevenlabs",
    description: "Generate spoken audio from text using ElevenLabs. Returns the path to the saved mp3 file.",
    schema: z.object({
        text: z.string().describe("The text to speak."),
        voiceId: z.string().optional().describe("Optional ElevenLabs Voice ID."),
    }),
    func: generateSpeech,
  }),
];

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

// --- JIRA TOOLS (custom — no MCP server configured) ---
const jiraReadTools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Search Jira issues using JQL. For FASTER searches, include the project key in the JQL (e.g., 'project = FDIT'). If user doesn't specify a project/space, ASK them which project to search in - do NOT search all projects blindly. Example JQL: 'project = FDIT AND status = Open'.",
    schema: z.object({
      jql: z.string().describe("REQUIRED: The JQL query string. Should include 'project = KEY' for faster results. ASK user for project key if not provided."),
    }),
    func: getJiraIssues,
  }),
];

const jiraWriteTools = [
  new DynamicStructuredTool({
    name: "create_jira_issue",
    description: "Create a Jira ticket. REQUIRES 'projectKey'. If user doesn't specify which project/space, ASK them - do NOT guess or retry.",
    schema: z.object({
      projectKey: z.string().describe("REQUIRED: Project Key (e.g., 'FDIT'). ASK the user if not provided."),
      summary: z.string().describe("REQUIRED: Ticket title"),
      description: z.string().optional(),
      issueType: z.string().optional(),
    }),
    func: createJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "update_jira_issue",
    description: "Update a Jira ticket's fields. REQUIRES 'issueKey' (e.g., 'FDIT-12'). If user doesn't specify the ticket key, ASK them - do NOT guess or retry. Supports: Status, Priority, Summary, Description, Assignee, Due Date, Labels, and Parent. Do NOT change the summary unless explicitly asked.",
    schema: z.object({
      issueKey: z.string().describe("REQUIRED: The ticket key (e.g., 'FDIT-12'). ASK the user if not provided."),
      summary: z.string().optional().describe("New title for the ticket."),
      description: z.string().optional().describe("New description text."),
      status: z.string().optional().describe("Target status to move to (e.g., 'In Progress', 'Done')."),
      priority: z.string().optional().describe("Target priority. MUST be one of: 'Highest', 'High', 'Medium', 'Low', 'Lowest'."),
      assignee: z.string().optional().describe("Account ID of the user to assign to."),
      duedate: z.string().optional().describe("Due date in 'YYYY-MM-DD' format."),
      labels: z.array(z.string()).optional().describe("Array of label strings."),
      parent: z.string().optional().describe("Key of the parent issue (e.g. for subtasks)."),
    }),
    func: updateJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "delete_jira_issue",
    description: "Delete a Jira ticket by its key. REQUIRES 'issueKey' (e.g., 'FDIT-123'). If user doesn't specify the ticket key, ASK them - do NOT guess or retry.",
    schema: z.object({
        issueKey: z.string().describe("REQUIRED: The ticket key to delete (e.g., 'FDIT-123'). ASK the user if not provided."),
    }),
    func: deleteJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "create_jira_project",
    description: "Create a new Jira Project (sometimes referred to as a Space). REQUIRES ADMIN RIGHTS. REQUIRES 'key' and 'name'. If user doesn't specify project key or name, ASK them - do NOT guess or retry.",
    schema: z.object({
        key: z.string().describe("REQUIRED: The Project Key (e.g., 'NEWPROJ'). Must be unique and uppercase. ASK user if not provided."),
        name: z.string().describe("REQUIRED: The name of the project. ASK user if not provided."),
        description: z.string().optional().describe("Project description."),
        templateKey: z.string().optional().describe("Template key (default: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic')."),
        projectTypeKey: z.string().optional().describe("Type key (default: 'software')."),
    }),
    func: createJiraProject,
  }),
];

// --- SLACK TOOLS (custom — fallback when MCP Slack server is unavailable) ---
const slackCustomTools = [
  new DynamicStructuredTool({
    name: "send_slack_message",
    description: "Send a message to a Slack channel. Use for team notifications, updates, or announcements.",
    schema: z.object({
      channel: z.string().optional().describe("Channel name (with or without #) or channel ID. Defaults to SLACK_DEFAULT_CHANNEL."),
      message: z.string().describe("The message text to send."),
    }),
    func: sendSlackMessage,
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
    func: sendSlackAnnouncement,
  }),
  new DynamicStructuredTool({
    name: "send_slack_link",
    description: "Share a URL with contextual message in a Slack channel. Perfect for sharing Jira tickets, GitHub PRs, or docs.",
    schema: z.object({
      channel: z.string().optional().describe("Channel name or ID. Defaults to SLACK_DEFAULT_CHANNEL."),
      url: z.string().describe("The URL to share."),
      context: z.string().optional().describe("Contextual message to accompany the link."),
    }),
    func: sendSlackLink,
  }),
];

// --- CALENDAR TOOLS (custom — no MCP server configured) ---
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
    func: getCalendarEvents,
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
    func: createCalendarEvent,
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
    func: updateCalendarEvent,
  }),
  new DynamicStructuredTool({
    name: "delete_calendar_event",
    description: "Delete an event from Google Calendar.",
    schema: z.object({
      eventId: z.string().describe("The ID of the event to delete"),
    }),
    func: deleteCalendarEvent,
  }),
  new DynamicStructuredTool({
    name: "find_free_time",
    description: "Check for free/busy time in a given time range. Use this to find available slots for scheduling.",
    schema: z.object({
      timeMin: z.string().describe("Start of time range to check in ISO format"),
      timeMax: z.string().describe("End of time range to check in ISO format"),
    }),
    func: findFreeTime,
  }),
];

// =============================================================================
// AUTO-CATEGORIZE MCP TOOLS BY SERVER NAME
// =============================================================================

// Each MCP tool has a .metadata.serverName that matches the key in mcp-config.json
// We map server names to our Traffic Cop categories:
const SERVER_TO_CATEGORIES = {
  github:     ['github_read', 'github_write'],
  slack:      ['slack'],
  filesystem: ['files'],
  figma:      ['figma'],
  jira:       ['jira_read', 'jira_write'],
  calendar:   ['calendar'],
};

// Build category -> tool[] map from MCP tools
const mcpToolsByCategory = {};
for (const tool of mcpTools) {
  // Use the tag we set during connection
  const serverName = tool._mcpServerName || tool.metadata?.serverName || '';
  const categories = SERVER_TO_CATEGORIES[serverName] || [];
  
  if (categories.length === 0) {
    console.warn(`[MCP] Tool "${tool.name}" from server "${serverName}" has no category mapping — adding to all categories for that server.`);
  }
  
  for (const cat of categories) {
    if (!mcpToolsByCategory[cat]) mcpToolsByCategory[cat] = [];
    mcpToolsByCategory[cat].push(tool);
  }
}

// Log what we discovered
for (const [cat, tools] of Object.entries(mcpToolsByCategory)) {
  console.log(`[MCP] Category "${cat}": ${tools.map(t => t.name).join(', ')}`);
}

// Map categories to their tool arrays (MCP + custom)
const toolsByCategory = {
  jira_read:    [...(mcpToolsByCategory.jira_read || []), ...jiraReadTools],
  jira_write:   [...(mcpToolsByCategory.jira_write || []), ...jiraWriteTools],
  github_read:  mcpToolsByCategory.github_read  || [],
  github_write: mcpToolsByCategory.github_write || [],
  system:       systemTools,
  figma:        mcpToolsByCategory.figma        || [],
  audio:        audioTools,
  calendar:     [...(mcpToolsByCategory.calendar || []), ...calendarTools],
  files:        mcpToolsByCategory.files        || [],
  slack:        [...(mcpToolsByCategory.slack || []), ...slackCustomTools],
  image:        imageTools,
  general:      [], // No tools needed for general conversation
};

// All tools combined (for fallback or multi-category queries)
const allTools = [...mcpTools, ...systemTools, ...audioTools, ...imageTools, ...jiraReadTools, ...jiraWriteTools, ...calendarTools, ...slackCustomTools];

// =============================================================================
// SEMANTIC CLASSIFIER (The Traffic Cop)
// =============================================================================

const CLASSIFIER_PROMPT = `You are a fast intent classifier for an AI assistant named E.D.I.T.H.
Your ONLY job is to classify the user's message into ONE OR MORE categories.

CATEGORIES:
- jira_read: Reading/searching Jira tickets, issues, epics, sprints, backlogs (queries, lookups, listing)
- jira_write: Creating, updating, or deleting Jira tickets, issues, projects
- github_read: Reading GitHub data: commits, PRs, issues, checks, repo info (queries, lookups, listing)
- github_write: Creating repos, issues, or any write operation on GitHub
- figma: Anything about designs, mockups, UI/UX, wireframes, Figma files, design comments
- system: Anything about opening apps, running commands, terminal, system status, launching programs
- audio: Anything about transcription, text-to-speech, voice, audio files, speaking
- calendar: Anything about scheduling, meetings, appointments, events, calendar, free time, availability, reminders
- files: Reading documents, files, PDFs, Word docs, downloads, listing files, latest download, file contents, summarizing documents
- slack: Sending messages to Slack, posting announcements, notifying team, messaging channels, team notifications
- image: Generating images, pictures, illustrations, graphics, logos, artwork, drawings, visualisations
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
User: "Open Chrome and go to Figma" -> system,figma
User: "Hello, how are you?" -> general
User: "Create a ticket for the login bug" -> jira_write
User: "Update ticket FDIT-123 to done" -> jira_write
User: "List all my Jira tickets and mark the first one done" -> jira_read,jira_write
User: "Read the comments on the dashboard design" -> figma
User: "What's my CPU usage?" -> system
User: "Create a new repo called test-app" -> github_write
User: "What meetings do I have today?" -> calendar
User: "Schedule a call with John next Tuesday at 2pm" -> calendar
User: "Am I free tomorrow afternoon?" -> calendar
User: "Cancel my 3pm meeting" -> calendar
User: "What's my latest download?" -> files
User: "Read that document for me" -> files
User: "Summarize the PDF I just downloaded" -> files
User: "List my recent downloads" -> files
User: "Tell the dev-team I fixed the bug" -> slack
User: "Post to #general that deployment is complete" -> slack
User: "Notify the team about the new release" -> slack
User: "Generate an image of a sunset over mountains" -> image
User: "Draw me a logo for my app" -> image
User: "Create a picture of a robot" -> image

User message: `;

// Define keywords for the "Fast Pass"
const KEYWORD_MAP = {
    jira_read: [
        'list tickets', 'show tickets', 'get tickets', 'search jira', 'find ticket',
        'how many epics', 'what tickets', 'show epics', 'backlog', 'sprint status'
    ],
    jira_write: [
        'create ticket', 'make ticket', 'new ticket', 'update ticket', 'delete ticket',
        'mark as done', 'change status', 'assign to', 'set priority', 'create issue',
        'create epic', 'create project'
    ],
    github_read: [
        'list commits', 'show commits', 'check pr', 'list pr', 'show pull requests',
        'get checks', 'repo status', 'list issues'
    ],
    github_write: [
        'create repo', 'new repository', 'create issue', 'make issue'
    ],
    figma: [
        'figma', 'design', 'mockup', 'wireframe', 'ux', 'ui', 'color', 'frame', 
        'layer', 'canvas', 'prototype', 'comment' 
    ],
    system: [
        'open app', 'open application', 'launch', 'run command', 'terminal', 'cpu usage',
        'memory usage', 'system status', 'disk space', 'battery'
    ],
    audio: [
        'transcribe', 'speech', 'voice', 'audio', 'speak'
    ],
    calendar: [
        'schedule', 'meeting', 'appointment', 'calendar', 'event', 'free time',
        'availability', 'busy', 'remind', 'reminder', 'book', 'block time',
        'what time', 'current time', 'what day', 'today\'s date', 'what date',
        'tomorrow', 'yesterday', 'next week', 'this week'
    ],
    files: [
        'download', 'downloaded', 'document', 'pdf', 'docx', 'word doc', 'file',
        'read file', 'read that', 'summarize', 'summary', 'latest file', 'recent file',
        'my files', 'list files', 'what file', 'that document', 'the file', 'the document',
        'brief me', 'overview', 'contents of', 'open the', 'what does it say'
    ],
    slack: [
        'slack', 'tell the team', 'notify team', 'post to', 'announce', 'message channel',
        'send message', 'tell dev', 'tell #', 'post announcement', 'team notification'
    ],
    image: [
        'generate image', 'create image', 'draw', 'make a picture', 'generate a picture',
        'create a logo', 'make an image', 'illustration', 'visualize', 'visualise',
        'generate art', 'create art', 'make art', 'dall-e', 'dalle', 'artwork',
        'render an image', 'design a logo', 'generate a logo', 'picture of'
    ]
};

// Fallback keywords that map to both read and write
const FALLBACK_KEYWORD_MAP = {
    jira: ['jira', 'ticket', 'sprint', 'epic', 'kanban', 'issue', 'bug', 'board'],
    github: ['github', 'repo', 'pr', 'pull request', 'commit', 'branch', 'push', 'merge', 'clone', 'check', 'code'],
};

async function classifyIntent(userMessage, chatHistory = []) {
    const lowerMsg = userMessage.toLowerCase();
    const detectedCategories = new Set();

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

    if (detectedCategories.size > 0) {
        console.log(`[Traffic Cop] ⚡ Fast-Pass Intent: ${Array.from(detectedCategories)}`);
        return Array.from(detectedCategories);
    }

    // 3. CONTEXT PASS: For short messages OR messages with reference words, check conversation context
    const wordCount = userMessage.split(' ').length;
    const hasReferenceWord = /\b(that|it|this|the file|the document|the pdf|same|above|previous)\b/i.test(userMessage);
    
    if ((wordCount < 10 || hasReferenceWord) && chatHistory.length > 0) {
        console.log("[Traffic Cop] Follow-up detected (short or reference word). Checking conversation context...");
        
        // Look at the last few messages to determine context
        const recentMessages = chatHistory.slice(-4); // Last 2 exchanges (human + AI each)
        const recentContext = recentMessages.map(m => m.content || '').join(' ').toLowerCase();
        
        // Check if recent context mentions any service keywords
        const contextCategories = new Set();
        
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
        
        if (contextCategories.size > 0) {
            console.log(`[Traffic Cop] 🔗 Context-Pass Intent (follow-up): ${Array.from(contextCategories)}`);
            return Array.from(contextCategories);
        }
    }

    if (wordCount < 5) {
        console.log("[Traffic Cop] Short query with no context. Defaulting to General.");
        return ['general']; 
    }

    // 4. SLOW PASS: Fallback to LLM for ambiguous queries
    try {
        const response = await classifierLlm.invoke(CLASSIFIER_PROMPT + userMessage);
        const categories = response.content.toLowerCase().trim().split(',').map(c => c.trim());
        const validCategories = categories.filter(c => toolsByCategory.hasOwnProperty(c));
        
        if (validCategories.length === 0) return ['general'];
        
        console.log(`[Traffic Cop] Intent classified: ${validCategories.join(', ')}`);
        return validCategories;
    } catch (error) {
        console.error("[Traffic Cop] Classification error:", error.message);
        return ['general']; 
    }
}

function getToolsForCategories(categories) {
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

const HISTORY_FILE_PATH = path.join(process.cwd(), "chat_history.json");

// Global cache variable
const historyCache = {}; 

class JSONFileChatMessageHistory extends BaseListChatMessageHistory {
    constructor(sessionId) {
        super();
        this.sessionId = sessionId;
    }

    async getMessages() {
        // 1. Check Memory (Instant)
        if (historyCache[this.sessionId]) {
            // Convert simple objects back to LangChain classes
            return historyCache[this.sessionId].map(msg => {
                switch (msg.type) {
                     case 'human': return new HumanMessage(msg.content);
                     case 'ai': return new AIMessage(msg.content);
                     case 'system': return new SystemMessage(msg.content);
                     default: return new HumanMessage(msg.content);
                }
            });
        }
        
        // 2. Fallback to Disk (Async)
        if (!fs.existsSync(HISTORY_FILE_PATH)) return [];
        try {
            const fileContent = await fs.promises.readFile(HISTORY_FILE_PATH, 'utf-8');
            // Handle empty or whitespace-only files
            if (!fileContent || !fileContent.trim()) {
                historyCache[this.sessionId] = [];
                return [];
            }
            const allHistory = JSON.parse(fileContent);
            historyCache[this.sessionId] = allHistory[this.sessionId] || [];
            return this.getMessages(); // Recursive call now hits memory
        } catch (e) {
            console.error("Error reading history:", e);
            historyCache[this.sessionId] = []; // Initialize cache to prevent repeated failures
            return [];
        }
    }

    async addMessage(message) {
        // Update Memory immediately
        if (!historyCache[this.sessionId]) historyCache[this.sessionId] = [];
        
        const simpleMsg = {
            type: message.getType ? message.getType() : message._getType(),
            content: message.content
        };
        historyCache[this.sessionId].push(simpleMsg);

        // Save to Disk Asynchronously (Fire and forget - doesn't block response)
        this.saveToDisk();
    }

    async saveToDisk() {
        try {
            // We read first to ensure we don't overwrite other sessions
            let allHistory = {};
            if (fs.existsSync(HISTORY_FILE_PATH)) {
                 const data = await fs.promises.readFile(HISTORY_FILE_PATH, 'utf-8');
                 // Handle empty or malformed files
                 if (data && data.trim()) {
                     try {
                         allHistory = JSON.parse(data);
                     } catch (parseErr) {
                         console.warn("[History] Corrupted history file, resetting.", parseErr.message);
                         allHistory = {};
                     }
                 }
            }
            allHistory[this.sessionId] = historyCache[this.sessionId];
            await fs.promises.writeFile(HISTORY_FILE_PATH, JSON.stringify(allHistory, null, 2));
        } catch(e) {
            console.error("[History] Failed to save to disk:", e.message);
        }
    }
    
    // ... clear() method remains similar ...
}

function getMessageHistory(sessionId) {
  return new JSONFileChatMessageHistory(sessionId);
}

// =============================================================================
// DYNAMIC AGENT CREATION (Traffic Cop Pattern)
// =============================================================================

// Create agent with fresh timestamp each time (don't cache system prompt)
function getOrCreateAgent(tools) {
    // Always get fresh system prompt with current time
    const systemPrompt = getSystemPrompt();
    
    // Create a signature based on tool names
    const toolSignature = tools.map(t => t.name).sort().join(',');
    
    // Don't cache agents - always create fresh to ensure current timestamp
    const agent = createReactAgent({
        llm,
        tools,
        stateModifier: systemPrompt,
    });
    
    console.log(`[Agent Factory] Created agent with tools: ${toolSignature || '(none)'}`);
    return agent;
}

// The main processing function that classifies intent and routes to appropriate agent
async function processWithSemanticRouting(input) {
    const { input: userQuery, chat_history } = input;
    const history = Array.isArray(chat_history) ? chat_history : [];
    
    // Step 1: Classify intent using the Traffic Cop (now with context)
    const categories = await classifyIntent(userQuery, history);
    
    // Step 2: Get the appropriate tools for the classified categories
    const selectedTools = getToolsForCategories(categories);
    
    console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}`);
    
    // Step 3: Handle "general" conversation directly with LLM (no agent needed)
    if (selectedTools.length === 0) {
        console.log("[Traffic Cop] General conversation - using direct LLM call");
        
        // getSystemPrompt() already returns a SystemMessage — don't double-wrap
        const systemPrompt = getSystemPrompt();
        const messages = [
            systemPrompt,
            ...history,
            new HumanMessage(userQuery)
        ];
        
        const response = await llm.invoke(messages);
        return { messages: [...history, new HumanMessage(userQuery), response] };
    }
    
    // Step 4: Get or create an agent with these specific tools
    const agent = getOrCreateAgent(selectedTools);
    
    // Step 5: Execute the agent
    const result = await agent.invoke({
        messages: [...history, new HumanMessage(userQuery)]
    });
    
    return result;
}

// Streaming version for the server to use
export async function* streamWithSemanticRouting(userQuery, sessionId) {
    const messageHistory = getMessageHistory(sessionId);
    const history = await messageHistory.getMessages();
    
    // Step 1: Classify intent using the Traffic Cop (with conversation context)
    const categories = await classifyIntent(userQuery, history);

    const lowerQuery = userQuery.toLowerCase();

    if (lowerQuery.includes('system status') || lowerQuery.includes('battery') || lowerQuery.includes('uptime')) {
        console.log("⚡️ Reflex triggered: System Status");
        
        // Run the tool directly (ensure getSystemStatus is imported from ./systemTool.js)
        const status = await getSystemStatus(); 
        const reflexResponse = `**Reflex Response:**\n${status}`;
        
        // Fake the streaming event so the frontend handles it normally
        yield { 
            event: "on_chat_model_stream", 
            data: { chunk: { content: reflexResponse } } 
        };
        
        // Save reflex response to history
        await messageHistory.addMessage(new HumanMessage(userQuery));
        await messageHistory.addMessage(new AIMessage(reflexResponse));
        return;
    }
    
    // Step 2: Get the appropriate tools for the classified categories
    const selectedTools = getToolsForCategories(categories);
    
    console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}`);
    
    // Step 3: Handle "general" conversation directly with LLM (no agent needed)
    if (selectedTools.length === 0) {
        console.log("[Traffic Cop] General conversation - using direct LLM call");
        
        // getSystemPrompt() already returns a SystemMessage — don't double-wrap
        const systemPrompt = getSystemPrompt();
        const messages = [
            systemPrompt,
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
        return;
    }
    
    // Step 4: Get or create an agent with these specific tools
    const agent = getOrCreateAgent(selectedTools);
    
    // Step 5: Stream events from the agent
    const stream = agent.streamEvents(
        { messages: [...history, new HumanMessage(userQuery)] },
        { version: "v2" }
    );
    
    let completeResponse = "";
    
    for await (const event of stream) {
        // Forward the event
        yield event;
        
        // Capture final response for history
        if (event.event === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) {
                completeResponse += content;
            }
        }
    }
    
    // Save to history after streaming completes
    await messageHistory.addMessage(new HumanMessage(userQuery));
    if (completeResponse) {
        await messageHistory.addMessage(new AIMessage(completeResponse));
    }
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
