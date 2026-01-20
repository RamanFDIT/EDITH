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

// Import ALL GitHub functions
import { 
  getRepoIssues, createRepoIssue, 
  listCommits, listPullRequests, 
  getPullRequest, getCommit, createRepository,
  getRepoChecks
} from "./githubTool.js";
import { getJiraIssues, createJiraIssue, updateJiraIssue, deleteJiraIssue, createJiraProject } from "./jiraTool.js";
import { EDITH_SYSTEM_PROMPT } from "./systemPrompt.js";
import { getSystemStatus, executeSystemCommand, openApplication } from "./systemTool.js";
import { getFigmaFileStructure, getFigmaComments, postFigmaComment } from "./figmaTool.js";
import { transcribeAudio, generateSpeech } from "./audioTool.js";


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

console.log(" E.D.I.T.H. Online (Gemini 3 Pro) - Semantic Classification Enabled.");

// =============================================================================
// TOOL DEFINITIONS BY CATEGORY
// =============================================================================

const jiraTools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Search Jira issues. ARGUMENT MUST BE A JSON OBJECT WITH KEY 'jql'.",
    schema: z.object({
      jql: z.string().describe("The JQL query string. REQUIRED."),
    }),
    func: getJiraIssues,
  }),
  new DynamicStructuredTool({
    name: "create_jira_issue",
    description: "Create a Jira ticket.",
    schema: z.object({
      projectKey: z.string().describe("Project Key (e.g., 'FDIT')"),
      summary: z.string().describe("Ticket title"),
      description: z.string().optional(),
      issueType: z.string().optional(),
    }),
    func: createJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "update_jira_issue",
    description: "Update a Jira ticket's fields. Supports: Status, Priority, Summary, Description, Assignee, Due Date, Labels, and Parent. Do NOT change the summary unless explicitly asked.",
    schema: z.object({
      issueKey: z.string().describe("The ticket key (e.g., 'FDIT-12'). REQUIRED."),
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
    description: "Delete a Jira ticket by its key (e.g. FDIT-123).",
    schema: z.object({
        issueKey: z.string().describe("The ticket key to delete."),
    }),
    func: deleteJiraIssue,
  }),
  new DynamicStructuredTool({
    name: "create_jira_project",
    description: "Create a new Jira Project (sometimes referred to as a Space). REQUIRES ADMIN RIGHTS.",
    schema: z.object({
        key: z.string().describe("The Project Key (e.g., 'NEWPROJ'). Must be unique and uppercase."),
        name: z.string().describe("The name of the project."),
        description: z.string().optional().describe("Project description."),
        templateKey: z.string().optional().describe("Template key (default: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic')."),
        projectTypeKey: z.string().optional().describe("Type key (default: 'software')."),
    }),
    func: createJiraProject,
  }),
];

const githubTools = [
  new DynamicStructuredTool({
    name: "create_github_repository",
    description: "Create a new GitHub repository.",
    schema: z.object({
      name: z.string().describe("The name of the repository"),
      description: z.string().optional().describe("Description of the repository"),
      isPrivate: z.boolean().optional().describe("Whether the repo should be private (default false)"),
    }),
    func: createRepository,
  }),
  new DynamicStructuredTool({
    name: "get_github_issues",
    description: "List issues in a GitHub repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    func: getRepoIssues,
  }),
  new DynamicStructuredTool({
    name: "create_github_issue",
    description: "Create a GitHub issue.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
    }),
    func: createRepoIssue,
  }),
  new DynamicStructuredTool({
    name: "list_github_commits",
    description: "List recent commits in a repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      limit: z.number().optional().describe("Number of commits to return (default 5)"),
    }),
    func: listCommits,
  }),
  new DynamicStructuredTool({
    name: "list_github_pull_requests",
    description: "List pull requests in a repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      state: z.enum(['open', 'closed', 'all']).optional().describe("Filter by state (default 'open')"),
    }),
    func: listPullRequests,
  }),
  new DynamicStructuredTool({
    name: "get_github_pull_request_details",
    description: "Get full details of a specific Pull Request.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number().describe("The PR number (e.g. 42)"),
    }),
    func: getPullRequest,
  }),
  new DynamicStructuredTool({
    name: "get_github_commit_details",
    description: "Get full details of a specific commit by SHA.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      sha: z.string().describe("The full or partial commit hash"),
    }),
    func: getCommit,
  }),
  new DynamicStructuredTool({
    name: "get_github_repo_checks",
    description: "Get check runs for a specific commit reference.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      ref: z.string().describe("The commit SHA, branch name, or tag name."),
    }),
    func: getRepoChecks,
  }),
];

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

const figmaTools = [
  new DynamicStructuredTool({
    name: "scan_figma_file",
    description: "Get the structure (pages & frames) of a Figma file. Needs the 'fileKey' from the URL.",
    schema: z.object({
        fileKey: z.string().describe("The unique key from the Figma URL (e.g. '8w9d8s...')."),
    }),
    func: getFigmaFileStructure,
  }),
  new DynamicStructuredTool({
    name: "read_figma_comments",
    description: "Read recent comments on a Figma file.",
    schema: z.object({
        fileKey: z.string().describe("The Figma file key."),
    }),
    func: getFigmaComments,
  }),
  new DynamicStructuredTool({
    name: "post_figma_comment",
    description: "Post a comment or feedback on a Figma file.",
    schema: z.object({
        fileKey: z.string().describe("The Figma file key."),
        message: z.string().describe("The text content of the comment."),
        node_id: z.string().optional().describe("Optional ID of the specific node/frame to attach the comment to."),
    }),
    func: postFigmaComment,
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

// Map categories to their tool arrays
const toolsByCategory = {
  jira: jiraTools,
  github: githubTools,
  system: systemTools,
  figma: figmaTools,
  audio: audioTools,
  general: [], // No tools needed for general conversation
};

// All tools combined (for fallback or multi-category queries)
const allTools = [...jiraTools, ...githubTools, ...systemTools, ...figmaTools, ...audioTools];

// =============================================================================
// SEMANTIC CLASSIFIER (The Traffic Cop)
// =============================================================================

const CLASSIFIER_PROMPT = `You are a fast intent classifier for an AI assistant named E.D.I.T.H.
Your ONLY job is to classify the user's message into ONE OR MORE categories.

CATEGORIES:
- jira: Anything about tickets, issues, epics, sprints, backlogs, project management, task tracking, JIRA
- github: Anything about repositories, commits, pull requests, code reviews, branches, GitHub
- figma: Anything about designs, mockups, UI/UX, wireframes, Figma files, design comments
- system: Anything about opening apps, running commands, terminal, system status, launching programs, files
- audio: Anything about transcription, text-to-speech, voice, audio files
- general: Casual conversation, greetings, questions that don't need tools, chitchat

RULES:
1. Output ONLY the category name(s), comma-separated if multiple apply
2. If unsure, output "general"
3. Do NOT explain, do NOT add any other text
4. Be fast and decisive

EXAMPLES:
User: "How many epics do I have?" -> jira
User: "Check my open PRs on the EDITH repo" -> github
User: "Open Chrome and go to Figma" -> system,figma
User: "Hello, how are you?" -> general
User: "Create a ticket for the login bug" -> jira
User: "Read the comments on the dashboard design" -> figma
User: "What's my CPU usage?" -> system

User message: `;

// - Replace the existing classifyIntent function (approx lines 304-321)

// Define keywords for the "Fast Pass"
const KEYWORD_MAP = {
    jira: ['jira', 'ticket', 'sprint', 'epic', 'kanban', 'project'],
    figma: ['figma', 'design', 'mockup', 'wireframe', 'ux', 'ui', 'color', 'frame'],
    github: ['github', 'repo', 'pr', 'pull request', 'commit', 'branch', 'push'],
    audio: ['transcribe', 'speak', 'voice', 'listen', 'say'],
    system: ['open', 'launch', 'terminal', 'command', 'cpu', 'battery', 'status']
};

async function classifyIntent(userMessage) {
    const lowerMsg = userMessage.toLowerCase();
    const detectedCategories = new Set();

    // 1. FAST PASS: Check keywords (< 1ms)
    // If we find a specific keyword, we skip the slow LLM call entirely.
    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (keywords.some(k => lowerMsg.includes(k))) {
            detectedCategories.add(category);
        }
    }

    if (detectedCategories.size > 0) {
        console.log(`[Traffic Cop] ⚡ Fast-Pass Intent: ${Array.from(detectedCategories)}`);
        return Array.from(detectedCategories);
    }

    // 2. SLOW PASS: Fallback to LLM for ambiguous queries
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
            const allHistory = JSON.parse(fileContent);
            historyCache[this.sessionId] = allHistory[this.sessionId] || [];
            return this.getMessages(); // Recursive call now hits memory
        } catch (e) {
            console.error("Error reading history:", e);
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
                 allHistory = JSON.parse(data);
            }
            allHistory[this.sessionId] = historyCache[this.sessionId];
            await fs.promises.writeFile(HISTORY_FILE_PATH, JSON.stringify(allHistory, null, 2));
        } catch(e) { /* ignore write errors for speed */ }
    }
    
    // ... clear() method remains similar ...
}

function getMessageHistory(sessionId) {
  return new JSONFileChatMessageHistory(sessionId);
}

const systemPrompt = EDITH_SYSTEM_PROMPT;

// =============================================================================
// DYNAMIC AGENT CREATION (Traffic Cop Pattern)
// =============================================================================

// Cache for agents by tool signature to avoid recreating identical agents
const agentCache = new Map();

function getOrCreateAgent(tools) {
    // Create a signature based on tool names
    const toolSignature = tools.map(t => t.name).sort().join(',');
    
    if (agentCache.has(toolSignature)) {
        return agentCache.get(toolSignature);
    }
    
    const agent = createReactAgent({
        llm,
        tools,
        stateModifier: systemPrompt,
    });
    
    agentCache.set(toolSignature, agent);
    console.log(`[Agent Factory] Created new agent with tools: ${toolSignature || '(none)'}`);
    return agent;
}

// The main processing function that classifies intent and routes to appropriate agent
async function processWithSemanticRouting(input) {
    const { input: userQuery, chat_history } = input;
    const history = Array.isArray(chat_history) ? chat_history : [];
    
    // Step 1: Classify intent using the Traffic Cop
    const categories = await classifyIntent(userQuery);
    
    // Step 2: Get the appropriate tools for the classified categories
    const selectedTools = getToolsForCategories(categories);
    
    console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}`);
    
    // Step 3: Get or create an agent with these specific tools
    const agent = getOrCreateAgent(selectedTools);
    
    // Step 4: Execute the agent
    const result = await agent.invoke({
        messages: [...history, new HumanMessage(userQuery)]
    });
    
    return result;
}

// Streaming version for the server to use
export async function* streamWithSemanticRouting(userQuery, sessionId) {
    const messageHistory = getMessageHistory(sessionId);
    const history = await messageHistory.getMessages();
    
    // Step 1: Classify intent using the Traffic Cop
    const categories = await classifyIntent(userQuery);
    
    // Step 2: Get the appropriate tools for the classified categories
    const selectedTools = getToolsForCategories(categories);
    
    console.log(`[Traffic Cop] Selected ${selectedTools.length} tools for categories: ${categories.join(', ')}`);
    
    // Step 3: Get or create an agent with these specific tools
    const agent = getOrCreateAgent(selectedTools);
    
    // Step 4: Stream events from the agent
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
