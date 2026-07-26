/**
 * Tools API — tool registration, discovery, and invocation.
 */

export interface ToolApiDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns: Record<string, unknown>;
  category: string;
  tags: string[];
  examples?: Array<{ input: string; output: string }>;
}

export interface ToolApiRegistry {
  tools: Map<string, ToolApiDefinition>;
  register(tool: ToolApiDefinition): void;
  unregister(name: string): boolean;
  get(name: string): ToolApiDefinition | undefined;
  list(): ToolApiDefinition[];
  search(query: string): ToolApiDefinition[];
  byCategory(category: string): ToolApiDefinition[];
}

/**
 * Create a tool API registry.
 */
export function createToolApiRegistry(): ToolApiRegistry {
  const tools = new Map<string, ToolApiDefinition>();

  return {
    tools,

    register(tool) {
      tools.set(tool.name, tool);
    },

    unregister(name) {
      return tools.delete(name);
    },

    get(name) {
      return tools.get(name);
    },

    list() {
      return [...tools.values()];
    },

    search(query) {
      const q = query.toLowerCase();
      return [...tools.values()].filter(
        t => t.name.toLowerCase().includes(q) ||
             t.description.toLowerCase().includes(q) ||
             t.tags.some(tag => tag.toLowerCase().includes(q)),
      );
    },

    byCategory(category) {
      return [...tools.values()].filter(t => t.category === category);
    },
  };
}

/**
 * Generate OpenAPI spec from registered tools.
 */
export function generateOpenApiSpec(registry: ToolApiRegistry): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const tool of registry.list()) {
    paths[`/tools/${tool.name}`] = {
      post: {
        summary: tool.description,
        requestBody: {
          content: {
            'application/json': {
              schema: tool.parameters,
            },
          },
        },
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: tool.returns,
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: { title: 'Kairo Tools API', version: '0.3.0' },
    paths,
  };
}
