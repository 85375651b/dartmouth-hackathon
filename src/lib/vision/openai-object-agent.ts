/** Compatibility alias: this now calls Claude and accepts an Anthropic key.
 * New callers should import createClaudeObjectAgent directly.
 */
export { createClaudeObjectAgent as createOpenAIObjectAgent } from './claude-object-agent.ts';
