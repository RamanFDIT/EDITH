import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

// Import ALL GitHub functions including createRepository
import { 
  getRepoIssues, createRepoIssue, 
  listCommits, listPullRequests, 
  getPullRequest, getCommit,
  createRepository 
} from "./githubTool.js";
import { getJiraIssues, createJiraIssue } from "./jiraTool.js";

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) throw new Error("GOOGLE_API_KEY not found.");

const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  modelName: "gemini-3-pro-preview", 
});

console.log("🧠 E.D.I.T.H. Online (Gemini 3 Pro) - Repository Creation Enabled.");

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

  // --- GITHUB TOOLS (Repos, Commits, PRs) ---
  new DynamicStructuredTool({
    name: "create_github_repository",
    description: "Create a new GitHub repository for the authenticated user.",
    schema: z.object({
      name: z.string().describe("The name of the new repository. NO SPACES."),
      description: z.string().optional().describe("Short description of the project."),
      isPrivate: z.boolean().optional().describe("Set to true for private repo, false for public."),
    }),
    func: createRepository,
  }),
  new DynamicStructuredTool({
    name: "list_github_commits",
    description: "List recent commits in a repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      limit: z.number().optional(),
    }),
    func: listCommits,
  }),
  new DynamicStructuredTool({
    name: "list_github_pull_requests",
    description: "List pull requests in a repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      state: z.enum(['open', 'closed', 'all']).optional(),
    }),
    func: listPullRequests,
  }),
  new DynamicStructuredTool({
    name: "get_github_pull_request_details",
    description: "Get full details of a specific Pull Request.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    func: getPullRequest,
  }),
  new DynamicStructuredTool({
    name: "get_github_commit_details",
    description: "Get full details of a specific commit by SHA.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      sha: z.string(),
    }),
    func: getCommit,
  }),
];

const systemPrompt = `You are E.D.I.T.H., a tactical intelligence AI.

**Protocol:**
1.  **Identity:** Precise, authoritative, and helpful.
2.  **Capabilities:** You can SEARCH/CREATE Jira tickets, and MANAGE GitHub Issues, Commits, PRs, and REPOSITORIES.
3.  **Input:** If user says "Create a new repo", use 'create_github_repository'.

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