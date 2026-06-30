# `@payorder/shared`

Single source of truth for contracts shared across **api**, **worker** and **web**:

- **Zod schemas** for tenant onboarding and value objects (TASK-003).
- **Stellar value objects** — `StellarPublicKey` / `StellarAccount` with StrKey checksum
  validation and Testnet-only network (TASK-004).
- **Canonicalization + SHA-256 hash** of the payment-order payload — one deterministic
  implementation so the order hash never diverges between services (TASK-005).

> Why a shared package? The canonical payload and its hash are registered on-chain and shown
> on the public payment page for verification. If the API, worker and frontend computed them
> independently they could drift. Centralizing them here removes that class of bug
> (see [`docs/specs/.../03-domain-model.md §5`](../../docs/specs/payorder-w3-guardian/03-domain-model.md)).

## Domain reference (living)

The authoritative domain model is
[`docs/specs/payorder-w3-guardian/03-domain-model.md`](../../docs/specs/payorder-w3-guardian/03-domain-model.md).
Key pieces this package encodes:

### Glossary (ubiquitous language)

| Term | Meaning |
|------|---------|
| **Tenant** | Receiving company/system with a linked Stellar Testnet wallet. |
| **Payment Order** | A charge that becomes a verifiable Web3 payment order. |
| **Receiver Wallet** | Destination wallet, derived from the tenant and **copied** onto the order. |
| **Canonical Payload** | Deterministic serialization of the order's payment-relevant fields. |
| **Order Hash** | SHA-256 of the canonical payload, registered on-chain. |
| **Public Slug** | Opaque identifier of the public payment link. |
| **Asset** | Pair `(code, issuer)`; for native XLM the `issuer` is null. |

### Aggregates

- **`Tenant`** (root): identity + destination wallet. Can only issue orders when
  `status == ACTIVE && wallet != null`. Wallet network must be `TESTNET` (MVP invariant).
- **`PaymentOrder`** (root): lifecycle of a charge. `receiverWallet`, `amount`, `asset` and
  `canonicalPayloadHash` are **immutable** after creation.

### PaymentOrder state machine

```text
              registerOnChain()
( · ) ─create()─▶ CREATED ─────────────▶ ACTIVE ──▶ PAID
                                            ├──────▶ EXPIRED
                                            ├──────▶ CANCELLED
                                            └──────▶ FAILED
```

`CREATED` is a transient off-chain state; the public page only exposes an order as payable
when `ACTIVE`. `PAID`, `EXPIRED`, `CANCELLED` and `FAILED` are terminal.

## Canonicalization rules

The canonical payload (the only fields that determine the payment) is hashed with these
rules — identical across services:

- JSON with keys sorted lexicographically, no whitespace, UTF-8.
- `amount` as a fixed-scale decimal string (7 places, Stellar standard): `"150.0000000"`.
- `asset_issuer` null/absent → empty string `""` (the key is never omitted).
- `due_date` is date-only (`YYYY-MM-DD`); absent → `""`.
- `version` defaults to `1`.
- `description` and `metadata` are **excluded** (not payment-determining).

```jsonc
{
  "amount": "150.0000000",
  "asset_code": "XLM",
  "asset_issuer": "",
  "due_date": "2026-07-10",
  "external_id": "ORDER-123456",
  "order_id": "0f9d...",
  "receiver_wallet": "GB2J...K4KUZ",
  "tenant_id": "tenant_123",
  "version": 1
}
```

`canonical_payload_hash = sha256_hex(canonical_json_bytes)`.

## Public API

```ts
import {
  // Stellar VOs
  StellarPublicKeySchema,
  StellarAccountSchema,
  StellarNetworkSchema,
  isValidStellarPublicKey,
  TESTNET,
  // Schemas
  CreateTenantInputSchema,
  TenantSchema,
  DocumentSchema,
  AssetSchema,
  EmailSchema,
  SlugSchema,
  // Canonicalization + hash
  canonicalize,
  buildCanonicalPayload,
  canonicalPayloadHash,
  formatStellarAmount,
  Sha256HashSchema,
} from '@payorder/shared';
```

## Scripts

```bash
npm run -w @payorder/shared typecheck   # tsc --noEmit
npm run -w @payorder/shared test        # vitest run
npm run -w @payorder/shared build       # emit dist/
```
