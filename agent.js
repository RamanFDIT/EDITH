import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

// Import ALL GitHub functions
import { 
  getRepoIssues, createRepoIssue, 
  listCommits, listPullRequests, 
  getPullRequest, getCommit 
} from "./githubTool.js";
import { getJiraIssues, createJiraIssue } from "./jiraTool.js";

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) throw new Error("GOOGLE_API_KEY not found.");

const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  modelName: "gemini-3-pro-preview", 
});

console.log("🧠 E.D.I.T.H. Online (Gemini 3 Pro) - Full GitHub Access Enabled.");

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
];

const systemPrompt = `You are E.D.I.T.H., a tactical intelligence AI.

**Protocol:**
1.  **Identity:** Precise, authoritative, and helpful.
2.  **Capabilities:** You can SEARCH/CREATE Jira tickets, and MANAGE GitHub Issues, Commits, and Pull Requests.
3.  **Input:** If a user asks for "recent changes", use 'list_github_commits'. If they ask "what's being reviewed", use 'list_github_pull_requests'.

**Mission:**
Manage software development lifecycles via Jira and GitHub.`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

const agent = await createToolCallingAgent({
  llm,
  tools,
  prompt,
});

export const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true,
  handleToolErrors: true, 
  handleParsingErrors: (e) => `Error parsing input: ${e}. Please try again with valid JSON.`,
});

console.log("🚀 Tactical Systems Ready.");