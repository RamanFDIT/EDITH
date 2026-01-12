import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { RunnableWithMessageHistory, RunnableSequence } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

// Import ALL GitHub functions
import { 
  getRepoIssues, createRepoIssue, 
  listCommits, listPullRequests, 
  getPullRequest, getCommit, createRepository 
} from "./githubTool.js";
import { getJiraIssues, createJiraIssue } from "./jiraTool.js";
import { EDITH_SYSTEM_PROMPT } from "./systemPrompt.js";
import { getSystemStatus, executeSystemCommand, openApplication } from "./systemTool.js";

dotenv.config();

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
];
const messageHistoryStore = {};

function getMessageHistory(sessionId) {
  if (!messageHistoryStore[sessionId]) {
    messageHistoryStore[sessionId] = new InMemoryChatMessageHistory();
  }
  return messageHistoryStore[sessionId];
}

const systemPrompt = \\\;

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
