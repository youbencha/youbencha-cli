import { z } from 'zod';
import { claudeCodeAgentConfigSchema } from './claude-code.js';
import { copilotCliAgentConfigSchema } from './copilot-cli.js';

export {
  claudeCodeAgentConfigSchema,
  claudeCodeConfigSchema,
  type ClaudeCodeConfig,
} from './claude-code.js';
export {
  copilotCliAgentConfigSchema,
  copilotCliConfigSchema,
  type CopilotCliConfig,
} from './copilot-cli.js';

export const agentConfigSchema = z.discriminatedUnion('type', [
  copilotCliAgentConfigSchema,
  claudeCodeAgentConfigSchema,
]);

export type AgentConfig = z.infer<typeof agentConfigSchema>;
