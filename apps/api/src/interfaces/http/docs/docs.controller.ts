import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationError } from '../../../application/shared/errors.js';
import type { RouteDefinition } from '../router.js';
import { text } from '../types.js';

export interface DocsControllerDeps {
  /** Override for the OpenAPI document location (tests / non-standard layouts). */
  specPath?: string;
}

/** Repo-relative location of the OpenAPI document, searched upward from this module. */
const SPEC_RELATIVE_PATH = join('openapi', 'payorder-api.yaml');

/**
 * Locate `openapi/payorder-api.yaml` by walking up from this module's directory. Works from
 * `src/` (tsx dev), `dist/` (compiled) and the Docker image, where the spec is copied next to
 * `apps/` under the same root.
 */
function findSpecPath(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = resolve(dir, SPEC_RELATIVE_PATH);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Minimal self-contained Swagger UI page pointing at the served OpenAPI document. */
const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PayOrder W3 Guardian API — Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>
`;

/**
 * Public, unauthenticated API documentation: `/api/docs` renders an interactive Swagger UI
 * and `/api/docs/openapi.yaml` serves the raw OpenAPI contract so external consumers can
 * generate clients against it. Read-only, no tenant data — safe to expose without auth.
 */
export function docsRoutes(deps: DocsControllerDeps = {}): RouteDefinition[] {
  let cachedSpec: string | null = null;

  const loadSpec = (): string => {
    if (cachedSpec === null) {
      const path = deps.specPath ?? findSpecPath();
      if (!path || !existsSync(path)) {
        throw new ApplicationError('NOT_FOUND', 'OpenAPI document is not available', 404);
      }
      cachedSpec = readFileSync(path, 'utf8');
    }
    return cachedSpec;
  };

  return [
    {
      method: 'GET',
      path: '/api/docs',
      auth: 'none',
      handler: () => text(200, DOCS_HTML, 'text/html; charset=utf-8'),
    },
    {
      method: 'GET',
      path: '/api/docs/openapi.yaml',
      auth: 'none',
      handler: () => text(200, loadSpec(), 'application/yaml; charset=utf-8'),
    },
  ];
}
