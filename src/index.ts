import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import { createClient } from '@supabase/supabase-js';

// Import Exa
import Exa from 'exa-js';

// Import Scrape (extensionless to satisfy TS import rules)
import { fetchAndCombineJsonFiles } from './scrape';

export interface Env {
  EXA_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const app = new OpenAPIHono<{ Bindings: Env }>()
app.use('/api/*', cors({ origin: '*' }));

// Use the middleware to serve Swagger UI at /ui
app.get('/ui', swaggerUI({ url: '/doc' }));

// Define the OpenAPI spec
app.doc('/doc', {
	info: {
		title: 'Adjacent News API',
		version: 'v1',
	},
	openapi: '3.1.0',
	servers: [
		{
			url: 'https://api.data.adj.news',
			description: 'Production API server'
		}
	]
})

// redirect to ui
app.get("/", c => c.redirect('/ui'));

// --- Self-hosted docs proxy (experimental) ---
// Proxies the Mintlify docs site and removes the "Powered by Mintlify" link via HTMLRewriter.
// This is intended only for local/self-hosted preview. Use at your own discretion.
const DOCS_ORIGIN = 'https://docs.adj.news';

app.get('/docs', c => c.redirect('/docs/'));
app.get('/docs/*', async (c) => {
  const url = new URL(c.req.url);
  const upstreamPath = url.pathname.replace(/^\/docs/, '') || '/';
  const upstreamUrl = new URL(DOCS_ORIGIN + upstreamPath + url.search);

  const upstreamReqHeaders: Record<string, string> = {};
  // Forward basic headers for consistency
  const ua = c.req.header('user-agent');
  if (ua) upstreamReqHeaders['user-agent'] = ua;
  const accept = c.req.header('accept');
  if (accept) upstreamReqHeaders['accept'] = accept;

  const upstreamRes = await fetch(upstreamUrl, { headers: upstreamReqHeaders });
  const contentType = upstreamRes.headers.get('content-type') || '';

  // Only rewrite HTML responses; pass through assets untouched
  if (!contentType.includes('text/html')) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  }

  const rewriter = new HTMLRewriter()
    // Hide Mintlify branding via CSS to avoid React hydration mismatches
    .on('head', {
      element(el) {
        el.append('<style>a[href*="mintlify"]{display:none!important}</style>', { html: true });
      }
    })
    // Only rewrite site navigation links to stay under /docs prefix
    .on('a', {
      element(el) {
        const href = el.getAttribute('href');
        if (href && href.startsWith('/') && !href.startsWith('/docs')) {
          el.setAttribute('href', '/docs' + href);
        }
      }
    });

  return rewriter.transform(upstreamRes);
});

// Passthrough for Next.js static assets requested without the /docs prefix.
// Mintlify may use an asset prefix like /mintlify-assets/_next; we proxy both.
app.get('/_next/*', async (c) => {
  const url = new URL(c.req.url);
  const upstreamUrl = new URL(DOCS_ORIGIN + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      // Forward minimal headers for better compatibility
      'user-agent': c.req.header('user-agent') || '',
      'accept': c.req.header('accept') || '*/*',
    }
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

app.get('/mintlify-assets/*', async (c) => {
  const url = new URL(c.req.url);
  const upstreamUrl = new URL(DOCS_ORIGIN + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      'accept': c.req.header('accept') || '*/*',
    }
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// Generic passthroughs for other common asset roots used by the docs site
app.get('/static/*', async (c) => {
  const url = new URL(c.req.url);
  const upstreamUrl = new URL(DOCS_ORIGIN + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      'accept': c.req.header('accept') || '*/*',
    }
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

app.get('/images/*', async (c) => {
  const url = new URL(c.req.url);
  const upstreamUrl = new URL(DOCS_ORIGIN + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      'accept': c.req.header('accept') || '*/*',
    }
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// 404 for everything else
app.notFound(c => c.text('Not found', 404));

// --- Define the OpenAPI Schema ---
const NewsSchema = z.object({
  market: z.string().openapi({
    example: 'Will the winner of the 2024 USA presidential election win Pennsylvania?',
  })
})

const AllMarketsSchema = z.object({
  index: z.string().openapi({
    example: '101'
  })
})
const MarketsByHeadline = z.object({
	headline: z.string().openapi({
		example: 'Will the winner of the 2024 USA presidential election win Pennsylvania?'
	})
})

// --- Define the OpenAPI Route ---
const newsRoute = createRoute({
  method: 'get',
  path: '/api/news/{market}',
  description: 'Get news articles for the given market',
  request: {
    params: NewsSchema,
  },
  responses: {
    200: {
      description: 'News articles for the given market',
      content: {
        'application/json': {
          // Exa search returns a complex object; relax schema for now.
          schema: z.any()
        }
      }
    }
  }
});

const allMarketsRoute = createRoute({
  method: 'get',
  path: '/api/markets/{index}',
  description: 'Get all markets, returns 100 at a time.',
  request: {
    params: AllMarketsSchema,
  },
  responses: {
    200: {
      description: 'Get All Markets',
      content: {
        'application/json': {
          // Returns an array of markets; relax schema for now.
          schema: z.any()
        }
      }
    }
  }
});

const marketsByHeadlineRoute = createRoute({
  method: 'get',
  path: '/api/markets/headline/{headline}',
  description: 'Get related markets by headline',
  request: {
    params: MarketsByHeadline,
  },
  responses: {
    200: {
      description: 'Get related markets by headline',
      content: {
        'application/json': {
          schema: z.any()
        }
      }
    }
  }
});

// --- Consume the OpenAPI Routes ---
app.openapi(newsRoute, async (c) => {
  const exa = new Exa(c.env.EXA_API_KEY);

	// Retrieve the validated search parameters
	const { market } = c.req.param();

	// Get the current date and the date one week ago
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - 7);

	// Fetch news for the given market
  const results = await exa.search(market, {
		type: "neural",
		useAutoprompt: true,
		numResults: 10,
		//   text: {
		// 	includeHtmlTags: true
		//   }// use to enable text content
		category: "news",
		startCrawlDate: startDate.toISOString(),
		endCrawlDate: endDate.toISOString(),
		startPublishedDate: startDate.toISOString(),
		endPublishedDate: endDate.toISOString(),
		excludeDomains: ["kalshi.com", "metaculus.com", "manifold.markets", "polymarket.com"]
  }).catch((error) => {
    c.status(500);
    return ["An error occurred while fetching news articles. Please try again later."];
  });

	// Return the results
	return c.json(results);
});

app.openapi(allMarketsRoute, async (c) => {
  const { index } = c.req.param();
  let number: number;
  if (!index) {
    number = 0;
  } else {
    number = parseInt(index);
  };

	const markets = await fetchAndCombineJsonFiles();
	const slicedMarkets = markets?.slice(number, number + 100);

  return c.json(slicedMarkets);
});

function formatMarketTitle(title: string) {
  return title
    .replace(/-/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (l: string) => l.toUpperCase());
}

async function useRelatedMarkets(embedding: { embedding: number[] }, env: Env) {
  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY
  );

  const { data: documents, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding.embedding, // pass the query embedding
    match_threshold: 0.803, // choose an appropriate threshold for your data
    match_count: 3, // choose the number of matches
  });

  if (error) {
    console.error(error);
    return [];
  }

  return documents as any[];
}

// Normalize various possible embedding response shapes into the expected type.
function normalizeEmbedding(input: unknown): { embedding: number[] } | null {
  // Case 1: direct array of numbers
  if (Array.isArray(input) && input.every((n) => typeof n === 'number')) {
    return { embedding: input as number[] };
  }
  // Case 2: object with { embedding: number[] }
  if (input && typeof input === 'object') {
    const maybe = (input as any).embedding;
    if (Array.isArray(maybe) && maybe.every((n: unknown) => typeof n === 'number')) {
      return { embedding: maybe as number[] };
    }
  }
  return null;
}

app.openapi(marketsByHeadlineRoute, async (c) => {
	const { headline } = c.req.param();

	// Define the URL and headers for the Supabase function call
	const url = 'https://fyeyeurwgxklumxgpcgz.supabase.co/functions/v1/embed';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${c.env.SUPABASE_ANON_KEY}`
  };

	try {
		// Make the POST request to the Supabase function
		const response = await fetch(url, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify({ input: headline }),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		// Extract the embedding from the response
		const embeddingJson: unknown = await response.json();

		const normalized = normalizeEmbedding(embeddingJson);
		if (!normalized) {
			console.error('Invalid embedding response shape:', embeddingJson);
			return c.json("Invalid embedding response from provider.");
		}

		// Use the embedding with the related markets function
    let markets = await useRelatedMarkets(normalized, c.env);
    markets = markets.map((market: any) => {
      const { question_embedding, ...rest } = market;
      return rest;
    });

		return c.json(markets?.length > 0 ? markets : "No related markets. Explore at https://data.adj.news");
	} catch (error) {
		console.error('Error fetching embedding:', error);
		return c.json("Error processing your request. Please try again later.");
	}
});

export default app;