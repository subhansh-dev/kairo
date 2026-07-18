/**
 * Proxy adapters — provider-specific proxy adapters.
 */

export interface ProxyAdapter {
  name: string;
  transformRequest(req: Request): Request;
  transformResponse(res: Response): Response;
  handleError(err: Error): Error;
}

/**
 * Create a base proxy adapter.
 */
export function createBaseAdapter(name: string): ProxyAdapter {
  return {
    name,
    transformRequest: (req: Request) => req,
    transformResponse: (res: Response) => res,
    handleError: (err: Error) => err,
  };
}

/**
 * Create an NVIDIA adapter.
 */
export function createNvidiaAdapter(): ProxyAdapter {
  return {
    ...createBaseAdapter('nvidia'),
    transformRequest: (req: Request) => {
      // NVIDIA-specific request transformations
      return req;
    },
  };
}

/**
 * Create a Groq adapter.
 */
export function createGroqAdapter(): ProxyAdapter {
  return {
    ...createBaseAdapter('groq'),
    transformRequest: (req: Request) => {
      // Groq-specific request transformations
      return req;
    },
  };
}

/**
 * Get an adapter for a provider.
 */
export function getAdapter(provider: string): ProxyAdapter {
  const adapters: Record<string, () => ProxyAdapter> = {
    nvidia: createNvidiaAdapter,
    groq: createGroqAdapter,
  };
  return (adapters[provider] || (() => createBaseAdapter(provider)))();
}
