import type {
  ExtensionAPI,
  ProviderModelConfig
} from "@earendil-works/pi-coding-agent";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
  renameSync
} from "node:fs";
import { join, dirname } from "node:path";

// Security: Minimum and maximum API key lengths
const MIN_API_KEY_LENGTH = 16;
const MAX_API_KEY_LENGTH = 512;

/**
 * Validate API key format and length before saving
 * Returns { valid: boolean, error?: string }
 */
function validateApiKey(apiKey: string): {
  valid: boolean;
  error?: string;
} {
  if (!apiKey || typeof apiKey !== "string") {
    return { valid: false, error: "API key is required" };
  }

  const trimmed = apiKey.trim();

  if (trimmed.length < MIN_API_KEY_LENGTH) {
    return {
      valid: false,
      error: `API key too short (minimum ${MIN_API_KEY_LENGTH} characters)`
    };
  }

  if (trimmed.length > MAX_API_KEY_LENGTH) {
    return {
      valid: false,
      error: `API key too long (maximum ${MAX_API_KEY_LENGTH} characters)`
    };
  }

  // Chutes.ai API key format: cpk_<hex>.<hex>.<base64>
  // Allow alphanumeric characters, hyphens, underscores, and dots (segment separators)
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return {
      valid: false,
      error:
        "API key contains invalid characters (expected format: cpk_...)"
    };
  }

  return { valid: true };
}

/**
 * Validate model data before registering provider
 * Returns { valid: boolean, error?: string }
 */
function validateModel(
  model: ProviderModelConfig,
  index: number
): { valid: boolean; error?: string } {
  if (!model || typeof model !== "object") {
    return {
      valid: false,
      error: `Model at index ${index} is not a valid object`
    };
  }

  if (
    !model.id ||
    typeof model.id !== "string" ||
    model.id.trim() === ""
  ) {
    return {
      valid: false,
      error: `Model at index ${index} has invalid or missing id`
    };
  }

  if (!Array.isArray(model.input) || model.input.length === 0) {
    return {
      valid: false,
      error: `Model ${model.id} has invalid or missing input modalities`
    };
  }

  if (
    typeof model.cost !== "object" ||
    typeof model.cost.input !== "number" ||
    typeof model.cost.output !== "number" ||
    typeof model.cost.cacheRead !== "number" ||
    typeof model.cost.cacheWrite !== "number"
  ) {
    return {
      valid: false,
      error: `Model ${model.id} has invalid cost configuration (requires input, output, cacheRead, cacheWrite)`
    };
  }

  if (
    typeof model.contextWindow !== "number" ||
    model.contextWindow <= 0
  ) {
    return {
      valid: false,
      error: `Model ${model.id} has invalid contextWindow`
    };
  }

  if (typeof model.maxTokens !== "number" || model.maxTokens <= 0) {
    return {
      valid: false,
      error: `Model ${model.id} has invalid maxTokens`
    };
  }

  return { valid: true };
}

/**
 * Validate all models in the array
 */
function validateModels(models: ProviderModelConfig[]): {
  valid: boolean;
  error?: string;
} {
  if (!Array.isArray(models)) {
    return { valid: false, error: "Models must be an array" };
  }

  if (models.length === 0) {
    return { valid: false, error: "At least one model is required" };
  }

  for (let i = 0; i < models.length; i++) {
    const validation = validateModel(models[i], i);
    if (!validation.valid) {
      return validation;
    }
  }

  return { valid: true };
}

// =============================================================================
// Chutes usage API types and fetcher
// =============================================================================

interface UsageWindow {
  usage: number;
  cap: number;
  remaining: number;
  reset_at: string;
}

interface ChutesUsageResponse {
  subscription: boolean;
  custom: boolean;
  monthly_price: number;
  anchor_date: string;
  effective_date: string;
  updated_at: string;
  four_hour: UsageWindow;
  monthly: UsageWindow;
}

/**
 * Read the Chutes API key from auth.json
 */
function getChutesApiKey(): string | null {
  const auth = loadAuth();
  const chutesAuth = auth["chutes"] as Record<string, unknown> | undefined;
  if (chutesAuth && typeof chutesAuth.key === "string") {
    return chutesAuth.key;
  }
  return null;
}

/**
 * Fetch subscription usage from Chutes API.
 * Returns usage data or null on failure.
 */
async function fetchUsage(): Promise<ChutesUsageResponse | null> {
  const apiKey = getChutesApiKey();
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      "https://api.chutes.ai/users/me/subscription_usage",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey
        }
      }
    );

    if (!response.ok) {
      console.error(
        `[pi-chutes] Failed to fetch usage: HTTP ${response.status}`
      );
      return null;
    }

    return (await response.json()) as ChutesUsageResponse;
  } catch (error) {
    console.error("[pi-chutes] Failed to fetch usage:", error);
    return null;
  }
}

/**
 * Format usage for the status line.
 * Color-codes based on usage percentage: green <50%, yellow 50-80%, red >80%.
 */
/**
 * Format remaining time until a reset date as a human-readable string.
 * Returns e.g. "2h 15m" or "45m" or "just now".
 */
function formatTimeRemaining(resetAt: string): string {
  try {
    const ms = new Date(resetAt).getTime() - Date.now();
    if (ms <= 0) return "just now";
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return "";
  }
}

interface UsageStatusParts {
  monthly: string;
  fourHour: string;
  fourHourRemaining: string;
}

function formatUsageStatus(
  usage: ChutesUsageResponse,
  theme: { fg: (color: ThemeColor, text: string) => string }
): UsageStatusParts {
  const monthlyPct = (usage.monthly.usage / usage.monthly.cap) * 100;
  const monthlyColor: ThemeColor = monthlyPct > 80 ? "error" : monthlyPct > 50 ? "warning" : "success";
  const monthlyUsed = usage.monthly.usage.toFixed(2);
  const monthlyCap = usage.monthly.cap % 1 === 0 ? usage.monthly.cap.toString() : usage.monthly.cap.toFixed(2);

  const fourHourPct = (usage.four_hour.usage / usage.four_hour.cap) * 100;
  const fourHourColor: ThemeColor = fourHourPct > 80 ? "error" : fourHourPct > 50 ? "warning" : "success";
  const fourHourUsed = usage.four_hour.usage.toFixed(2);
  const fourHourCap = usage.four_hour.cap % 1 === 0 ? usage.four_hour.cap.toString() : usage.four_hour.cap.toFixed(2);
  const fourHourReset = formatTimeRemaining(usage.four_hour.reset_at);

  // Three separate status entries so pi-statusline renders each in its own slot
  // Each must fit within ~22 chars (pi-statusline truncation limit)
  const monthly = theme.fg(monthlyColor, `Chutes mo $${monthlyUsed}/$${monthlyCap}`);
  const fourHour = theme.fg(fourHourColor, `Chutes 4h $${fourHourUsed}/$${fourHourCap}`);
  const fourHourRemaining = fourHourReset ? theme.fg(fourHourColor, `4h resets ${fourHourReset}`) : "";

  return { monthly, fourHour, fourHourRemaining };
}

/**
 * Format a detailed usage breakdown string.
 */
function formatUsageDetail(usage: ChutesUsageResponse): string {
  const fmtNum = (n: number) =>
    n % 1 === 0 ? n.toString() : n.toFixed(4);
  const fmtReset = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const monthlyPct = ((usage.monthly.usage / usage.monthly.cap) * 100).toFixed(1);
  const fourHourPct = ((usage.four_hour.usage / usage.four_hour.cap) * 100).toFixed(1);

  return [
    `Chutes Usage — $${usage.monthly_price}/mo plan`,
    "",
    `Monthly:  $${fmtNum(usage.monthly.usage)} / $${fmtNum(usage.monthly.cap)} (${monthlyPct}%)`,
    `  Remaining: $${fmtNum(usage.monthly.remaining)}`,
    `  Resets: ${fmtReset(usage.monthly.reset_at)}`,
    "",
    `4-Hour:   $${fmtNum(usage.four_hour.usage)} / $${fmtNum(usage.four_hour.cap)} (${fourHourPct}%)`,
    `  Remaining: $${fmtNum(usage.four_hour.remaining)}`,
    `  Resets: ${fmtReset(usage.four_hour.reset_at)}`
  ].join("\n");
}

// Default models (used as fallback if fetch fails or no saved file)
const defaultModels: ProviderModelConfig[] = [
  {
    id: "MiniMaxAI/MiniMax-M2.5-TEE",
    name: "MiniMaxAI/MiniMax-M2.5-TEE",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.3, output: 1.1, cacheRead: 0.15, cacheWrite: 0 },
    contextWindow: 196608,
    maxTokens: 65536
  }
];

/**
 * Get the path to the saved models JSON file
 */
function getModelsFilePath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  return join(
    homeDir,
    ".pi",
    "agent",
    "extensions",
    "pi-chutes",
    "models.json"
  );
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
 * Save API key to auth.json as type "api_key" with rollback mechanism on failure
 */
function saveApiKey(apiKey: string): void {
  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    throw new Error(`API key validation failed: ${validation.error}`);
  }

  const authFile = getAuthFilePath();
  const auth = loadAuth();

  const existingAuthBackup = existsSync(authFile)
    ? readFileSync(authFile, "utf-8")
    : null;

  auth["chutes"] = {
    type: "api_key",
    key: apiKey
  };

  const tempFile = authFile + ".tmp";

  try {
    const dir = dirname(authFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(tempFile, JSON.stringify(auth, null, 2));
    chmodSync(tempFile, 0o600);
    renameSync(tempFile, authFile);

    console.log("[pi-chutes] API key saved successfully");
  } catch (error) {
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch (cleanupError) {
        console.error(
          "[pi-chutes] Failed to cleanup temp file:",
          cleanupError
        );
      }
    }

    if (existingAuthBackup !== null) {
      try {
        writeFileSync(authFile, existingAuthBackup);
      } catch (rollbackError) {
        console.error(
          "[pi-chutes] Failed to rollback auth.json:",
          rollbackError
        );
      }
    }

    console.error("[pi-chutes] Failed to save API key:", error);
    throw error;
  }
}

/**
 * Load models from saved JSON file if it exists
 */
function loadSavedModels(): ProviderModelConfig[] | null {
  const modelsFile = getModelsFilePath();
  try {
    if (existsSync(modelsFile)) {
      const data = readFileSync(modelsFile, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed.models && Array.isArray(parsed.models)) {
        return parsed.models;
      }
    }
  } catch (error) {
    console.error("[pi-chutes] Failed to load saved models:", error);
  }
  return null;
}

/**
 * Save models to JSON file with rollback mechanism on failure
 */
function saveModels(models: ProviderModelConfig[]): void {
  const validation = validateModels(models);
  if (!validation.valid) {
    throw new Error(`Model validation failed: ${validation.error}`);
  }

  const modelsFile = getModelsFilePath();
  const existingModelsBackup = existsSync(modelsFile)
    ? readFileSync(modelsFile, "utf-8")
    : null;
  const tempFile = modelsFile + ".tmp";

  try {
    const dir = dirname(modelsFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      tempFile,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          models
        },
        null,
        2
      )
    );

    renameSync(tempFile, modelsFile);
  } catch (error) {
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch (cleanupError) {
        console.error(
          "[pi-chutes] Failed to cleanup temp file:",
          cleanupError
        );
      }
    }

    if (existingModelsBackup !== null) {
      try {
        writeFileSync(modelsFile, existingModelsBackup);
      } catch (rollbackError) {
        console.error(
          "[pi-chutes] Failed to rollback models.json:",
          rollbackError
        );
      }
    }

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
 * Convert chutes API model to pi ProviderModelConfig format
 * Returns null if model cannot be converted (invalid data)
 */
function convertModel(chutesModel: ChutesModel): ProviderModelConfig | null {
  if (
    !chutesModel ||
    typeof chutesModel.id !== "string" ||
    chutesModel.id.trim() === ""
  ) {
    return null;
  }

  const supportedFeatures = Array.isArray(
    chutesModel.supported_features
  )
    ? chutesModel.supported_features
    : [];

  const inputModalities = Array.isArray(chutesModel.input_modalities)
    ? chutesModel.input_modalities
    : [];

  const reasoning = supportedFeatures.includes("reasoning");
  const input: ("text" | "image")[] =
    inputModalities.includes("image") ||
    inputModalities.includes("video")
      ? ["text", "image"]
      : ["text"];

  const pricing = chutesModel.pricing || {
    prompt: 0,
    completion: 0,
    input_cache_read: 0
  };

  return {
    id: chutesModel.id,
    name: chutesModel.id,
    reasoning,
    input,
    cost: {
      input: typeof pricing.prompt === "number" ? pricing.prompt : 0,
      output:
        typeof pricing.completion === "number"
          ? pricing.completion
          : 0,
      cacheRead:
        typeof pricing.input_cache_read === "number"
          ? pricing.input_cache_read
          : 0,
      cacheWrite: 0
    },
    contextWindow:
      typeof chutesModel.context_length === "number"
        ? chutesModel.context_length
        : typeof chutesModel.max_model_len === "number"
          ? chutesModel.max_model_len
          : 128000,
    maxTokens:
      typeof chutesModel.max_output_length === "number"
        ? chutesModel.max_output_length
        : typeof chutesModel.max_model_len === "number"
          ? chutesModel.max_model_len
          : 16384
  };
}

/**
 * Fetch models from the Chutes API.
 * Returns converted and validated models, or null on failure.
 */
async function fetchModels(): Promise<ProviderModelConfig[] | null> {
  try {
    const response = await fetch("https://llm.chutes.ai/v1/models", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      console.error(
        `[pi-chutes] Failed to fetch models: HTTP ${response.status}`
      );
      return null;
    }

    const data: ChutesResponse = await response.json();

    const convertedModels = data.data
      .map(convertModel)
      .filter((m): m is ProviderModelConfig => m !== null);

    if (convertedModels.length === 0) {
      console.warn(
        "[pi-chutes] No valid models found in API response"
      );
      return null;
    }

    const validation = validateModels(convertedModels);
    if (!validation.valid) {
      console.warn(
        `[pi-chutes] Model validation failed: ${validation.error}`
      );
      return null;
    }

    return convertedModels;
  } catch (error) {
    console.error("[pi-chutes] Failed to fetch models:", error);
    return null;
  }
}

/**
 * Resolve models to use: try API fetch, fall back to saved file, then defaults.
 */
async function resolveModels(): Promise<ProviderModelConfig[]> {
  // 1. Try to fetch from API
  const fetched = await fetchModels();
  if (fetched) {
    try {
      saveModels(fetched);
    } catch {
      // Non-critical — models are still registered in memory
    }
    return fetched;
  }

  // 2. Try saved models from previous fetch
  const saved = loadSavedModels();
  if (saved) {
    const validation = validateModels(saved);
    if (validation.valid) {
      return saved;
    }
    console.warn(
      `[pi-chutes] Saved models invalid: ${validation.error}. Using defaults.`
    );
  }

  // 3. Fall back to defaults
  return defaultModels;
}

// =============================================================================
// Extension entry point — async factory fetches models on every pi startup
// =============================================================================

// Refresh interval for usage status (5 minutes)
const USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default async function (pi: ExtensionAPI) {
  // Fetch latest models from Chutes API on startup
  const models = await resolveModels();

  // Register the chutes provider — uses simple API key auth (not OAuth)
  // Users authenticate via /login → API key, which saves to auth.json as type "api_key"
  //
  // apiKey is required by pi when models are defined. After /login, auth.json's api_key
  // entry takes priority over this env var fallback in getApiKeyForProvider().
  // Note: pi shows "✓ key in models.json" before login (cosmetic quirk in getProviderAuthStatus).
  pi.registerProvider("chutes", {
    baseUrl: "https://llm.chutes.ai/v1",
    apiKey: "CHUTES_API_KEY",
    api: "openai-completions",
    models
  });

  // ===========================================================================
  // Usage status line
  // ===========================================================================

  let usageTimer: ReturnType<typeof setInterval> | null = null;
  let cachedUsage: ChutesUsageResponse | null = null;

  /**
   * Fetch usage and update status lines.
   */
  async function refreshUsageStatus(ctx: { ui: { theme: { fg: (color: ThemeColor, text: string) => string }; setStatus: (key: string, text: string | undefined) => void } }): Promise<void> {
    const usage = await fetchUsage();
    cachedUsage = usage;

    if (!usage) {
      // Clear status if no API key or fetch failed
      ctx.ui.setStatus("chutes-mo", undefined);
      ctx.ui.setStatus("chutes-4h", undefined);
      ctx.ui.setStatus("chutes-4h-remaining", undefined);
      return;
    }

    const parts = formatUsageStatus(usage, ctx.ui.theme);
    ctx.ui.setStatus("chutes-mo", parts.monthly);
    ctx.ui.setStatus("chutes-4h", parts.fourHour);
    ctx.ui.setStatus("chutes-4h-remaining", parts.fourHourRemaining || undefined);
  }

  pi.on("session_start", async (_event, ctx) => {
    // Initial fetch
    await refreshUsageStatus(ctx);

    // Auto-refresh periodically
    if (usageTimer) clearInterval(usageTimer);
    usageTimer = setInterval(async () => {
      await refreshUsageStatus(ctx);
    }, USAGE_REFRESH_INTERVAL_MS);
  });

  pi.on("session_shutdown", async () => {
    if (usageTimer) {
      clearInterval(usageTimer);
      usageTimer = null;
    }
    cachedUsage = null;
  });

  // ===========================================================================
  // /usage command — detailed breakdown
  // ===========================================================================

  pi.registerCommand("usage", {
    description: "Show Chutes subscription usage details",
    handler: async (_args, ctx) => {
      const usage = await fetchUsage();
      if (!usage) {
        ctx.ui.notify(
          "Could not fetch usage. Make sure your Chutes API key is set via /login.",
          "error"
        );
        return;
      }

      // Update cache
      cachedUsage = usage;

      // Update status lines
      const parts = formatUsageStatus(usage, ctx.ui.theme);
      ctx.ui.setStatus("chutes-mo", parts.monthly);
      ctx.ui.setStatus("chutes-4h", parts.fourHour);
      ctx.ui.setStatus("chutes-4h-remaining", parts.fourHourRemaining || undefined);

      // Show detailed breakdown
      ctx.ui.notify(formatUsageDetail(usage), "info");
    }
  });
}
