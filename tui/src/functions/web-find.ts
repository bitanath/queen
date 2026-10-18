import { tool, type JSONSchema } from "@strands-agents/sdk";

const UA = "Mozilla/5.0 (compatible; queen/1.0; +https://github.com/bitanath/queen)";

type Hit = { title: string; url: string; snippet: string };

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUrl(href: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

async function duckDuckGo(query: string, limit: number): Promise<Hit[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  }); //HACK: Duck duck go please dont gooooo
  if (!res.ok) return [];
  const html = await res.text();
  const hits: Hit[] = [];
  const linkRe = /<a\b[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null && hits.length < limit) {
    hits.push({ url: decodeUrl(m[1] ?? ""), title: stripTags(m[2] ?? ""), snippet: "" });
  }
  
  const snippets = [...html.matchAll(/<td\b[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)].map((s) =>
    stripTags(s[1] ?? ""),
  );
  hits.forEach((hit, i) => {
    hit.snippet = snippets[i] ?? "";
  });
  return hits.filter((hit) => hit.title.length > 0 && hit.url.startsWith("http"));
}

async function wikipedia(query: string, limit: number): Promise<Hit[]> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=${limit}&search=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length < 4) return [];
  const titles = data[1] as string[];
  const descriptions = data[2] as string[];
  const urls = data[3] as string[];
  return titles
    .map((title, i) => ({ title, url: urls[i] ?? "", snippet: descriptions[i] ?? "" }))
    .filter((hit) => hit.url.startsWith("http"));
}

function render(query: string, hits: Hit[]): string {
  if (hits.length === 0) return `No results for ${JSON.stringify(query)}.`;
  return hits
    .map((hit, i) => `${i + 1}. [${hit.title}](${hit.url})${hit.snippet ? `\n   ${hit.snippet}` : ""}`)
    .join("\n");
}

export const webSearch = tool({
  name: "web_search",
  description: "Anonymous web search (no API key). Returns titles, URLs and snippets.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      limit: { type: "number", description: "Max results (default 5)." },
    },
    required: ["query"],
  } as JSONSchema,
  callback: async (raw: unknown) => {
    const input = (raw ?? {}) as { query?: unknown; limit?: unknown };
    const query = String(input.query ?? "").trim();
    if (!query) throw new Error("web_search: query is required");
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 10) : 5;
    try {
      const hits = await duckDuckGo(query, limit);
      if (hits.length > 0) return render(query, hits);
    } catch {
      console.error("idk what to do here (search)")
    }
    return render(query, await wikipedia(query, limit));
  },
});
