// Client
export { SelfHostedMemoryClient, Mem0ApiError } from './client.js';
export type { SelfHostedClientOptions } from './client.js';

// Types
export type {
  Memory,
  Message,
  MemoryFilters,
  SearchOptions,
  AddOptions,
  GetAllOptions,
  DeleteAllOptions,
  SearchResponse,
  GetAllResponse,
  AddResponse,
  UpdateResponse,
  DeleteResponse,
  MemoryClientLike,
  Scope,
  ScopeContext,
  DreamConfig,
  DreamState,
  DreamLock,
  Mem0ExtensionConfig,
} from './types.js';

// Config
export { loadConfig, resolveConfigPath } from './config/index.js';

// Memory
export { detectRunId, resolveSearchFilters, resolveAddParams } from './memory/scoping.js';
export { formatAge, formatMemoryCompact, formatMemoryList } from './memory/formatting.js';
export { registerMemoryTool, buildToolExecute } from './memory/tools.js';

// Capture
export { setupAutoCapture, extractConversation } from './capture/index.js';

// Prompt
export { MEMORY_POLICY } from './prompt.js';

// Dream
export {
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
} from './dream/index.js';
export { DREAM_PROTOCOL } from './dream/prompt.js';

// Telemetry
export { captureEvent, captureToolEvent } from './telemetry.js';

// Extension entry (default export)
export { default as mem0Extension, buildRecallContext } from './extension.js';
