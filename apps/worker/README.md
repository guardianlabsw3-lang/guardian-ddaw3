# `@payorder/worker` — Background Worker (BullMQ)

Placeholder for the PayOrder W3 Guardian worker. Jobs (on-chain registration, status sync,
expiration, webhook delivery) land from **TASK-016** onward.

It shares canonicalization/hash and types with the API via
[`@payorder/shared`](../../packages/shared/README.md) to guarantee an identical order hash
across services.
