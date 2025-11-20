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

  return transformDocsHtml(upstreamRes, docsOrigin);
});

// --- Self-hosted docs proxy (experimental) ---
// Proxies the Mintlify docs site. Origin configurable via environment.
const DOCS_ORIGIN_DEFAULT = 'https://open-odds-docs.tadle.com';
// Remote data source for wildcard API proxy (if used elsewhere)
const DATA_ORIGIN_DEFAULT = 'https://open-odds-api.tadle.com';

// Site name used to replace Mintlify branding within HTML head
const SITE_NAME = 'Open Odds Open API';

// Inline JPG (base64) served by the Worker for og/twitter images
const LOGO_JPG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD//gAfQ29tcHJlc3NlZCBieSBqcGVnLXJlY29tcHJlc3P/2wCEAAICAgICAgICAgIDAwMDAwQEBAQEBAcFBQUFBQcKBgcGBgcGCgkLCQgJCwkQDQsLDRATEA8QExcUFBcdGx0lJTIBAgICAgICAgICAgMDAwMDBAQEBAQEBwUFBQUFBwoGBwYGBwYKCQsJCAkLCRANCwsNEBMQDxATFxQUFx0bHSUlMv/CABEIABoAYgMBIgACEQEDEQH/xAAeAAACAgICAwAAAAAAAAAAAAAICQYHAAIFCgEDBP/aAAgBAQAAAACwRmOYzyczRVF2F7MfV9GKPZOnbxa0qouWs9RHJp69ZR/DaD/fTAV88uXqgCiLU61H3N12caCr49RJPES6D7eH/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAhAAAAAAA//EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMQAAAAAAP/xABEEAAABQIEAgQGDQ0AAAAAAAABAgMEBQYHAAgREgkTECExtBQVGEFXdRYiJDIzNzg5UXaUldIXGUJVWGRyd5KxxNHT/9oACAEBAAE/AMzmbimanva1BgFwV4OiHx2qKELJlZRsqsipqsqsBSCdRM5i7O3rIGEbz1/XJ29pLWzdwfZLXtUMhdyM3OmOuJd48ps2BAqYIIiocVFjB5ihhPh3ZhB+EzdS4fwmfm/ysZZbREsTSkxF1Vd5StJuUfAs4kXr85iJoJhtSQQTXVV2AHWJh84jhs/Yvd4snqC4E03cpQp9NezXaOHDpqzT5rtwkgTUA3KHAhdR82o48fwX66YfaSf7xTNVTDzim1dDI1G9XhgigMm0K8Odn1QaBtSpgOztxmRz2WmoS3NctbcVyxlq4TFWLZM0SKbmrswikddTeQC6IdZsWncrOLVWzcOFTqrK0nDKKKHMJjGOZqmImMI9ojhWah0FDoryzNNQg6GKdchTAP0CAjgk7Ba6FmWHX+8E1/v05jvnLst/qmC728xeyUpmPttUjKq7kN6EZS7c0YE2qukgZudyAlEETLCBQVMUDbfOHbjyQsjf7ZLH7xjsZRgibNZ507W2puO2q6jKjjHSCz9BQiibkiMeeRJqKI7OciqmJNccRQaguRfnLtl6JMeAQc8sxWOIE10dyDwzDnnD9PlEL7TH5pe1/pUqn7O2xlvtNF2O4jLy1kNKupJnCRDoE3TkpSrKeFRSbs24CfQKuOI1ltsray10bcWg6L8V1FNV8gi+eeMXjjnJu2ztyqHKcLHIXcomA9RcUnMOacy5UzUDEiZnEZbdm9SKoGpBUQjiqlA2mnVqGMvlkrRZh4+ubjX5zFR9KTrqo1gBB3JMWzp0ZQhXCzs4PDgIkOZXQumL75UctdvbXVJWVt8zkNU07GeCnQiQlo5dR0RRYiRypEanE4nKU27FI5/L9RlKUxGitDuxaRLJAXDloKi63LSKTmKn3dZzdph6Mx3zl2W/1TBd7eY4prt0tWlgYOpH0g1opZV0q+O3T3FKpzk011SeY6yaI+0DAWm4WHpIJ99vPwYtxOZdLOZ8qSnaArBsjbeMZOxCUXcKrpEVcxCyRwE5w3dax9uM71WQsBm0ym3aeORPSiTSDfhJokFVBVu3khcqHSMHv9qahT48tPKz6a6f/qV/Bi1lZ0tcLii1FV9FzTeXhZCIP4M8Q+CVBGFRRPpr9ByCGOJTfS0dwbQQtD0VXUbLTsVX7ZV4xQE/NQI2aPEFRNqUPenOBcW3vRa259jDW1oCs2M5VDS1YlWi2gHM4IZFiRscNBL2gocC4yrULk7qyk6m8oys31P1EzmdrUgPDtUlGJ0i7dNEz6nKoB92PyLcLr0yuvvhT/hiEyF5aZGEh5CEUqJzHumLddmuWTASqt1CAZM4ap9hi9GY75y7Lf6pgu9vMcUNq1Wy0oOVmyR1W9XRYonMQBMmJyKlMJB6bw+7+GhlykX/ALpdNquXbIrre3VTRA78gJEObrAmhChp0cNj5VlKep5ruxsXX+NK5X1qme9HxwqflGVR/L+S76zxmnaNWOY+9zRk2SboJ1lLARJIgEIXVYw9RS9FkfiXtD9SoDuaeP/EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQIBAT8Ab//EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQMBAT8Ab//Z';

// Unified HTML rewrite to remove Mintlify branding and links in <head>
function transformDocsHtml(upstreamRes: Response, docsOrigin: string) {
  const rewriter = new HTMLRewriter()
    // Inject CSS to hide Mintlify branding anchors to avoid hydration mismatch
    .on('head', {
      element(el) {
        // Use CSS escapes so page source does not literally contain "mintlify"
        // \74 is the hex escape for the character 't'
        el.append('<style>a[href*="min\\74lify"], [id*="min\\74lify"], [class*="min\\74lify"], [aria-label*="Min\\74lify"]{display:none!important}</style>', { html: true });
      },
    })
    // Keep navigation within /docs prefix when linking to root-relative paths
    .on('a', {
      element(el) {
        const href = el.getAttribute('href') || '';
        if (/mintlify/i.test(href)) {
          el.remove();
        }
      },
    })
    // Clean meta tags that expose Mintlify branding and enforce og/twitter images
    .on('head meta', {
      element(el) {
        const name = (el.getAttribute('name') || '').toLowerCase();
        const property = (el.getAttribute('property') || '').toLowerCase();
        const content = el.getAttribute('content') || '';

        // Always point og/twitter image to local asset
        if (property === 'og:image' || name === 'twitter:image') {
          el.setAttribute('content', '/assets/logo.jpg');
          return;
        }

        if (/mintlify/i.test(content)) {
          // Replace brand name with our site name for name-like metas
          if (name === 'application-name' || name === 'apple-mobile-web-app-title' || property === 'og:site_name') {
            el.setAttribute('content', SITE_NAME);
            return;
          }
          // Remove image/url metas that point to Mintlify CDN/domains
          if (property === 'og:image' || name === 'twitter:image' || property === 'og:url') {
            el.remove();
            return;
          }
          // Generic fallback: strip literal word "mintlify" from content
          const replaced = content.replace(/mintlify/gi, '').trim();
          if (replaced) {
            el.setAttribute('content', replaced);
          } else {
            el.remove();
          }
        }
      },
    })
    // Remove head links that reference Mintlify domains (branding assets/og generators)
    .on('head link', {
      element(el) {
        const href = el.getAttribute('href') || '';
        if (/mintlify/i.test(href)) {
          el.remove();
        }
      },
    })
    // Replace remaining plain text occurrences in head/body and inlined scripts/styles
    .on('head', {
      text(t) {
        const updated = t.text.replace(/mintlify/gi, SITE_NAME);
        t.replace(updated);
      },
    })
    .on('body', {
      text(t) {
        const updated = t.text.replace(/mintlify/gi, SITE_NAME);
        t.replace(updated);
      },
    })
    .on('script', {
      element(el) {
        const id = el.getAttribute('id') || '';
        const src = el.getAttribute('src') || '';
        if (/mintlify/i.test(id) || /mintlify/i.test(src)) {
          el.remove();
          return;
        }
      },
      text(t) {
        const updated = t.text.replace(/mintlify/gi, 'tadle').replace(/_mintlify/gi, '_tadle');
        t.replace(updated);
      },
    })
    .on('style', {
      text(t) {
        const updated = t.text.replace(/mintlify/gi, 'tadle');
        t.replace(updated);
      },
    })
    // Inject a defensive script to hide/remove Mintlify elements after hydration
    .on('body', {
      element(el) {
        const injected = `\n<script>(function(){\n  try{\n    var brand = String.fromCharCode(109,105,110,116,108,105,102,121);\n    function hide(){\n      try{\n        var sels = [\n          'script[src*="'+brand+'"]',\n          'script[id*="'+brand+'"]',\n          'a[href*="'+brand+'"]',\n          '[id*="'+brand+'"]',\n          '[class*="'+brand+'"]',\n          '[aria-label*="'+brand+'"]'\n        ];\n        for(var i=0;i<sels.length;i++){\n          var nodes = document.querySelectorAll(sels[i]);\n          for(var j=0;j<nodes.length;j++){\n            var n = nodes[j];\n            if(n.tagName==='SCRIPT'){ n.remove(); } else { n.style.display='none'; }\n          }\n        }\n        var scripts = document.getElementsByTagName('script');\n        for(var k=scripts.length-1;k>=0;k--){\n          var s = scripts[k];\n          var id = s.id||'';\n          var src = s.src||'';\n          var txt = s.textContent||'';\n          if(id.indexOf(brand)!==-1 || src.indexOf(brand)!==-1 || txt.indexOf(brand)!==-1){\n            s.remove();\n          }\n        }\n      }catch(e){}\n    }\n    hide();\n    if(document.readyState==='loading'){\n      document.addEventListener('DOMContentLoaded', hide);\n    } else {\n      queueMicrotask(hide);\n    }\n    var mo = new MutationObserver(function(){ hide(); });\n    mo.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['id','class','href','aria-label','src'] });\n    setTimeout(hide, 50);\n    setTimeout(hide, 500);\n    setTimeout(hide, 1000);\n    setTimeout(hide, 3000);\n    setTimeout(hide, 10000);\n  }catch(e){}\n})();</script>\n`;
        el.append(injected, { html: true });
      },
    });

  const transformed = rewriter.transform(upstreamRes);
  const headers = new Headers(upstreamRes.headers);
  // Prevent CDN/browser caching to ensure replacements are visible in production
  headers.set('cache-control', 'no-store');
  // Mark responses to help prod verification
  headers.set('x-rewritten-by', 'open-odds-worker');
  // Normalize content-type for HTML
  if (!headers.get('content-type')) headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(transformed.body, { status: upstreamRes.status, headers });
}

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

// Serve local JPG branding asset for og/twitter image
app.get('/assets/logo.jpg', async (c) => {
  const bytes = Uint8Array.from(atob(LOGO_JPG_BASE64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
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
    const body = hasBody ? (typeof payload.body === 'string' ? payload.body : payload.body !== undefined ? JSON.stringify(payload.body) : undefined) : undefined;

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

  return transformDocsHtml(upstreamRes, docsOrigin);
});

// 404 for everything else
app.notFound((c) => c.text('Not found', 404));

export default app;
