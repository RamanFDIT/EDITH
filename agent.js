import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createStructuredChatAgent } from "langchain/agents";
import { pull } from "langchain/hub";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

// Import your existing functions
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
  // FIX: Use the 'latest' alias to avoid 404 errors
  modelName: "gemini-1.5-flash", 
});

console.log("🧠 E.D.I.T.H. Online (Gemini 1.5 Flash - Structured)");

// Helper to wrap functions
const wrap = (fn) => (args) => fn(args);

const tools = [
  // --- JIRA TOOLS ---
  tool(wrap(getJiraIssues), {
    name: "search_jira_issues",
    description: "Search Jira issues. ARGUMENT MUST BE A JSON OBJECT WITH KEY 'jql'.",
    schema: z.object({
      jql: z.string().describe("The JQL query string."),
    }),
  }),
  tool(wrap(createJiraIssue), {
    name: "create_jira_issue",
    description: "Create a Jira ticket.",
    schema: z.object({
      projectKey: z.string().describe("Project Key (e.g., 'FDIT')"),
      summary: z.string().describe("Ticket title"),
      description: z.string().optional(),
      issueType: z.string().optional(),
    }),
  }),

  // --- GITHUB TOOLS ---
  tool(wrap(getRepoIssues), {
    name: "get_github_issues",
    description: "List issues in a GitHub repo.",
    schema: z.object({
      owner: z.string().describe("The owner of the repo"),
      repo: z.string().describe("The repository name"),
    }),
  }),
  tool(wrap(createRepoIssue), {
    name: "create_github_issue",
    description: "Create a GitHub issue.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
    }),
  }),
  tool(wrap(createRepository), {
    name: "create_github_repository",
    description: "Create a new GitHub repository.",
    schema: z.object({
      name: z.string().describe("The name of the new repository."),
      description: z.string().optional(),
      isPrivate: z.boolean().optional(),
    }),
  }),
  tool(wrap(listCommits), {
    name: "list_github_commits",
    description: "List recent commits in a repo.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      limit: z.number().optional(),
    }),
  }),
  tool(wrap(listPullRequests), {
    name: "list_github_pull_requests",
    description: "List pull requests.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      state: z.enum(['open', 'closed', 'all']).optional(),
    }),
  }),
  tool(wrap(getPullRequest), {
    name: "get_github_pull_request_details",
    description: "Get full details of a specific Pull Request.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
  }),
  tool(wrap(getCommit), {
    name: "get_github_commit_details",
    description: "Get full details of a specific commit.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      sha: z.string(),
    }),
  }),
];

// PULL STANDARD PROMPT FOR STRUCTURED AGENTS
const prompt = await pull("hwchase17/structured-chat-agent");

const agent = await createStructuredChatAgent({
  llm,
  tools,
  prompt,
});

export const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true,
  handleToolErrors: true, 
  handleParsingErrors: true, 
});

console.log("🚀 Tactical Systems Ready.");