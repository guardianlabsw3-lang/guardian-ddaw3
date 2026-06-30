# `@payorder/api` — Backend (NestJS)

Placeholder for the PayOrder W3 Guardian REST API. The runtime implementation lands from
**TASK-010** onward (domain, persistence, use cases, HTTP interfaces).

Architecture and layering are defined in
[`docs/specs/payorder-w3-guardian/04-architecture.md`](../../docs/specs/payorder-w3-guardian/04-architecture.md):

```text
src/
  domain/         (entities, VOs, rules, events — framework free)
  application/    (use cases, ports, DTOs)
  infrastructure/ (persistence, stellar, webhooks, queue, config, observability)
  interfaces/     (http controllers, health)
```

Shared types, zod schemas, Stellar value objects and canonicalization/hash come from
[`@payorder/shared`](../../packages/shared/README.md).
