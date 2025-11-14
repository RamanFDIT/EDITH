import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent } from "langchain";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from "dotenv";

import { getRepoIssues } from "./githubTool.js";
import { getJiraIssues } from "./jiraTool.js";

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;

if (!googleApiKey) {
	throw new Error("GOOGLE_API_KEY not found in .env file. Please add it.");
}

const llm = new ChatGoogleGenerativeAI({
	apiKey: googleApiKey,
	model: "gemini-1.5-pro-latest",
});

console.log("Google GenAI 'Brain' initialized.");

const tools = [
	new DynamicStructuredTool({
		name: "search_jira_issues",
		description: "Use this tool to find and search for issues in Jira. You must provide a valid JQL query string.",
		schema: z.object({
			jqlQuery: z
				.string()
				.describe("A valid JQL query string. For example: 'project = CAP AND status = Open'"),
		}),
		run: getJiraIssues,
	}),
	new DynamicStructuredTool({
		name: "get_github_repo_issues",
		description: "Use this tool to get a list of issues from a GitHub repository. Requires the repository's owner and name.",
		schema: z.object({
			owner: z.string().describe("The username or organization that owns the repository."),
			repo: z.string().describe("The name of the repository."),
		}),
		run: getRepoIssues,
	}),
];

console.log("🛠️  Tools are defined and ready for the agent.");

const agent = createAgent({
	model: llm,
	tools,
	systemPrompt:
		"You are a helpful project management assistant. You have access to tools for searching Jira and GitHub. You must respond with the final answer in plaintext.",
});

console.log("LangChain ReAct agent created.");

const flattenMessageContent = (content) => {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}

				if (item && typeof item === "object" && "text" in item) {
					return item.text ?? "";
				}

				return "";
			})
			.join("")
			.trim();
	}

	return "";
};

export const agentExecutor = {
	async invoke({ input }) {
		if (!input || typeof input !== "string") {
			throw new Error("Agent requires a non-empty input string.");
		}

		const finalState = await agent.invoke({
			messages: [new HumanMessage(input)],
		});

		const aiMessages = finalState.messages.filter((message) => AIMessage.isInstance(message));
		const lastMessage = aiMessages.at(-1);
		const output = lastMessage ? flattenMessageContent(lastMessage.content) : "";

		return { output };
	},
};

console.log("Agent executor ready.");
