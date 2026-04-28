# Pi Chutes Extension

A pi coding agent extension that provides access to models from [Chutes.ai](https://llm.chutes.ai), a platform offering various open and proprietary LLM models via an OpenAI-compatible API.

## Features

- **Automatic Model Discovery**: Fetches the latest models from Chutes.ai on every startup
- **Offline Fallback**: Uses cached models from previous fetch if API is unreachable
- **Multiple Input Types**: Supports both text-only and vision (text + image) models
- **Reasoning Detection**: Automatically identifies models with reasoning capabilities
- **Cost Tracking**: Preserves pricing information from the API
- **Secure API Key Storage**: Stores keys as `api_key` type with atomic writes and rollback

## Installation

### Option 1: npm (recommended)

```shell
pi install npm:pi-chutes
```

Then restart pi.

### Option 2: Git

```shell
pi install git:github.com/mark182es/pi-chutes
```

Then restart pi.

### Option 3: Manual

1. Create the directory:

   ```bash
   mkdir -p ~/.pi/agent/extensions/pi-chutes
   ```

2. Copy or create the `index.ts` file in that directory

## Quick Start

After the extension is loaded:

```bash
# 1. Login with your API key (select Chutes.ai from the list)
/login

# 2. Select a model
/model chutes
```

That's it. Models are fetched automatically on every pi startup.

## Usage

### Login

Use the standard `/login` command to authenticate:

```
/login
```

Select **Chutes.ai** from the provider list and enter your API key when prompted (format: `cpk_...`). The key will be:

1. Validated for correct format
2. Verified against the Chutes API
3. Saved securely to `~/.pi/agent/auth.json`

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

### Automatic Model Updates

Models are **fetched automatically from the Chutes API every time pi starts**. No manual update command is needed. If the API is unreachable, cached models from the previous fetch are used instead.

The model cache is stored at `~/.pi/agent/extensions/pi-chutes/models.json`.

## Configuration

### Option 1: Using /login (Recommended)

```
/login
```

Select **Chutes.ai** from the provider list and enter your API key. This integrates with pi's built-in authentication system.

### Option 2: Environment Variable

| Variable         | Description                |
| ---------------- | -------------------------- |
| `CHUTES_API_KEY` | Your API key for chutes.ai |

```bash
export CHUTES_API_KEY=cpk_...
```

### Option 3: Auth File

Manually add your API key to `~/.pi/agent/auth.json`:

```json
{
  "chutes": { "type": "api_key", "key": "cpk_..." }
}
```

## Model Properties

The extension automatically converts these properties from the Chutes API:

| API Field                                 | Model Property   | Description                       |
| ----------------------------------------- | ---------------- | --------------------------------- |
| `id`                                      | `id`             | Model identifier                  |
| `id`                                      | `name`           | Display name                      |
| `supported_features` includes "reasoning" | `reasoning`      | Supports extended thinking        |
| `input_modalities`                        | `input`          | `["text"]` or `["text", "image"]` |
| `pricing.prompt`                          | `cost.input`     | Input cost per 1M tokens          |
| `pricing.completion`                      | `cost.output`    | Output cost per 1M tokens         |
| `pricing.input_cache_read`                | `cost.cacheRead` | Cache read cost per 1M tokens     |
| `context_length` / `max_model_len`        | `contextWindow`  | Context window size               |
| `max_output_length`                       | `maxTokens`      | Maximum output tokens             |

## Files

- `index.ts` — Main extension code
- `~/.pi/agent/extensions/pi-chutes/models.json` — Cached models (auto-created)

## Troubleshooting

### "API key contains invalid characters" error

Make sure you're entering your full API key including dots (e.g., `cpk_xxx.yyy.zzz`). The key format uses dot-separated segments.

### "API key is invalid or unauthorized" error

- Verify your API key is correct and active at [chutes.ai](https://chutes.ai)
- Make sure the key hasn't been revoked
- Try logging in again with `/login`

### Models not appearing

- Models are fetched automatically on startup — just restart pi
- If offline, cached models from the last successful fetch are used
- Check your internet connection if models seem outdated

### Startup is slow

The extension fetches models from the Chutes API on startup. If the API is slow to respond, pi will take a moment longer to start. The fetched models are cached, so offline startups use the cache instantly.

### Migrating from a previous version

If you previously used an older version of this extension that stored credentials in OAuth format, they will be automatically migrated to the proper `api_key` format on startup. No action needed.

## Security

### API Key Validation

- API keys are validated for length (16-512 characters)
- Only alphanumeric characters, dots, hyphens, and underscores are allowed (matching Chutes.ai key format: `cpk_<hex>.<hex>.<base64>`)
- Invalid keys are rejected before saving

### API Key Verification

- The `/login` flow verifies your API key against the Chutes API before accepting it
- This prevents storing invalid keys that would fail at runtime

### Secure Credential Storage

- API keys are stored as `type: "api_key"` in auth.json (not as OAuth credentials)
- Credentials are written to a temporary file first, then atomically renamed
- File permissions are set to `0600` (owner read/write only)
- Write failures include automatic rollback to prevent corrupted auth files

### Automatic Migration

- Legacy OAuth-type credentials are automatically converted to `api_key` format on startup

### Model Data Validation

- All model data from the API is validated before registration
- Invalid or malformed models are filtered out

## License

This extension is provided as-is for use with pi coding agent.
