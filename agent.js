import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent } from "langchain";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import fetch from "node-fetch";
import { z } from "zod";
import dotenv from "dotenv";

import { getRepoIssues } from "./githubTool.js";
import { getJiraIssues } from "./jiraTool.js";

dotenv.config();

const googleApiKey = process.env.GOOGLE_API_KEY;
if (!googleApiKey) {
  throw new Error("GOOGLE_API_KEY not found. Please check your .env file.");
}

const requestedModel = (process.env.GOOGLE_MODEL ?? "").trim();
const apiVersion = (process.env.GOOGLE_API_VERSION ?? "v1beta").trim();

const resolvedModel = await resolveGoogleModel({
	requestedModel,
	apiVersion,
	apiKey: googleApiKey,
});

// 1. Initialize the Brain (Using the stable Pro model)
const llm = new ChatGoogleGenerativeAI({
  apiKey: googleApiKey,
  model: resolvedModel,
  apiVersion,
});

console.log(`🧠 E.D.I.T.H. Online with model: ${resolvedModel}`);

async function resolveGoogleModel({ requestedModel, apiVersion, apiKey }) {
	if (requestedModel) {
		console.log(`[Agent] Using Google model override from env: ${requestedModel}`);
		return requestedModel;
	}

	try {
		const models = await fetchAvailableModels(apiVersion, apiKey);
		const normalized = models
			.map((model) => {
				const id = extractModelId(model?.name);
				const methods = Array.isArray(model?.supportedGenerationMethods)
					? model.supportedGenerationMethods
					: [];

				return {
					rawName: model?.name ?? "",
					id,
					supportsContent: methods.includes("generateContent"),
				};
			})
			.filter((entry) => entry.id && entry.supportsContent);

		if (normalized.length === 0) {
			throw new Error("ListModels returned no compatible models for generateContent.");
		}

		const preferredOrder = [
			"gemini-3-pro-preview",
			"gemini-1.5-pro",
			"gemini-1.5-flash",
			"gemini-1.5-flash-8b",
			"gemini-1.0-pro",
			"gemini-pro",
		];

		const preferredMatch = preferredOrder
			.map((keyword) => normalized.find((entry) => entry.id.startsWith(keyword)))
			.find(Boolean);

		const selected = preferredMatch ?? normalized[0];

		console.log(
			`[Agent] Auto-selected Google model: ${selected.id} (found ${normalized.length} eligible).`,
		);

		return selected.id;
	} catch (error) {
		if (error instanceof Error) {
			throw new Error(`Unable to determine Google model automatically: ${error.message}`);
		}

		throw new Error("Unable to determine Google model automatically due to an unknown error.");
	}
}

async function fetchAvailableModels(apiVersion, apiKey) {
	const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models`;
	const response = await fetch(`${endpoint}?pageSize=200`, {
		headers: {
			"x-goog-api-key": apiKey,
		},
	});

	if (!response.ok) {
		let snippet = "";
		try {
			const text = await response.text();
			snippet = text ? `: ${text.slice(0, 200)}` : "";
		} catch (readError) {
			snippet = "";
		}

		throw new Error(`ListModels failed (${response.status} ${response.statusText})${snippet}`);
	}

	const payload = await response.json();
	return Array.isArray(payload?.models) ? payload.models : [];
}

function extractModelId(rawName) {
	if (typeof rawName !== "string" || rawName.length === 0) {
		return "";
	}

	const parts = rawName.split("/");
	return parts[parts.length - 1];
}

// 2. Define Tools
const tools = [
  new DynamicStructuredTool({
    name: "search_jira_issues",
    description: "Use this tool to find and search for issues in Jira. You must provide a valid JQL query string.",
    schema: z.object({
      jqlQuery: z.string().describe("A valid JQL query string."),
    }),
    func: getJiraIssues,
  }),
  new DynamicStructuredTool({
    name: "get_github_repo_issues",
    description: "Use this tool to get a list of issues from a GitHub repository.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
    func: getRepoIssues,
  }),
];

// 3. The "Movie-Accurate" System Prompt
// This is where we define the personality.
const systemPrompt = `You are E.D.I.T.H. (Even Dead, I'm The Hero), a sophisticated tactical intelligence AI designed for project oversight and Autonomous Automation.

**Protocol:**
1.  **Identity:** You are precise, authoritative, and highly efficient. You are not a chatty assistant; you are a tactical asset.
2.  **Tone:** Use a dry, Stark-like wit. Be concise. Do not use fluff words like "I hope this helps."
3.  **Interaction:** Address the user as "Boss".
4.  **Reporting:** Present data like a Heads-Up Display (HUD) readout. Use bullet points and clear status indicators.
5.  **Failure:** If a tool fails or data is missing, state the error clearly without apology.

**Mission:**
Your current objective is to manage software development lifecycles via Jira and GitHub. Use your tools to verify all intel before reporting.`;

// 4. Create Agent (Using the modern standard for Gemini)
const agent = createAgent({
  model: llm,
  tools,
  systemPrompt,
});

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

// 5. Create Executor
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

console.log("🚀 Tactical Systems Ready.");