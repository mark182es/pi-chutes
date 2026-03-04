# Pi Chutes Extension

A pi coding agent extension that provides access to models from [Chutes.ai](https://llm.chutes.ai), a platform offering various open and proprietary LLM models via an OpenAI-compatible API.

> **Note:** This extension was previously called "chutes-provider" and has been renamed to "pi-chutes" to follow pi extension naming conventions.

## Features

- **Automatic Model Discovery**: Fetch the latest available models from chutes.ai
- **Persistent Storage**: Models are saved to a JSON file and loaded on startup
- **Change Tracking**: Shows what models were added, removed, or updated
- **Multiple Input Types**: Supports both text-only and vision (text + image) models
- **Reasoning Detection**: Automatically identifies models with reasoning capabilities
- **Cost Tracking**: Preserves pricing information from the API

## Installation

This extension is located in `~/.pi/agent/extensions/pi-chutes/`. If not present:

1. Create the directory:
   ```bash
   mkdir -p ~/.pi/agent/extensions/pi-chutes
   ```

2. Copy or create the `index.ts` file in that directory

## Quick Start

After the extension is loaded, run these commands in pi:

```bash
# 1. Login with your API key (interactive - will prompt for key)
/login
# Select "Chutes.ai" from the list
# Enter your API key when prompted

# 2. Update models (fetches latest available models)
/chutes-update

# 3. Select a model
/model chutes
# Choose any model from the list
```

## Usage

### Login (First Time Setup)

Use `/login` to authenticate with chutes.ai:

```
/login
```

This will:
1. Show a list of available providers
2. Select "Chutes.ai" from the list
3. Prompt you to enter your API key
4. Save the credentials to `~/.pi/agent/auth.json`

To logout and clear credentials:

```
/logout chutes
```

### Model Selection

Use the `/model` command to select a chutes model:

```
/model chutes
```

This will show all available chutes models in the model selector.

### Updating Models

Run the `/chutes-update` command to fetch the latest models from chutes.ai:

```
/chutes-update
```

This will:
1. Fetch the current model list from `https://llm.chutes.ai/v1/models`
2. Compare with previously saved models
3. Show a summary of changes (added, removed, updated)
4. Update the provider with new models
5. Save models to `~/.pi/agent/extensions/pi-chutes/models.json`

Example output:
```
Updated chutes models: +48 added, ~2 updated
Added: Qwen/Qwen3-32B, deepseek-ai/DeepSeek-V3-0324-TEE, ...
Updated: MiniMaxAI/MiniMax-M2.5-TEE
```

## Configuration

### Option 1: Using /login Command (Recommended)

The extension supports the `/login` command for easy API key setup:

```
/login
```

Select "Chutes.ai" from the provider list and enter your API key when prompted.

Your API key will be saved to `~/.pi/agent/auth.json` (as OAuth type) and will be used automatically.

### Option 2: Environment Variable

| Variable | Description |
|----------|-------------|
| `CHUTES_API_KEY` | Your API key for chutes.ai |

Set the environment variable in your shell:

```bash
export CHUTES_API_KEY=sk-...
```

### Option 3: Auth File

You can manually add your API key to `~/.pi/agent/auth.json`:

```json
{
  "chutes": { "type": "api_key", "key": "sk-..." }
}
```

### Option 4: .env File

Create a `.env` file in the extension directory:

```
CHUTES_API_KEY=sk-...
```

### JSON Configuration

You can also configure models via `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "chutes": {
      "baseUrl": "https://llm.chutes.ai/v1",
      "apiKey": "CHUTES_API_KEY",
      "api": "openai-completions",
      "models": []
    }
  }
  }
}
```

Note: The extension's `/chutes-update` command will override any manually configured models.

## Model Properties

The extension automatically converts these properties from the chutes API:

| API Field | Model Property | Description |
|-----------|----------------|-------------|
| `id` | `id` | Model identifier |
| `id` | `name` | Display name |
| `supported_features` includes "reasoning" | `reasoning` | Supports extended thinking |
| `input_modalities` | `input` | `["text"]` or `["text", "image"]` |
| `pricing.prompt` | `cost.input` | Input cost per 1M tokens |
| `pricing.completion` | `cost.output` | Output cost per 1M tokens |
| `pricing.input_cache_read` | `cost.cacheRead` | Cache read cost per 1M tokens |
| `context_length` / `max_model_len` | `contextWindow` | Context window size |
| `max_output_length` | `maxTokens` | Maximum output tokens |

## Files

- `index.ts` - Main extension code
- `models.json` - Saved models (created after first `/chutes-update`)
- `.env` - API key storage (optional, not needed if using `/login`)

## Commands

| Command | Description |
|---------|-------------|
| `/chutes-update` | Fetch latest models from chutes.ai |
| `/login` | Login to chutes.ai (select Chutes.ai from the list) |
| `/logout chutes` | Logout and clear stored credentials |

## Troubleshooting

### "Failed to update models" error

- Check your internet connection
- Verify `CHUTES_API_KEY` is set correctly
- Check if chutes.ai API is operational

### Models not appearing

- Run `/chutes-update` to fetch models
- Make sure the API key is valid
- Try reloading extensions with `/reload`

### API Key Issues

The extension expects the environment variable `CHUTES_API_KEY` to be set. You can:

1. Export it in your shell:
   ```bash
   export CHUTES_API_KEY=your_key
   ```

2. Or add it to a `.env` file in the extension directory

## License

This extension is provided as-is for use with pi coding agent.