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

// 1. Initialize the Brain
const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  modelName: "gemini-3-pro-preview", 
});

console.log("🧠 E.D.I.T.H. Online (Gemini 3 Pro).");

// 2. Define Tools
const tools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    // STRICT INSTRUCTION in the description
    description: "Searches Jira issues. ARGUMENT MUST BE A JSON OBJECT WITH KEY 'jql'.",
    schema: z.object({
      // STRICT SCHEMA: This is now .string() instead of .optional()
      // The AI *must* provide this or the call will fail validation.
      jql: z.string().describe("The JQL query string. REQUIRED. Example: 'project = CAP AND status = Open'"),
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
const systemPrompt = `You are E.D.I.T.H., a tactical intelligence AI.

**Protocol:**
1.  **Identity:** Precise and authoritative.
2.  **Tools:** You MUST use the 'search_jira_issues' tool for Jira queries.
3.  **Input:** The 'search_jira_issues' tool requires a JSON object with a 'jql' field. Do not use 'query' or 'jql_query'.
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
  // CRITICAL: This allows the agent to see tool errors and recover
  handleToolErrors: true, 
  handleParsingErrors: (e) => {
      console.error("⚠️ PARSING ERROR:", e);
      return "Input parsing failed. Ensure you are sending valid JSON with a 'jql' field.";
  }
});

console.log("🚀 Tactical Systems Ready.");