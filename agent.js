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
import { getSystemStatus, executeSystemCommand, openApplication } from "./systemTool.js";
import { generateImage } from "./imageTool.js";
import { getJiraIssues, createJiraIssue, updateJiraIssue, deleteJiraIssue, createJiraProject, listJiraProjects } from "./jiraTool.js";
import { getCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, findFreeTime } from "./calendarTool.js";
import { sendSlackMessage, sendSlackAnnouncement, sendSlackLink } from "./slackTool.js";
import { createRepository, getRepoIssues, createRepoIssue, listCommits, listPullRequests, getPullRequest, getCommit, getRepoChecks } from "./githubTool.js";
import { getFigmaFileStructure, getFigmaComments, postFigmaComment } from "./figmaTool.js";
import { readFile, listDirectory, getLatestFile } from "./fileTool.js";
import { sendGmail, searchGmailContacts, getRecentEmails } from "./gmailTool.js";

// =============================================================================
// LLM PROVIDER SELECTION
// =============================================================================

let llm;
let classifierLlm;
let llmInitialized = false;
let llmProvider = null;

async function ensureFreshLLM() {
  if (llmProvider === 'github') {
    const freshToken = await getValidToken('github');
    if (freshToken && freshToken !== process.env.GITHUB_TOKEN) {
      process.env.GITHUB_TOKEN = freshToken;
      const githubModel = process.env.GITHUB_MODEL || 'gpt-4o';
      llm = new ChatOpenAI({
        modelName: githubModel,
        openAIApiKey: freshToken,
        temperature: 0.1,
        configuration: { baseURL: 'https://models.inference.ai.azure.com' },
      });
      classifierLlm = new ChatOpenAI({
        modelName: 'gpt-4o-mini',
        openAIApiKey: freshToken,
        temperature: 0,
        configuration: { baseURL: 'https://models.inference.ai.azure.com' },
      });
    }
  }
}

function initLLM() {
  if (llmInitialized) return;
  const provider = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  const hasGithubToken = !!process.env.GITHUB_TOKEN;
  const hasGoogleApiKey = !!process.env.GOOGLE_API_KEY;

  if (provider === 'ollama') {
    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
    llm = new ChatOllama({ baseUrl: ollamaBaseUrl, model: ollamaModel, temperature: 0.1 });
    classifierLlm = new ChatOllama({ baseUrl: ollamaBaseUrl, model: ollamaModel, temperature: 0 });
    llmProvider = 'ollama';
  } else if (provider === 'github' || (provider === 'auto' && hasGithubToken)) {
    const githubToken = process.env.GITHUB_TOKEN;
    const githubModel = process.env.GITHUB_MODEL || 'gpt-4o';
    llm = new ChatOpenAI({
      modelName: githubModel,
      openAIApiKey: githubToken,
      configuration: { baseURL: 'https://models.inference.ai.azure.com' },
    });
    classifierLlm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      openAIApiKey: githubToken,
      temperature: 0,
      configuration: { baseURL: 'https://models.inference.ai.azure.com' },
    });
    llmProvider = 'github';
  } else if (provider === 'gemini' || (provider === 'auto' && hasGoogleApiKey)) {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    llm = new ChatGoogleGenerativeAI({ apiKey: googleApiKey, model: "gemini-2.5-flash", temperature: 0.1 });
    classifierLlm = new ChatGoogleGenerativeAI({ apiKey: googleApiKey, model: "gemini-2.0-flash-lite", temperature: 0 });
    llmProvider = 'apikey';
  } else {
    throw new Error("No LLM configured.");
  }
  llmInitialized = true;
}

try { initLLM(); } catch (e) {}

// =============================================================================
// CUSTOM TOOL DEFINITIONS
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

const imageTools = [
  new DynamicStructuredTool({
    name: "generate_image_nano_banana",
    description: "Generate an image from a text description using Google's Nano Banana. Returns the local URL path of the generated image.",
    schema: z.object({
      prompt: z.string().describe("REQUIRED: A detailed description of the image to generate."),
      aspectRatio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).optional().describe("Aspect ratio. Default is '1:1'."),
    }),
    func: generateImage,
  }),
];

const jiraReadTools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Search Jira issues using JQL.",
    schema: z.object({
      jql: z.string().describe("REQUIRED: The JQL query string."),
    }),
    func: getJiraIssues,
  }),
  new DynamicStructuredTool({
    name: "list_jira_projects",
    description: "List all Jira projects.",
    schema: z.object({}),
    func: listJiraProjects,
  }),
];

const jiraWriteTools = [
  new DynamicStructuredTool({
    name: "create_jira_issue",
    description: "Create a Jira ticket.",
    schema: z.object({
      projectKey: z.string().describe("REQUIRED: Project Key (e.g., 'FDIT')."),
      summary: z.string().describe("REQUIRED: Ticket title"),
      description: z.string().optional(),
      issueType: z.string().optional(),
    }),
    func: createJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "update_jira_issue",
    description: "Update a Jira ticket.",
    schema: z.object({
      issueKey: z.string().describe("REQUIRED: The ticket key (e.g., 'FDIT-12')."),
      summary: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      assignee: z.string().optional(),
      duedate: z.string().optional(),
      labels: z.array(z.string()).optional(),
      parent: z.string().optional(),
    }),
    func: updateJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "delete_jira_issue",
    description: "Delete a Jira ticket.",
    schema: z.object({
        issueKey: z.string().describe("REQUIRED: The ticket key to delete."),
    }),
    func: deleteJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "create_jira_project",
    description: "Create a new Jira Project.",
    schema: z.object({
        key: z.string().describe("REQUIRED: The Project Key."),
        name: z.string().describe("REQUIRED: The name of the project."),
        description: z.string().optional(),
    }),
    func: createJiraProject,
  }),
];

const slackCustomTools = [
  new DynamicStructuredTool({
    name: "send_slack_message",
    description: "Send a message to a Slack channel.",
    schema: z.object({
      channel: z.string().optional(),
      message: z.string().describe("The message text to send."),
    }),
    func: sendSlackMessage,
  }),
  new DynamicStructuredTool({
    name: "send_slack_announcement",
    description: "Post a formatted announcement to Slack.",
    schema: z.object({
      channel: z.string().optional(),
      title: z.string().describe("Announcement headline."),
      body: z.string().describe("Main content."),
      footer: z.string().optional(),
      type: z.enum(['info', 'success', 'warning', 'error']).optional(),
    }),
    func: sendSlackAnnouncement,
  }),
  new DynamicStructuredTool({
    name: "send_slack_link",
    description: "Share a URL in Slack.",
    schema: z.object({
      channel: z.string().optional(),
      url: z.string().describe("The URL to share."),
      context: z.string().optional(),
    }),
    func: sendSlackLink,
  }),
];

const calendarTools = [
  new DynamicStructuredTool({
    name: "get_calendar_events",
    description: "Get upcoming events from Google Calendar.",
    schema: z.object({
      maxResults: z.number().optional(),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      calendarId: z.string().optional(),
    }),
    func: getCalendarEvents,
  }),
  new DynamicStructuredTool({
    name: "create_calendar_event",
    description: "Create a new event on Google Calendar.",
    schema: z.object({
      summary: z.string().describe("Title"),
      description: z.string().optional(),
      startDateTime: z.string().describe("Start time in ISO format."),
      endDateTime: z.string().describe("End time in ISO format."),
      location: z.string().optional(),
      attendees: z.array(z.string()).optional(),
    }),
    func: createCalendarEvent,
  }),
  new DynamicStructuredTool({
    name: "update_calendar_event",
    description: "Update an existing event on Google Calendar.",
    schema: z.object({
      eventId: z.string().describe("ID of event"),
      summary: z.string().optional(),
      description: z.string().optional(),
      startDateTime: z.string().optional(),
      endDateTime: z.string().optional(),
      location: z.string().optional(),
    }),
    func: updateCalendarEvent,
  }),
  new DynamicStructuredTool({
    name: "delete_calendar_event",
    description: "Delete an event from Google Calendar.",
    schema: z.object({
      eventId: z.string().describe("ID of event"),
    }),
    func: deleteCalendarEvent,
  }),
  new DynamicStructuredTool({
    name: "find_free_time",
    description: "Check for free/busy time.",
    schema: z.object({
      timeMin: z.string().describe("Start in ISO format"),
      timeMax: z.string().describe("End in ISO format"),
    }),
    func: findFreeTime,
  }),
];

const githubReadTools = [
  new DynamicStructuredTool({
    name: "get_repo_issues",
    description: "List issues for a GitHub repository.",
    schema: z.object({
      owner: z.string().describe("Repository owner."),
      repo: z.string().describe("Repository name."),
    }),
    func: getRepoIssues,
  }),
  new DynamicStructuredTool({
    name: "list_commits",
    description: "List recent commits.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      limit: z.number().optional(),
    }),
    func: listCommits,
  }),
  new DynamicStructuredTool({
    name: "list_pull_requests",
    description: "List pull requests.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      state: z.string().optional(),
    }),
    func: listPullRequests,
  }),
  new DynamicStructuredTool({
    name: "get_pull_request",
    description: "Get details of a pull request.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    func: getPullRequest,
  }),
  new DynamicStructuredTool({
    name: "get_commit",
    description: "Get details of a specific commit.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      sha: z.string(),
    }),
    func: getCommit,
  }),
  new DynamicStructuredTool({
    name: "get_repo_checks",
    description: "Get check runs for a ref.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      ref: z.string(),
    }),
    func: getRepoChecks,
  }),
];

const githubWriteTools = [
  new DynamicStructuredTool({
    name: "create_repository",
    description: "Create a new GitHub repository.",
    schema: z.object({
      name: z.string(),
      description: z.string().optional(),
      isPrivate: z.boolean().optional(),
    }),
    func: createRepository,
  }),
  new DynamicStructuredTool({
    name: "create_repo_issue",
    description: "Create a new issue on GitHub.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
    }),
    func: createRepoIssue,
  }),
];

const figmaTools = [
  new DynamicStructuredTool({
    name: "get_figma_file_structure",
    description: "Get the structure of a Figma file.",
    schema: z.object({
      fileKey: z.string(),
    }),
    func: getFigmaFileStructure,
  }),
  new DynamicStructuredTool({
    name: "get_figma_comments",
    description: "Get comments on a Figma file.",
    schema: z.object({
      fileKey: z.string(),
    }),
    func: getFigmaComments,
  }),
  new DynamicStructuredTool({
    name: "post_figma_comment",
    description: "Post a comment on a Figma file.",
    schema: z.object({
      fileKey: z.string(),
      message: z.string(),
      node_id: z.string().optional(),
    }),
    func: postFigmaComment,
  }),
];

const gmailTools = [
  new DynamicStructuredTool({
    name: "send_gmail",
    description: "Send an email via Gmail.",
    schema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
    }),
    func: sendGmail,
  }),
  new DynamicStructuredTool({
    name: "search_gmail_contacts",
    description: "Search user's email history to find an email address by name.",
    schema: z.object({
      query: z.string(),
    }),
    func: searchGmailContacts,
  }),
  new DynamicStructuredTool({
    name: "get_recent_emails",
    description: "Get recent emails.",
    schema: z.object({
      maxResults: z.number().optional(),
      query: z.string().optional(),
    }),
    func: getRecentEmails,
  }),
];

const fileTools = [
  new DynamicStructuredTool({
    name: "read_file",
    description: "Smart file reader.",
    schema: z.object({
      filePath: z.string(),
    }),
    func: readFile,
  }),
  new DynamicStructuredTool({
    name: "list_directory",
    description: "List files in a directory.",
    schema: z.object({
      directoryPath: z.string().optional(),
      filter: z.string().optional(),
      sortBy: z.enum(['modified', 'name', 'size']).optional(),
      limit: z.number().optional(),
    }),
    func: listDirectory,
  }),
  new DynamicStructuredTool({
    name: "get_latest_file",
    description: "Get the most recently modified file.",
    schema: z.object({
      directoryPath: z.string().optional(),
      extension: z.string().optional(),
    }),
    func: getLatestFile,
  }),
];

// =============================================================================
// TOOL CATEGORY MAP
// =============================================================================

const toolsByCategory = {
  jira_read:    jiraReadTools,
  jira_write:   jiraWriteTools,
  github_read:  githubReadTools,
  github_write: githubWriteTools,
  system:       systemTools,
  figma:        figmaTools,
  calendar:     calendarTools,
  files:        fileTools,
  slack:        slackCustomTools,
  gmail:        gmailTools,
  image:        imageTools,
  general:      [],
};

// =============================================================================
// SEMANTIC CLASSIFIER (The Traffic Cop)
// =============================================================================

const CLASSIFIER_PROMPT = `You are a fast intent classifier for E.D.I.T.H.
Classify the user's message into categories: jira_read, jira_write, github_read, github_write, figma, system, calendar, files, slack, gmail, image, general.
Output ONLY category names, comma-separated.`;

const KEYWORD_MAP = {
    jira_read: ['list tickets', 'show tickets', 'search jira', 'jira projects'],
    jira_write: ['create ticket', 'update ticket', 'delete ticket', 'mark as done'],
    github_read: ['list commits', 'check pr', 'list pr', 'github issues'],
    github_write: ['create repo', 'new repository', 'create issue'],
    figma: ['figma', 'design', 'mockup'],
    system: ['open app', 'launch', 'run command', 'terminal'],
    calendar: ['schedule', 'meeting', 'calendar', 'am i free'],
    files: ['download', 'document', 'pdf', 'read file'],
    slack: ['slack', 'tell the team', 'notify team', 'post to'],
    gmail: ['email', 'gmail', 'check mail', 'send email'],
    image: ['generate image', 'create image', 'draw', 'picture of']
};

const FALLBACK_KEYWORD_MAP = {
    jira: ['jira', 'ticket', 'issue'],
    github: ['github', 'repo', 'pr'],
};

async function classifyIntent(userMessage, chatHistory = []) {
    const lowerMsg = userMessage.toLowerCase();
    const detectedCategories = new Set();

    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(k => lowerMsg.includes(k))) detectedCategories.add(category);
    }

    for (const [service, keywords] of Object.entries(FALLBACK_KEYWORD_MAP)) {
        if (keywords.some(k => lowerMsg.includes(k))) {
            detectedCategories.add(`${service}_read`);
            detectedCategories.add(`${service}_write`);
        }
    }

    if (detectedCategories.size > 0) return Array.from(detectedCategories);

    try {
        const response = await classifierLlm.invoke(CLASSIFIER_PROMPT + "\n\nUser message: " + userMessage);
        const categories = response.content.toLowerCase().trim().split(',').map(c => c.trim());
        const validCategories = categories.filter(c => toolsByCategory.hasOwnProperty(c));
        return validCategories.length > 0 ? validCategories : ['general'];
    } catch (error) {
        return ['general'];
    }
}

function getToolsForCategories(categories) {
    const tools = new Set();
    for (const category of categories) {
        (toolsByCategory[category] || []).forEach(tool => tools.add(tool));
    }
    return Array.from(tools);
}

// =============================================================================
// CHAT HISTORY PERSISTENCE
// =============================================================================

const MAX_HISTORY_MESSAGES = 30;
function trimHistory(messages) {
    return messages.length <= MAX_HISTORY_MESSAGES ? messages : messages.slice(-MAX_HISTORY_MESSAGES);
}

const EDITH_DATA_DIR = path.join(os.homedir(), '.edith');
if (!fs.existsSync(EDITH_DATA_DIR)) fs.mkdirSync(EDITH_DATA_DIR, { recursive: true });
const HISTORY_FILE_PATH = path.join(EDITH_DATA_DIR, 'chat_history.json');

const historyCache = {}; 

class JSONFileChatMessageHistory extends BaseListChatMessageHistory {
    constructor(sessionId) {
        super();
        this.sessionId = sessionId;
    }

    async getMessages() {
        if (historyCache[this.sessionId]) {
            return historyCache[this.sessionId].map(msg => {
                if (msg.type === 'human') return new HumanMessage(msg.content);
                if (msg.type === 'ai') return new AIMessage(msg.content);
                return new HumanMessage(msg.content);
            });
        }
        if (!fs.existsSync(HISTORY_FILE_PATH)) return [];
        try {
            const data = await fs.promises.readFile(HISTORY_FILE_PATH, 'utf-8');
            const all = JSON.parse(data);
            historyCache[this.sessionId] = all[this.sessionId] || [];
            return this.getMessages();
        } catch (e) {
            return [];
        }
    }

    async addMessage(message) {
        if (!historyCache[this.sessionId]) historyCache[this.sessionId] = [];
        historyCache[this.sessionId].push({
            type: (message.getType ? message.getType() : message._getType()) === 'human' ? 'human' : 'ai',
            content: message.content
        });
        this.saveToDisk();
    }

    async saveToDisk() {
        try {
            let all = {};
            if (fs.existsSync(HISTORY_FILE_PATH)) {
                const data = await fs.promises.readFile(HISTORY_FILE_PATH, 'utf-8');
                all = JSON.parse(data);
            }
            all[this.sessionId] = (historyCache[this.sessionId] || []).slice(-50);
            await fs.promises.writeFile(HISTORY_FILE_PATH, JSON.stringify(all, null, 2));
        } catch(e) {}
    }

    async clear() {
        historyCache[this.sessionId] = [];
        await this.saveToDisk();
    }
}

function getMessageHistory(sessionId) {
  return new JSONFileChatMessageHistory(sessionId);
}

// =============================================================================
// DYNAMIC AGENT CREATION
// =============================================================================

const agentCache = new Map();

function getOrCreateAgent(tools) {
    const toolNames = tools.map(t => t.name).sort();
    const toolSignature = toolNames.join(',');

    if (agentCache.has(toolSignature)) return agentCache.get(toolSignature);

    const agent = createReactAgent({
        llm,
        tools,
        stateModifier: (state) => {
            const systemPrompt = getSystemPrompt();
            const toolInfo = toolNames.length > 0 
                ? `\n\n### ACTIVE PROTOCOLS\nLimited to: ${toolNames.join(', ')}.\nCRITICAL: If a tool is not here, you lack access.`
                : `\n\n### ACTIVE PROTOCOLS\nNO TOOLS AVAILABLE.`;

            const sanitizedMessages = state.messages.map(msg => {
                if (msg.type === 'tool' && typeof msg.content === 'string' && msg.content.length > 3000) {
                    msg.content = msg.content.substring(0, 3000) + "...[TRUNCATED]";
                }
                return msg;
            });

            return [new SystemMessage(systemPrompt + toolInfo), ...sanitizedMessages];
        }
    });
    
    agentCache.set(toolSignature, agent);
    return agent;
}

async function processWithSemanticRouting(input) {
    initLLM();
    await ensureFreshLLM();
    const { input: userQuery, chat_history } = input;
    const history = trimHistory(Array.isArray(chat_history) ? chat_history : []);
    const categories = await classifyIntent(userQuery, history);
    const selectedTools = getToolsForCategories(categories);
    
    if (selectedTools.length === 0) {
        const messages = [getSystemPrompt(), ...history, new HumanMessage(userQuery)];
        const response = await llm.invoke(messages);
        return { messages: [...history, new HumanMessage(userQuery), response] };
    }
    
    const agent = getOrCreateAgent(selectedTools);
    const result = await agent.invoke({ messages: [...history, new HumanMessage(userQuery)] });
    return result;
}

export async function* streamWithSemanticRouting(userQuery, sessionId) {
    initLLM();
    await ensureFreshLLM();
    const messageHistory = getMessageHistory(sessionId);
    const history = trimHistory(await messageHistory.getMessages());
    const categories = await classifyIntent(userQuery, history);
    const selectedTools = getToolsForCategories(categories);
    
    if (selectedTools.length === 0) {
        const messages = [getSystemPrompt(), ...history, new HumanMessage(userQuery)];
        const stream = await llm.stream(messages);
        let complete = "";
        for await (const chunk of stream) {
            if (chunk.content) {
                complete += chunk.content;
                yield { event: "on_chat_model_stream", data: { chunk: { content: chunk.content } } };
            }
        }
        await messageHistory.addMessage(new HumanMessage(userQuery));
        if (complete) await messageHistory.addMessage(new AIMessage(complete));
        return;
    }
    
    const agent = getOrCreateAgent(selectedTools);
    const stream = agent.streamEvents({ messages: [...history, new HumanMessage(userQuery)] }, { version: "v2" });
    let complete = "";
    for await (const event of stream) {
        yield event;
        if (event.event === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) complete += content;
        }
    }
    await messageHistory.addMessage(new HumanMessage(userQuery));
    if (complete) await messageHistory.addMessage(new AIMessage(complete));
}

const outputAdapter = (state) => {
   let messages = state.messages;
   if (!messages && state.agent && state.agent.messages) messages = state.agent.messages;
   const lastMessage = messages[messages.length - 1];
   return { output: lastMessage.content };
};

const agentChain = RunnableSequence.from([new RunnableLambda({ func: processWithSemanticRouting }), outputAdapter]);

export const agentExecutor = new RunnableWithMessageHistory({
  runnable: agentChain,
  getMessageHistory: getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history", 
  outputMessagesKey: "output",
});
