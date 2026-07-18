/**
 * Agent SDK types — type definitions for the agent SDK.
 */

export interface AgentConfig {
  model?: string;
  provider?: string;
  maxTurns?: number;
  maxToolCalls?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: string[];
  stream?: boolean;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  success: boolean;
}

export interface AgentResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  finishReason: string;
}

export interface StreamEvent {
  type: 'text' | 'thinking' | 'tool_start' | 'tool_end' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: ToolResult;
  error?: string;
}

export interface AgentSession {
  id: string;
  messages: AgentMessage[];
  config: AgentConfig;
  createdAt: number;
  updatedAt: number;
}
