import type { ExtensionAPI, Model } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";

// Default models (used as fallback if fetch fails or no saved file)
const defaultModels: Model[] = [
	{
		id: "MiniMaxAI/MiniMax-M2.5-TEE",
		name: "MiniMaxAI/MiniMax-M2.5-TEE",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 1.1, cacheRead: 0.15 },
		contextWindow: 196608,
		maxTokens: 65536
	}
];

/**
 * Get the path to the saved models JSON file
 */
function getModelsFilePath(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
	return join(homeDir, ".pi", "agent", "extensions", "pi-chutes", "models.json");
}

/**
 * Get the path to the auth.json file
 */
function getAuthFilePath(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
	return join(homeDir, ".pi", "agent", "auth.json");
}

/**
 * Load auth.json
 */
function loadAuth(): Record<string, unknown> {
	const authFile = getAuthFilePath();
	try {
		if (existsSync(authFile)) {
			const data = readFileSync(authFile, "utf-8");
			return JSON.parse(data);
		}
	} catch (error) {
		console.error("[pi-chutes] Failed to load auth.json:", error);
	}
	return {};
}

/**
 * Save API key to auth.json (as api_key type, not oauth)
 */
function saveApiKey(apiKey: string): void {
	const authFile = getAuthFilePath();
	const auth = loadAuth();

	// Save as api_key type (not oauth)
	auth["chutes"] = {
		type: "api_key",
		key: apiKey
	};

	try {
		const dir = dirname(authFile);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(authFile, JSON.stringify(auth, null, 2));
		chmodSync(authFile, 0o600); // Set secure permissions
		console.log(`[pi-chutes] API key saved to ${authFile}`);
	} catch (error) {
		console.error("[pi-chutes] Failed to save API key:", error);
		throw error;
	}
}

/**
 * Load models from saved JSON file if it exists
 */
function loadSavedModels(): Model[] | null {
	const modelsFile = getModelsFilePath();
	try {
		if (existsSync(modelsFile)) {
			const data = readFileSync(modelsFile, "utf-8");
			const parsed = JSON.parse(data);
			if (parsed.models && Array.isArray(parsed.models)) {
				console.log(`[pi-chutes] Loaded ${parsed.models.length} models from ${modelsFile}`);
				return parsed.models;
			}
		}
	} catch (error) {
		console.error("[pi-chutes] Failed to load saved models:", error);
	}
	return null;
}

/**
 * Save models to JSON file
 */
function saveModels(models: Model[]): void {
	const modelsFile = getModelsFilePath();
	try {
		const dir = dirname(modelsFile);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(modelsFile, JSON.stringify({
			updatedAt: new Date().toISOString(),
			models
		}, null, 2));
	} catch (error) {
		console.error("[pi-chutes] Failed to save models:", error);
		throw error;
	}
}

interface ChutesModel {
	id: string;
	pricing?: {
		prompt: number;
		completion: number;
		input_cache_read: number;
	};
	context_length?: number;
	max_output_length?: number;
	input_modalities?: string[];
	supported_features?: string[];
	confidential_compute?: boolean;
	max_model_len?: number;
}

interface ChutesResponse {
	data: ChutesModel[];
}

/**
 * Convert chutes API model to pi Model format
 */
function convertModel(chutesModel: ChutesModel): Model {
	const supportedFeatures = chutesModel.supported_features || [];
	const inputModalities = chutesModel.input_modalities || [];

	const reasoning = supportedFeatures.includes("reasoning");
	const input = inputModalities.includes("image") || inputModalities.includes("video")
		? (["text", "image"] as const)
		: (["text"] as const);

	const pricing = chutesModel.pricing || { prompt: 0, completion: 0, input_cache_read: 0 };

	return {
		id: chutesModel.id,
		name: chutesModel.id,
		reasoning,
		input,
		cost: {
			input: pricing.prompt,
			output: pricing.completion,
			cacheRead: pricing.input_cache_read
		},
		contextWindow: chutesModel.context_length || chutesModel.max_model_len || 128000,
		maxTokens: chutesModel.max_output_length || chutesModel.max_model_len || 16384
	};
}

/**
 * Compare two model lists to find differences
 */
function compareModels(oldModels: Model[], newModels: Model[]): {
	added: Model[];
	removed: Model[];
	updated: Model[];
} {
	const oldIds = new Set(oldModels.map(m => m.id));
	const newIds = new Set(newModels.map(m => m.id));

	const added = newModels.filter(m => !oldIds.has(m.id));
	const removed = oldModels.filter(m => !newIds.has(m.id));

	// Find updated models (same id but different properties)
	const updated: Model[] = [];
	for (const newModel of newModels) {
		const oldModel = oldModels.find(m => m.id === newModel.id);
		if (oldModel) {
			// Check if any properties changed
			if (
				oldModel.reasoning !== newModel.reasoning ||
				JSON.stringify(oldModel.input) !== JSON.stringify(newModel.input) ||
				oldModel.cost.input !== newModel.cost.input ||
				oldModel.cost.output !== newModel.cost.output ||
				oldModel.cost.cacheRead !== newModel.cost.cacheRead ||
				oldModel.contextWindow !== newModel.contextWindow ||
				oldModel.maxTokens !== newModel.maxTokens
			) {
				updated.push(newModel);
			}
		}
	}

	return { added, removed, updated };
}

export default function (pi: ExtensionAPI) {
	// Try to load saved models, fall back to defaults
	const initialModels = loadSavedModels() ?? defaultModels;

	// Track current models for comparison
	let currentModels: Model[] = initialModels;

	// OAuth configuration for /login command
	const chutesOAuth = {
		name: "Chutes.ai",
		async login(callbacks) {
			// Prompt user for API key
			const apiKey = await callbacks.onPrompt({
				message: "Enter your Chutes.ai API key:"
			});
			if (!apiKey || apiKey.trim() === "") {
				throw new Error("API key is required");
			}
			// Return credentials (key is stored in auth.json automatically)
			return {
				access: apiKey.trim(),
				refresh: apiKey.trim(), // Use same key for refresh (API keys don't expire)
				expires: Number.MAX_SAFE_INTEGER // Never expires
			};
		},
		async refreshToken(credentials) {
			// API keys don't expire, just return the same credentials
			return credentials;
		},
		getApiKey(credentials) {
			// Extract the API key from credentials
			return credentials.access;
		}
	};

	// Register the chutes provider with OAuth/login support
	pi.registerProvider("chutes", {
		baseUrl: "https://llm.chutes.ai/v1",
		apiKey: "CHUTES_API_KEY", // Fallback to env var if no OAuth credentials
		api: "openai-completions",
		models: currentModels,
		oauth: chutesOAuth
	});

	// Register the chutes-update command
	pi.registerCommand("chutes-update", {
		description: "Update chutes provider with latest available models from chutes.ai",
		handler: async (_args, ctx) => {
			try {
				ctx.ui.notify("Fetching models from chutes.ai...", "info");

				// Fetch models from chutes API
				const response = await fetch("https://llm.chutes.ai/v1/models", {
					method: "GET",
					headers: {
						"Accept": "application/json"
					}
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const data: ChutesResponse = await response.json();
				const fetchedModels = data.data.map(convertModel);

				// Compare with current models
				const { added, removed, updated } = compareModels(currentModels, fetchedModels);

				// Use all fetched models (they represent the full list from API)
				const mergedModels = fetchedModels;

				// Update current models for future comparisons
				currentModels = mergedModels;

				// Re-register the provider with updated models (keep OAuth config)
				pi.registerProvider("chutes", {
					baseUrl: "https://llm.chutes.ai/v1",
					apiKey: "CHUTES_API_KEY",
					api: "openai-completions",
					models: mergedModels,
					oauth: chutesOAuth
				});

				// Build summary message
				const parts: string[] = [];
				if (added.length > 0) {
					parts.push(`+${added.length} added`);
				}
				if (removed.length > 0) {
					parts.push(`-${removed.length} removed`);
				}
				if (updated.length > 0) {
					parts.push(`~${updated.length} updated`);
				}

				const summary = parts.length > 0 ? parts.join(", ") : "no changes";
				ctx.ui.notify(`Updated chutes models: ${summary}`, "success");

				// Show details
				if (added.length > 0) {
					ctx.ui.notify(`Added: ${added.map(m => m.id).join(", ")}`, "info");
				}
				if (removed.length > 0) {
					ctx.ui.notify(`Removed: ${removed.map(m => m.id).join(", ")}`, "warning");
				}
				if (updated.length > 0) {
					ctx.ui.notify(`Updated: ${updated.map(m => m.id).join(", ")}`, "info");
				}

				// Save to JSON file for reference
				try {
					saveModels(mergedModels);
					ctx.ui.notify(`Models saved to ${getModelsFilePath()}`, "info");
				} catch (saveError) {
					// Non-critical error, don't fail the command
					console.error("Failed to save models to file:", saveError);
				}

				return;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to update models: ${message}`, "error");
				return;
			}
		}
	});
}