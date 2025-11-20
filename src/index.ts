import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

export interface Env {
  EXA_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DOCS_ORIGIN?: string;
  DATA_ORIGIN?: string;
}

const app = new OpenAPIHono<{ Bindings: Env }>();
app.use('/api/*', cors({ origin: '*' }));
// Allow docs internal calls under /_mintlify/*
app.use('/_mintlify/*', cors({ origin: '*' }));
// Enable CORS for Mintlify "Try it" requests that hit relative /markets/* paths
app.use('/markets/*', cors({ origin: '*' }));
// Enable CORS for top-level API routes proxied to DATA_ORIGIN
app.use('/user', cors({ origin: '*' }));
app.use('/calldata', cors({ origin: '*' }));
app.use('/market', cors({ origin: '*' }));
// Enable CORS for Socket.IO long-polling endpoints
app.use('/socket.io/*', cors({ origin: '*' }));

// Use the middleware to serve Swagger UI at /ui
app.get('/ui', swaggerUI({ url: '/doc' }));

// Define the OpenAPI spec
app.doc('/doc', {
  info: {
    title: 'Open Odds API',
    version: 'v1',
  },
  openapi: '3.1.0',
  servers: [
    {
      url: 'https://open-odds-api.tadle.com',
      description: 'Production API server',
    },
  ],
});

// Root serves the Mintlify docs homepage instead of redirecting to /ui
app.get('/', async (c) => {
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + '/');

  const upstreamReqHeaders: Record<string, string> = {};
  const ua = c.req.header('user-agent');
  if (ua) upstreamReqHeaders['user-agent'] = ua;
  const accept = c.req.header('accept');
  if (accept) upstreamReqHeaders['accept'] = accept;

  const upstreamRes = await fetch(upstreamUrl, { headers: upstreamReqHeaders });
  const contentType = upstreamRes.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  }

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append('<style>a[href*="mintlify"]{display:none!important}</style>', { html: true });
      },
    });

  return rewriter.transform(upstreamRes);
});

// --- Self-hosted docs proxy (experimental) ---
// Proxies the Mintlify docs site. Origin configurable via environment.
const DOCS_ORIGIN_DEFAULT = 'https://open-odds-docs.tadle.com';
// Remote data source for wildcard API proxy (if used elsewhere)
const DATA_ORIGIN_DEFAULT = 'https://open-odds-api.tadle.com';

// (moved below) Catch-all page proxy for docs under root

// Passthrough for Next.js static assets requested without the /docs prefix.
// Mintlify may use an asset prefix like /mintlify-assets/_next; we proxy both.
app.get('/_next/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      // Forward minimal headers for better compatibility
      'user-agent': c.req.header('user-agent') || '',
      accept: c.req.header('accept') || '*/*',
    },
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

app.get('/mintlify-assets/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      accept: c.req.header('accept') || '*/*',
    },
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// Generic passthroughs for other common asset roots used by the docs site
app.get('/static/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      accept: c.req.header('accept') || '*/*',
    },
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

app.get('/images/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      'user-agent': c.req.header('user-agent') || '',
      accept: c.req.header('accept') || '*/*',
    },
  });
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// Socket.IO passthrough (supports GET/POST for polling; websocket stays remote)
app.all('/socket.io/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);

  const method = c.req.method;
  const headers = new Headers();
  // Pass through minimal, safe headers (avoid forwarding local Host)
  const ua = c.req.header('user-agent');
  if (ua) headers.set('user-agent', ua);
  const accept = c.req.header('accept');
  if (accept) headers.set('accept', accept);
  const contentType = c.req.header('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cookie = c.req.header('cookie');
  if (cookie) headers.set('cookie', cookie);

  const body = ['GET', 'HEAD'].includes(method) ? undefined : await c.req.text();
  const upstreamRes = await fetch(upstreamUrl.toString(), { method, headers, body, redirect: 'follow' });
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: upstreamRes.headers });
});

// (moved below) Generic proxy for other Mintlify endpoints

// --- API passthrough for relative market endpoints used by docs site ---
// When the docs UI issues requests to "/markets/..." relative to our proxy origin,
// forward them to the configured DATA_ORIGIN (defaults to open-odds API).
app.all('/markets/*', async (c) => {
  const url = new URL(c.req.url);
  const dataOrigin = c.env.DATA_ORIGIN ?? DATA_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(dataOrigin + url.pathname + url.search);

  // Clone the incoming request but target the upstream URL
  const upstreamReq = new Request(upstreamUrl.toString(), c.req.raw);
  const upstreamRes = await fetch(upstreamReq);

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// Direct proxies for common top-level endpoints
app.all('/user', async (c) => {
  const url = new URL(c.req.url);
  const dataOrigin = c.env.DATA_ORIGIN ?? DATA_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(dataOrigin + url.pathname + url.search);
  const upstreamReq = new Request(upstreamUrl.toString(), c.req.raw);
  const upstreamRes = await fetch(upstreamReq);
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: upstreamRes.headers });
});

app.all('/calldata', async (c) => {
  const url = new URL(c.req.url);
  const dataOrigin = c.env.DATA_ORIGIN ?? DATA_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(dataOrigin + url.pathname + url.search);
  const upstreamReq = new Request(upstreamUrl.toString(), c.req.raw);
  const upstreamRes = await fetch(upstreamReq);
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: upstreamRes.headers });
});

app.all('/market', async (c) => {
  const url = new URL(c.req.url);
  const dataOrigin = c.env.DATA_ORIGIN ?? DATA_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(dataOrigin + url.pathname + url.search);
  const upstreamReq = new Request(upstreamUrl.toString(), c.req.raw);
  const upstreamRes = await fetch(upstreamReq);
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: upstreamRes.headers });
});

// --- Local implementation of Mintlify "request" proxy ---
// This mirrors the behavior expected by the docs Try widget.
// Body shape: { method: string, url: string, header?: Record<string,string>, query?: Record<string,unknown>, body?: unknown }
app.post('/_mintlify/api/request', async (c) => {
  try {
    const payload = await c.req.json<{ method: string; url: string; header?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }>();
    const method = (payload.method || 'GET').toUpperCase();
    const targetUrl = new URL(payload.url);

    // Restrict calls to the configured DATA_ORIGIN for safety
    const allowedOrigin = (c.env.DATA_ORIGIN ?? DATA_ORIGIN_DEFAULT).replace(/\/$/, '');
    if (targetUrl.origin !== allowedOrigin) {
      return c.json({ error: 'origin_not_allowed', allowed: allowedOrigin, requested: targetUrl.origin }, 400);
    }

    // Append query params if provided
    if (payload.query && typeof payload.query === 'object') {
      for (const [k, v] of Object.entries(payload.query)) {
        if (v !== undefined && v !== null) {
          targetUrl.searchParams.set(k, String(v));
        }
      }
    }

    const headers = new Headers();
    if (payload.header && typeof payload.header === 'object') {
      for (const [k, v] of Object.entries(payload.header)) {
        if (k.toLowerCase() !== 'host') headers.set(k, v);
      }
    }
    // Default Accept for JSON APIs
    if (!headers.has('accept')) headers.set('accept', 'application/json, */*');

    const hasBody = !['GET', 'HEAD'].includes(method);
    const body = hasBody
      ? typeof payload.body === 'string'
        ? payload.body
        : payload.body !== undefined
        ? JSON.stringify(payload.body)
        : undefined
      : undefined;

    const upstreamRes = await fetch(targetUrl.toString(), { method, headers, body, redirect: 'follow' });
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers: upstreamRes.headers });
  } catch (err) {
    return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
  }
});

// Fallback: proxy other Mintlify endpoints to the docs origin
app.all('/_mintlify/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);
  const upstreamReq = new Request(upstreamUrl.toString(), c.req.raw);
  const upstreamRes = await fetch(upstreamReq);
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
});

// Catch-all page proxy for docs under root (placed at the end for safety)
app.get('/*', async (c) => {
  const url = new URL(c.req.url);
  const docsOrigin = c.env.DOCS_ORIGIN ?? DOCS_ORIGIN_DEFAULT;
  const upstreamUrl = new URL(docsOrigin + url.pathname + url.search);

  const upstreamReqHeaders: Record<string, string> = {};
  const ua = c.req.header('user-agent');
  if (ua) upstreamReqHeaders['user-agent'] = ua;
  const accept = c.req.header('accept');
  if (accept) upstreamReqHeaders['accept'] = accept;

  const upstreamRes = await fetch(upstreamUrl, { headers: upstreamReqHeaders });
  const contentType = upstreamRes.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: upstreamRes.headers,
    });
  }

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append('<style>a[href*="mintlify"]{display:none!important}</style>', { html: true });
      },
    });

  return rewriter.transform(upstreamRes);
});

// 404 for everything else
app.notFound((c) => c.text('Not found', 404));

export default app;
