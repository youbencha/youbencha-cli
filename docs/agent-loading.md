How Claude-Code Adapter Loads Agents
The claude-code adapter does NOT copy agent files - it relies on Claude Code's built-in agent discovery system. Here's how it works:
Claude-Code Agent Loading
Command Building (claude-code.ts:298-302):
// Add agent if specified (agent_name maps to --agents flag per research.md)
const agentName = context.config.agent_name as string | undefined;
if (agentName) {
  args.push('--agents', agentName);
}
Resulting Command:
claude -p --output-format text --dangerously-skip-permissions --agents my-agent "prompt"
How Claude Code Finds Agents:
Claude Code has built-in agent discovery that searches for agent files in:
.github/agents/ directory (GitHub Copilot format)
agents/ directory (Claude Code format)
Other configured locations
When you pass --agents my-agent, Claude Code automatically finds and loads the agent definition
No file copying needed - Claude Code reads from the workspace directly
Copilot-CLI Agent Loading
Copilot-CLI requires explicit file copying (agentic-judge.ts:127-142):
//if type == copilot-cli and agentName is specified, copy .github/agents folder to modifiedDir
if (agentType === 'copilot-cli' && context.config.agent_name) {
  console.log('Copying .github/agents to modifiedDir for copilot-cli agent...');
  const fs = await import('fs-extra');
  const sourceAgentsDir = join(process.cwd(), '.github', 'agents');
  const destAgentsDir = join(context.modifiedDir, '.github', 'agents');
  try {
    await fs.default.copy(sourceAgentsDir, destAgentsDir);
    console.log('Copied .github/agents successfully');
  } catch (error) {
    console.error('Failed to copy .github/agents:', error);
  }
}
Why the difference?
Copilot-CLI: Doesn't automatically discover agents in parent directories, so youBencha must copy .github/agents/ to the isolated workspace
Claude-Code: Has built-in agent discovery that searches the workspace hierarchy, so no copying needed
Key Differences Summary
Aspect	Copilot-CLI	Claude-Code
Agent Discovery	Manual - needs files in workspace	Built-in - searches workspace hierarchy
File Copying	✅ Required (done by agentic-judge)	❌ Not needed
Flag Name	--agent <name>	--agents <name> (note the 's')
When Copying Happens	Before agent execution (in agentic-judge evaluator)	N/A
Where Copied From	process.cwd()/.github/agents	N/A
Where Copied To	workspaceDir/.github/agents	N/A
Example Agent Definition
Both adapters use the same agent file format (e.g., .github/agents/agentic-judge.md):
# Agentic Judge Agent

You are an expert code evaluator...
[agent instructions here]
In Practice
For Copilot-CLI:
User specifies agent_name: my-agent in config
Agentic-judge checks if agent_name is set AND type is copilot-cli
Copies .github/agents/ to workspace
Copilot adapter runs: copilot -p "prompt" --agent my-agent
For Claude-Code:
User specifies agent_name: my-agent in config
No file copying (Claude Code handles discovery)
Claude-Code adapter runs: claude -p --agents my-agent "prompt"
Claude Code finds the agent file automatically
The key insight: Claude Code's built-in agent discovery is more sophisticated, eliminating the need for manual file copying that Copilot-CLI requires.