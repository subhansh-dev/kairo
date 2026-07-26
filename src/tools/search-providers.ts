/**
 * Kairo — Search Providers
 * Multi-provider search with fallback chain
 */

// ─── Types ───────────────────────────────────────────────────────

export interface SearchHit {
  title: string
  url: string
  description?: string
  source?: string
}

export interface SearchInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export interface ProviderOutput {
  hits: SearchHit[]
  providerName: string
  durationSeconds: number
}

export interface SearchProvider {
  readonly name: string
  isConfigured(): boolean
  search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput>
}

// ─── Helpers ─────────────────────────────────────────────────────

export function safeHostname(url: string | undefined): string | undefined {
  if (!url) return undefined
  try { return new URL(url).hostname } catch { return undefined }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  if (host === domain) return true
  return host.endsWith('.' + domain)
}

export function applyDomainFilters(hits: SearchHit[], input: SearchInput): SearchHit[] {
  let out = hits
  if (input.blocked_domains?.length) {
    out = out.filter(h => {
      const host = safeHostname(h.url)
      if (!host) return true
      return !input.blocked_domains!.some(d => hostMatchesDomain(host, d))
    })
  }
  if (input.allowed_domains?.length) {
    out = out.filter(h => {
      const host = safeHostname(h.url)
      if (!host) return false
      return input.allowed_domains!.some(d => hostMatchesDomain(host, d))
    })
  }
  return out
}

// ─── DuckDuckGo Provider ─────────────────────────────────────────

const duckduckgoProvider: SearchProvider = {
  name: 'duckduckgo',

  isConfigured() { return true }, // Always available

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const hits = await searchDuckDuckGo(input.query, signal)
    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'duckduckgo',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  // Try the Instant Answer API first (fast but limited).
  const apiResults = await searchDuckDuckGoApi(query, signal);
  if (apiResults.length > 0) return apiResults;

  // Fallback: scrape DuckDuckGo HTML search results.
  return searchDuckDuckGoHtml(query, signal);
}

async function searchDuckDuckGoApi(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Kairo/0.4.0' },
      signal: signal ?? AbortSignal.timeout(8000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as any
    const results: SearchHit[] = []

    if (data.AbstractText) {
      results.push({ title: data.AbstractSource || 'Abstract', url: data.AbstractURL || '', description: data.AbstractText })
    }
    if (data.Results && Array.isArray(data.Results)) {
      for (const r of data.Results) {
        if (r.Text && r.FirstURL) results.push({ title: r.Text.split(' - ')[0] || r.Text, url: r.FirstURL, description: r.Text })
      }
    }
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const r of data.RelatedTopics) {
        if (r.Text && r.FirstURL) results.push({ title: r.Text.split(' - ')[0] || r.Text, url: r.FirstURL, description: r.Text })
        // Also handle nested topics
        if (r.Topics && Array.isArray(r.Topics)) {
          for (const t of r.Topics) {
            if (t.Text && t.FirstURL) results.push({ title: t.Text.split(' - ')[0] || t.Text, url: t.FirstURL, description: t.Text })
          }
        }
      }
    }
    return results.slice(0, 10)
  } catch {
    return []
  }
}

async function searchDuckDuckGoHtml(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: signal ?? AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const html = await resp.text()
    const results: SearchHit[] = []

    // Parse result links from DuckDuckGo HTML.
    // Results look like: <a class="result__a" href="...">Title</a>
    // with <a class="result__snippet" ...>Description</a>
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</g
    const snippetRegex = /class="result__snippet"[^>]*>([^<]*)</g

    const links: Array<{ url: string; title: string }> = []
    let match: RegExpExecArray | null
    while ((match = linkRegex.exec(html)) !== null) {
      let linkUrl = match[1]
      // DuckDuckGo wraps URLs in a redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
      const uddgMatch = linkUrl.match(/uddg=([^&]+)/)
      if (uddgMatch) {
        linkUrl = decodeURIComponent(uddgMatch[1])
      }
      links.push({ url: linkUrl, title: match[2].trim() })
    }

    const snippets: string[] = []
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].trim())
    }

    for (let i = 0; i < Math.min(links.length, 10); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        description: snippets[i] || '',
      })
    }

    return results
  } catch {
    return []
  }
}

// ─── Brave Provider ──────────────────────────────────────────────

const braveProvider: SearchProvider = {
  name: 'brave',

  isConfigured() { return Boolean(process.env.BRAVE_API_KEY) },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', input.query)
    url.searchParams.set('count', '15')

    const res = await fetch(url.toString(), {
      headers: {
        'X-Subscription-Token': process.env.BRAVE_API_KEY!,
        'Accept': 'application/json',
      },
      signal,
    })

    if (!res.ok) throw new Error(`Brave search error ${res.status}: ${await res.text().catch(() => '')}`)
    const data = await res.json() as any
    const hits = (data.web?.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description,
      source: r.url ? safeHostname(r.url) : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'brave',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}

// ─── Tavily Provider ─────────────────────────────────────────────

const tavilyProvider: SearchProvider = {
  name: 'tavily',

  isConfigured() { return Boolean(process.env.TAVILY_API_KEY) },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({ query: input.query, max_results: 15, include_answer: false }),
      signal,
    })

    if (!res.ok) throw new Error(`Tavily search error ${res.status}: ${await res.text().catch(() => '')}`)
    const data = await res.json() as any
    const hits = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.content ?? r.snippet,
      source: r.url ? safeHostname(r.url) : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'tavily',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}

// ─── Exa Provider ────────────────────────────────────────────────

const exaProvider: SearchProvider = {
  name: 'exa',

  isConfigured() { return Boolean(process.env.EXA_API_KEY) },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXA_API_KEY!,
      },
      body: JSON.stringify({ query: input.query, numResults: 15, type: 'neural' }),
      signal,
    })

    if (!res.ok) throw new Error(`Exa search error ${res.status}: ${await res.text().catch(() => '')}`)
    const data = await res.json() as any
    const hits = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.text ?? r.highlight,
      source: r.url ? safeHostname(r.url) : undefined,
    }))

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'exa',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}

// ─── Provider Chain ──────────────────────────────────────────────

const ALL_PROVIDERS: SearchProvider[] = [
  braveProvider,
  tavilyProvider,
  exaProvider,
  duckduckgoProvider, // Fallback — always last
]

/**
 * Search with automatic provider fallback.
 * Tries configured providers in order, falls back to DuckDuckGo.
 */
export async function searchWithFallback(
  input: SearchInput,
  signal?: AbortSignal,
): Promise<ProviderOutput> {
  const errors: string[] = []

  for (const provider of ALL_PROVIDERS) {
    if (!provider.isConfigured()) continue
    try {
      const result = await provider.search(input, signal)
      if (result.hits.length > 0) return result
    } catch (e: any) {
      errors.push(`${provider.name}: ${e.message}`)
    }
  }

  // All failed or returned empty
  return {
    hits: [],
    providerName: 'none',
    durationSeconds: 0,
  }
}

/**
 * Get list of configured provider names
 */
export function getConfiguredProviders(): string[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured()).map(p => p.name)
}
