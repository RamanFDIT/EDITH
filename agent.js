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
	throw new Error("GOOGLE_API_KEY not found in .env file. Please add it.");
}

const requestedModel = (process.env.GOOGLE_MODEL ?? "").trim();
const apiVersion = (process.env.GOOGLE_API_VERSION ?? "v1beta").trim();

const resolvedModel = await resolveGoogleModel({
	requestedModel,
	apiVersion,
	apiKey: googleApiKey,
});

const llm = new ChatGoogleGenerativeAI({
	apiKey: googleApiKey,
	model: resolvedModel,
	apiVersion,
});

console.log(
	`Google GenAI 'Brain' initialized with model: ${resolvedModel} (apiVersion=${apiVersion}).`,
);

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
