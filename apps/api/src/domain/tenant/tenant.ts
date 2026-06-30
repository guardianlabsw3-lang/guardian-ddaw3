import type { Asset, Document, Email, Slug, StellarAccount, TenantStatus } from '@payorder/shared';
import { DomainError } from '../shared/errors.js';
import type { TenantEvent } from './events.js';

/**
 * Aggregate root `Tenant` (spec 03 §2.1). Holds the receiver identity and its destination
 * Stellar wallet. The domain is pure — value objects (`Document`, `Email`, `Asset`,
 * `StellarAccount`) are validated upstream by the shared zod schemas; here we enforce the
 * behavioural invariants and the activation policy (spec 05 §6, 06 §4).
 */

export interface TenantProps {
  id: string;
  slug: Slug;
  name: string;
  legalName: string;
  document: Document;
  adminEmail: Email;
  wallet: StellarAccount | null;
  defaultAsset: Asset;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTenantProps {
  id: string;
  slug: Slug;
  name: string;
  legalName: string;
  document: Document;
  adminEmail: Email;
  defaultAsset: Asset;
  wallet?: StellarAccount | null;
  now: Date;
}

export class Tenant {
  private readonly _id: string;
  private readonly _slug: Slug;
  private _name: string;
  private _legalName: string;
  private readonly _document: Document;
  private _adminEmail: Email;
  private _wallet: StellarAccount | null;
  private _defaultAsset: Asset;
  private _status: TenantStatus;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private readonly _events: TenantEvent[] = [];

  private constructor(props: TenantProps) {
    this._id = props.id;
    this._slug = props.slug;
    this._name = props.name;
    this._legalName = props.legalName;
    this._document = props.document;
    this._adminEmail = props.adminEmail;
    this._wallet = props.wallet;
    this._defaultAsset = props.defaultAsset;
    this._status = props.status;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  /**
   * Onboard a new tenant. Per the MVP activation policy (spec 05 §6) a tenant is created
   * `INACTIVE` and only becomes `ACTIVE` once a valid wallet is attached and activation is
   * requested. A wallet may optionally be supplied at creation time.
   */
  static create(props: CreateTenantProps): Tenant {
    const tenant = new Tenant({
      id: props.id,
      slug: props.slug,
      name: props.name,
      legalName: props.legalName,
      document: props.document,
      adminEmail: props.adminEmail,
      wallet: props.wallet ?? null,
      defaultAsset: props.defaultAsset,
      status: 'INACTIVE',
      createdAt: props.now,
      updatedAt: props.now,
    });
    tenant._events.push({
      type: 'TenantCreated',
      tenantId: tenant._id,
      document: tenant._document,
      occurredAt: props.now,
    });
    if (tenant._wallet) {
      tenant._events.push({
        type: 'TenantWalletAssigned',
        tenantId: tenant._id,
        publicKey: tenant._wallet.publicKey,
        occurredAt: props.now,
      });
    }
    return tenant;
  }

  /** Rebuild an aggregate from persistence without emitting creation events. */
  static fromPersistence(props: TenantProps): Tenant {
    return new Tenant(props);
  }

  /**
   * Attach (or replace) the destination wallet. The "no change while active orders exist"
   * rule (RN-09) is orchestrated by the application layer, which inspects the order
   * repository before calling this. Historical orders keep their copied wallet regardless.
   */
  assignWallet(wallet: StellarAccount, now: Date): void {
    this._wallet = wallet;
    this._updatedAt = now;
    this._events.push({
      type: 'TenantWalletAssigned',
      tenantId: this._id,
      publicKey: wallet.publicKey,
      occurredAt: now,
    });
  }

  /**
   * Activate the tenant. A tenant cannot be activated without a wallet (spec 05 §6),
   * guaranteeing RN-01 at the source. Idempotent when already active.
   */
  activate(now: Date): void {
    if (this._wallet === null) {
      throw new DomainError(
        'TENANT_WALLET_NOT_SET',
        'Cannot activate a tenant without a Stellar wallet',
        { tenantId: this._id },
      );
    }
    if (this._status === 'ACTIVE') {
      return;
    }
    this._status = 'ACTIVE';
    this._updatedAt = now;
    this._events.push({ type: 'TenantActivated', tenantId: this._id, occurredAt: now });
  }

  /** Deactivate the tenant. Idempotent when already inactive. */
  deactivate(now: Date): void {
    if (this._status === 'INACTIVE') {
      return;
    }
    this._status = 'INACTIVE';
    this._updatedAt = now;
    this._events.push({ type: 'TenantDeactivated', tenantId: this._id, occurredAt: now });
  }

  /** RN-01: a tenant may issue orders only when it is active and has a wallet. */
  canIssueOrders(): boolean {
    return this._status === 'ACTIVE' && this._wallet !== null;
  }

  /** Drain and return the events accumulated since the last pull. */
  pullEvents(): TenantEvent[] {
    return this._events.splice(0, this._events.length);
  }

  get id(): string {
    return this._id;
  }
  get slug(): Slug {
    return this._slug;
  }
  get name(): string {
    return this._name;
  }
  get legalName(): string {
    return this._legalName;
  }
  get document(): Document {
    return this._document;
  }
  get adminEmail(): Email {
    return this._adminEmail;
  }
  get wallet(): StellarAccount | null {
    return this._wallet;
  }
  get defaultAsset(): Asset {
    return this._defaultAsset;
  }
  get status(): TenantStatus {
    return this._status;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
}
