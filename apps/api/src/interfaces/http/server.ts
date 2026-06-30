import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { App } from './app.js';
import { createHttpRequest } from './request.js';

/** Max accepted request body (defensive bound; spec 10 §4 size limits). */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Adapt the framework-free `App` to a node `http.Server`. Reads and bounds the body, sets a
 * synthetic `x-forwarded-for` from the socket when absent (so rate limiting has an IP behind
 * a proxy that strips it), runs the pipeline and serializes the JSON response.
 */
export function createHttpServer(app: App): Server {
  return createServer((req, res) => {
    handle(app, req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'fatal' } }));
      }
    });
  });
}

async function handle(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawBody = await readBody(req);
  const headers = { ...req.headers };
  if (!headers['x-forwarded-for'] && req.socket.remoteAddress) {
    headers['x-forwarded-for'] = req.socket.remoteAddress;
  }

  const httpReq = createHttpRequest({
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    headers,
    rawBody,
  });

  const result = await app.handle(httpReq);
  const body = result.body === undefined ? '' : JSON.stringify(result.body);
  const responseHeaders: Record<string, string> = { ...result.headers };
  if (result.body !== undefined) {
    responseHeaders['content-type'] = 'application/json';
  }
  res.writeHead(result.status, responseHeaders);
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
