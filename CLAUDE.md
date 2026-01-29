# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
# Development
pnpm install        # Install dependencies
pnpm build          # Build TypeScript
pnpm dev            # Watch mode

# Testing
pnpm test                        # Run all tests (146 tests)
pnpm test src/commands/          # Run tests in a directory
pnpm test src/crypto/__tests__/encrypt.test.ts  # Run single test file

# Code Quality
pnpm lint           # ESLint
pnpm format         # Prettier (fix)
pnpm format:check   # Prettier (check only)

# Local testing
pnpm start init     # Test init command
pnpm start status   # Test status command
```

## Project Overview

**claude-sync** is a CLI tool to sync Claude Code conversations across machines with E2E encryption.

## Architecture

```
src/
├── cli.ts                 # Entry point (Commander.js)
├── commands/              # CLI command implementations
│   ├── init.ts            # Initialize backend & encryption key
│   ├── push.ts            # Push resources to remote (batch encrypt)
│   ├── pull.ts            # Pull resources from remote (decrypt)
│   ├── install.ts         # Install Claude Code hooks
│   └── status.ts          # Show sync status
├── backends/              # Storage backends
│   ├── index.ts           # Backend interface & factory
│   ├── git.ts             # Git backend implementation
│   └── s3.ts              # S3-compatible backend (AWS, GCS, R2)
├── resources/             # Resource type system
│   ├── index.ts           # Resource registry & configs
│   ├── types.ts           # ResourceType, ResourceHandler interfaces
│   └── handlers/          # Per-type handlers
│       ├── sessions.ts    # Session transcripts (full replace)
│       ├── agents.ts      # Agent definitions (full replace)
│       └── settings.ts    # Settings (deep merge strategy)
├── crypto/                # Encryption (AES-256-GCM)
│   ├── encrypt.ts         # encrypt(), decrypt(), assertEncrypted()
│   └── keys.ts            # Key generation & loading
└── utils/
    ├── config.ts          # ~/.claude-sync/config.json management
    └── sessions.ts        # Session file discovery
```

### Key Data Flow

1. **Push**: `findLocal()` → `read()` → `encrypt()` → `backend.pushResource()`
2. **Pull**: `backend.listResources()` → `backend.pullResource()` → `decrypt()` → `handler.write()`

### Resource System

The resource system (`src/resources/`) abstracts different data types:

| Type | Strategy | Handler |
|------|----------|---------|
| `sessions` | Full replace | Finds `.jsonl` files in `~/.claude/projects/` |
| `agents` | Full replace | Syncs `~/.claude/agents/` directory |
| `settings` | Deep merge | Merges settings across machines |

To add a new resource type:
1. Add type to `ResourceType` in `src/resources/types.ts`
2. Create handler in `src/resources/handlers/`
3. Register in `RESOURCE_CONFIGS` in `src/resources/index.ts`

### Backend Interface

All backends implement the `Backend` interface in `src/backends/index.ts`:
- `pushResource(type, id, data)` / `pushResourceBatch(type, items)`
- `pullResource(type, id)` / `listResources(type)`
- `deleteResource(type, id)`

## Critical Patterns

### Always encrypt before storage
```typescript
import { encrypt } from "./crypto/encrypt.js";
const encrypted = await encrypt(sessionData);
await backend.pushResource("sessions", id, encrypted);
```

### Validate encryption before push
The `assertEncrypted()` function throws if data doesn't have the expected encrypted format (IV + AuthTag + Ciphertext).

### Handle missing config gracefully
```typescript
const config = await loadConfig();
if (!config?.initialized) {
  console.log("Run `claude-sync init` first");
  process.exit(1);
}
```

## Security Considerations

1. **Encryption key** - Never commit, stored at `~/.claude-sync/key` with mode 0600
2. **Session data** - May contain sensitive code, always encrypt before storage
3. **Git backend** - Use private repos only
4. **assertEncrypted()** - Called before every push to prevent plaintext leaks

## Adding a New Backend

1. Create `src/backends/mybackend.ts`
2. Implement the `Backend` interface
3. Add to `getBackend()` switch in `src/backends/index.ts`
4. Add CLI options in `src/commands/init.ts`
