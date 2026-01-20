import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { RunnableWithMessageHistory, RunnableSequence } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
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

const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  model: "gemini-3-flash-preview", 
});

console.log(" E.D.I.T.H. Online (Gemini 3 Pro) - Full GitHub Access Enabled.");

const tools = [
  // --- JIRA TOOLS ---
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
  // ... inside const tools = [ ...

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

// ... rest of tools

  // --- GITHUB TOOLS (Repo) ---
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

  // --- GITHUB TOOLS (Issues) ---
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

  // --- GITHUB TOOLS (Commits & PRs) ---
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
  // --- SYSTEM LEVEL TOOLS ---
  new DynamicStructuredTool({
    name: "system_status_report",
    description: "Get current hardware and OS status.",
    schema: z.object({}),
    func: getSystemStatus,
  }),
  new DynamicStructuredTool({
    name: "execute_terminal_command",
    description: " EXECUTE SHELL COMMANDS. Use for file manipulation, running scripts, or system ops.",
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
  // ... inside tools = [ ...

// --- FIGMA TOOLS ---
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

// --- AUDIO TOOLS ---
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

// ... rest of your tools
];
const messageHistoryStore = {};

function getMessageHistory(sessionId) {
  if (!messageHistoryStore[sessionId]) {
    messageHistoryStore[sessionId] = new InMemoryChatMessageHistory();
  }
  return messageHistoryStore[sessionId];
}

const systemPrompt = EDITH_SYSTEM_PROMPT;

const agentGraph = createReactAgent({
  llm,
  tools,
  stateModifier: systemPrompt,
});

const agentWithInputAdapter = (input) => {
    const { input: userQuery, chat_history } = input;
    return {
        messages: [...chat_history, new HumanMessage(userQuery)]
    };
};

const outputAdapter = (state) => {
   // Log the state to debug
   // console.log("State in outputAdapter:", JSON.stringify(state, null, 2)); 
   
   if (!state || !state.messages || !Array.isArray(state.messages) || state.messages.length === 0) {
       return { output: "I'm not sure how to respond to that." };
   }
   const lastMessage = state.messages[state.messages.length - 1];
   return { output: lastMessage.content };
};

const agentChain = RunnableSequence.from([
    agentWithInputAdapter,
    agentGraph,
    outputAdapter
]);

export const agentExecutor = new RunnableWithMessageHistory({
  runnable: agentChain,
  getMessageHistory: getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history", 
});

console.log(" Tactical Systems Ready.");
