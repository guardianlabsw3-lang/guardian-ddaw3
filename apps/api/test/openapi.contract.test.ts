import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import { buildHarness } from './http/harness.js';

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../openapi/payorder-api.yaml',
);

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

/** Normalize an app route pattern to its OpenAPI path: drop `/api`, `:p` → `{p}`. */
function toOpenApiPath(pattern: string): string {
  return pattern.replace(/^\/api/, '').replace(/:([^/]+)/g, '{$1}');
}

/**
 * Contract test (TASK-024). Asserts the OpenAPI document is valid and that the documented
 * surface and the implemented surface are in exact agreement — every route the app serves is
 * documented, and every documented operation is implemented. This is the offline analogue of
 * Dredd/schemathesis: the spec is the source of truth and CI fails the moment they drift.
 */
describe('OpenAPI contract', () => {
  it('is a valid OpenAPI document', async () => {
    await expect(SwaggerParser.validate(SPEC_PATH)).resolves.toBeDefined();
  });

  it('documents exactly the implemented routes', async () => {
    const api = (await SwaggerParser.validate(SPEC_PATH)) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const documented = new Set<string>();
    for (const [path, item] of Object.entries(api.paths)) {
      for (const method of HTTP_METHODS) {
        if (item[method]) {
          documented.add(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    const harness = await buildHarness();
    const implemented = new Set(
      harness.app.router.list().map((r) => `${r.method} ${toOpenApiPath(r.pattern)}`),
    );

    const undocumented = [...implemented].filter((op) => !documented.has(op)).sort();
    const unimplemented = [...documented].filter((op) => !implemented.has(op)).sort();

    expect(undocumented, 'routes served but not documented').toEqual([]);
    expect(unimplemented, 'operations documented but not served').toEqual([]);
  });

  it('marks public endpoints with empty security', async () => {
    const api = (await SwaggerParser.validate(SPEC_PATH)) as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    const publicOps: [string, string][] = [
      ['/auth/login', 'post'],
      ['/health', 'get'],
      ['/ready', 'get'],
      ['/public/payment-orders/{slug}', 'get'],
    ];
    for (const [path, method] of publicOps) {
      const op = api.paths[path]?.[method];
      expect(op?.security, `${method} ${path} must be public`).toEqual([]);
    }
  });
});
