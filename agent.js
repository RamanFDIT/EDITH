import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

import { getRepoIssues } from "./githubTool.js";
import { getJiraIssues } from "./jiraTool.js";

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) {
  throw new Error("GOOGLE_API_KEY not found. Please check your .env file.");
}

// 1. Initialize the Brain (Gemini 3 Pro)
const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  modelName: "gemini-3-pro-preview", 
});

console.log("🧠 E.D.I.T.H. Online (Gemini 3 Pro).");

// 2. Define Tools
const tools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Use this tool to find and search for issues in Jira. The input must be a JSON object containing the JQL query.",
    // FIX 1: The "Universal Schema" - Accepts ANY variable name the AI chooses
    schema: z.object({
      jql: z.string().optional().describe("A valid JQL query string."),
      jql_query: z.string().optional().describe("A valid JQL query string."),
      jqlQuery: z.string().optional().describe("A valid JQL query string."),
    }),
    func: getJiraIssues,
  }),
  new DynamicStructuredTool({
    name: "get_github_repo_issues",
    description: "Use this tool to get a list of issues from a GitHub repository.",
    schema: z.object({
      owner: z.string().describe("The username or organization that owns the repository."),
      repo: z.string().describe("The name of the repository."),
    }),
    func: getRepoIssues,
  }),
];

// 3. System Prompt
const systemPrompt = `You are E.D.I.T.H. (Even Dead, I'm The Hero), a sophisticated tactical intelligence AI.

**Protocol:**
1.  **Identity:** You are precise, authoritative, and highly efficient.
2.  **Interaction:** Address the user as "Raman".
3.  **Reporting:** Present data like a Heads-Up Display (HUD) readout.
4.  **Failure:** If a tool fails, state the error clearly.

**Mission:**
Manage software development lifecycles via Jira and GitHub.`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

// 4. Create the Agent
const agent = await createToolCallingAgent({
  llm,
  tools,
  prompt,
});

// 5. Create Executor
export const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true,
  // FIX 2: Auto-fix errors instead of crashing silently
  handleParsingErrors: true, 
});

console.log("🚀 Tactical Systems Ready.");