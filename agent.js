import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getRepoIssues } from "./githubTool.js";
import { getJiraIssues } from "./jiraTool";
import { DynamicStructuredTool } from "langchain";
import { ChatPromptTemplate, MessagePlaceholder } from "langchain/prompts"; 
import { createOpenAIToolsAgent, AgentExecutor } from "langchain/agents";
import { z } from "zod";
import dotenv from 'dotenv';

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;

if (!googleApiKey) {
  throw new Error("GOOGLE_API_KEY not found in .env file. Please add it.");
}

// 4. Initialize the "Brain" (the LLM)
const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  modelName: "gemini-1.5-pro-latest", // Using the recommended "Pro" model
});

console.log("Google GenAI 'Brain' initialized.");

console.log("Wrapping functions in tools...");

const tools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Use this tool to find and search for issues in Jira. You must provide a valid JQL query string.",
    // Define the arguments the AI must provide
    schema: z.object({
      jqlQuery: z.string().describe("A valid JQL query string. For example: 'project = CAP AND status = Open'"),
    }),
    // Tell the tool which function to run
    run: getJiraIssues, 
  }),
  
  new DynamicStructuredTool({
    name: "get_github_repo_issues",
    description: "Use this tool to get a list of issues from a GitHub repository. Requires the repository's owner and name.",
    // Define the arguments the AI must provide
    schema: z.object({
      owner: z.string().describe("The username or organization that owns the repository."),
      repo: z.string().describe("The name of the repository."),
    }),
    // Tell the tool which function to run
    run: getRepoIssues,
  }),
];

console.log("🛠️  Tools are defined and ready for the agent.");

console.log("Creating agent prompt 'rulebook'...");

const prompt = ChatPromptTemplate.fromMessages([
  // 1. The System Message: The AI's permanent instructions
  ["system", "You are a helpful project management assistant. You have access to tools for searching Jira and GitHub. You must respond with the final answer in plaintext."],
  
  // 2. The Human's Input: A placeholder for the user's question
  ["human", "{input}"],
  
  // 3. The "Scratchpad": A placeholder for the agent's internal thoughts and tool call results
  new MessagesPlaceholder("agent_scratchpad"), 
]);

console.log("Prompt 'rulebook' created.");