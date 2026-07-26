import { z } from 'zod';
import { claudeCodeAgentConfigSchema } from './claude-code.js';
import { codexCliAgentConfigSchema } from './codex-cli.js';
import { copilotCliAgentConfigSchema } from './copilot-cli.js';

export {
  claudeCodeAgentConfigSchema,
  claudeCodeConfigSchema,
  type ClaudeCodeConfig,
} from './claude-code.js';
export {
  CODEX_OUTPUT_LIMIT_MAX_BYTES,
  codexCliAgentConfigSchema,
  codexCliConfigSchema,
  codexReasoningEffortSchema,
  type CodexCliConfig,
} from './codex-cli.js';
export {
  copilotCliAgentConfigSchema,
  copilotCliConfigSchema,
  type CopilotCliConfig,
} from './copilot-cli.js';

export const agentConfigSchema = z.discriminatedUnion('type', [
  copilotCliAgentConfigSchema,
  claudeCodeAgentConfigSchema,
  codexCliAgentConfigSchema,
]);

export type AgentConfig = z.infer<typeof agentConfigSchema>;
