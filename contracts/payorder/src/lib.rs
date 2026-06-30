#![no_std]
//! PayOrder W3 Guardian — Soroban smart contract.
//!
//! Registers and governs the lifecycle of a Payment Order on-chain. The contract is the
//! authority of the payment status and operates on the **Stellar Testnet**. See
//! `docs/specs/payorder-w3-guardian/07-smart-contract.md` for the full specification.
//!
//! ## Design note (asset resolution)
//!
//! The spec's [`AssetInfo`] (`code` + `issuer`) identifies the asset for the canonical record
//! and for validation in [`PayOrderContract::pay`]. To actually move funds, `pay` needs the
//! address of the asset's Stellar Asset Contract (SAC). Resolving a SAC address from
//! `code`/`issuer` on-chain is heavy and error-prone, so the backend resolves it
//! deterministically and passes it as `token` to [`PayOrderContract::register_order`]; it is
//! stored (immutably) alongside the order. `AssetInfo` is retained for identity and equality
//! checks, matching the off-chain canonical payload.

// Events are published with explicit topic symbols + data tuples to honour the event
// contract documented in spec §5 (`registered`/`paid`/`cancelled`/`expired`/`failed`), which
// the backend worker observes. `events().publish` is deprecated in favour of `#[contractevent]`,
// but that macro derives topics from type names and would change the documented topic shape.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Symbol,
};

// --- TTL management ---------------------------------------------------------------------------

const DAY_IN_LEDGERS: u32 = 17_280; // ~5s ledgers => one day.

const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

const ORDER_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const ORDER_LIFETIME_THRESHOLD: u32 = ORDER_BUMP_AMOUNT - DAY_IN_LEDGERS;

// --- Data types -------------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderStatus {
    Active,
    Paid,
    Expired,
    Cancelled,
    Failed,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AssetInfo {
    pub code: Symbol,            // e.g. "XLM"
    pub issuer: Option<Address>, // None for the native asset.
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PaymentOrder {
    pub order_id: BytesN<32>,   // order id (uuid/hash) packed into 32 bytes.
    pub data_hash: BytesN<32>,  // SHA-256 of the canonical payload.
    pub tenant_ref: BytesN<32>, // reference to the receiving tenant (hash/uuid).
    pub receiver: Address,      // destination wallet of the receiving tenant.
    pub token: Address,         // SAC address of `asset` (resolved off-chain at registration).
    pub amount: i128,           // value in the smallest unit of the asset (stroops for XLM).
    pub asset: AssetInfo,       // accepted asset.
    pub status: OrderStatus,
    pub due_ledger: u32,          // expiration ledger sequence (0 = no expiry).
    pub paid_by: Option<Address>, // payer (after PAID).
    pub created_at: u64,          // ledger timestamp at registration.
    pub paid_at: Option<u64>,
}

#[contracttype]
pub enum DataKey {
    Admin,             // administrative authority (register/cancel/expire/mark_failed).
    Order(BytesN<32>), // PaymentOrder by order_id.
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    OrderAlreadyExists = 4,
    OrderNotFound = 5,
    OrderNotActive = 6, // already paid/cancelled/expired/failed.
    OrderExpired = 7,
    AmountMismatch = 8,
    AssetMismatch = 9,
    InvalidAmount = 10,
}

// --- Contract ---------------------------------------------------------------------------------

#[contract]
pub struct PayOrderContract;

#[contractimpl]
impl PayOrderContract {
    /// Sets the administrative authority. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        Ok(())
    }

    /// Returns the configured administrative authority.
    pub fn admin(env: Env) -> Result<Address, Error> {
        Self::read_admin(&env)
    }

    /// Registers a new Payment Order in the `Active` state. Authorized by the admin.
    ///
    /// Fails with [`Error::OrderAlreadyExists`] if `order_id` is already registered and with
    /// [`Error::InvalidAmount`] if `amount <= 0`.
    #[allow(clippy::too_many_arguments)]
    pub fn register_order(
        env: Env,
        order_id: BytesN<32>,
        data_hash: BytesN<32>,
        tenant_ref: BytesN<32>,
        receiver: Address,
        token: Address,
        amount: i128,
        asset: AssetInfo,
        due_ledger: u32,
    ) -> Result<(), Error> {
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let key = DataKey::Order(order_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::OrderAlreadyExists);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let order = PaymentOrder {
            order_id: order_id.clone(),
            data_hash,
            tenant_ref,
            receiver: receiver.clone(),
            token,
            amount,
            asset,
            status: OrderStatus::Active,
            due_ledger,
            paid_by: None,
            created_at: env.ledger().timestamp(),
            paid_at: None,
        };

        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, ORDER_LIFETIME_THRESHOLD, ORDER_BUMP_AMOUNT);

        env.events().publish(
            (Symbol::new(&env, "registered"), order_id),
            (receiver, amount),
        );
        Ok(())
    }

    /// Reads an order. Public (read-only). Fails with [`Error::OrderNotFound`] if missing.
    pub fn get_order(env: Env, order_id: BytesN<32>) -> Result<PaymentOrder, Error> {
        Self::read_order(&env, &order_id)
    }

    /// Pays an order. Authorized by `payer` (`require_auth`).
    ///
    /// Validates that the order is `Active`, not past `due_ledger`, and that `amount`/`asset`
    /// match the registered ones; transfers the asset via its SAC and marks the order `Paid`.
    pub fn pay(
        env: Env,
        order_id: BytesN<32>,
        payer: Address,
        amount: i128,
        asset: AssetInfo,
    ) -> Result<(), Error> {
        payer.require_auth();

        let key = DataKey::Order(order_id.clone());
        let mut order = Self::read_order(&env, &order_id)?;

        if order.status != OrderStatus::Active {
            return Err(Error::OrderNotActive);
        }
        if order.due_ledger != 0 && env.ledger().sequence() > order.due_ledger {
            return Err(Error::OrderExpired);
        }
        if amount != order.amount {
            return Err(Error::AmountMismatch);
        }
        if asset != order.asset {
            return Err(Error::AssetMismatch);
        }

        // Transfer via the asset's Stellar Asset Contract (resolved off-chain at registration).
        let client = token::Client::new(&env, &order.token);
        client.transfer(&payer, &order.receiver, &order.amount);

        order.status = OrderStatus::Paid;
        order.paid_by = Some(payer.clone());
        order.paid_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, ORDER_LIFETIME_THRESHOLD, ORDER_BUMP_AMOUNT);

        env.events()
            .publish((symbol_short!("paid"), order_id), (payer, amount));
        Ok(())
    }

    /// Cancels an `Active` order. Authorized by the admin. `Active -> Cancelled`.
    pub fn cancel_order(env: Env, order_id: BytesN<32>) -> Result<(), Error> {
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let mut order = Self::read_order(&env, &order_id)?;
        if order.status != OrderStatus::Active {
            return Err(Error::OrderNotActive);
        }

        order.status = OrderStatus::Cancelled;
        Self::save_order(&env, &order);

        env.events()
            .publish((symbol_short!("cancelled"), order_id), ());
        Ok(())
    }

    /// Expires an `Active` order whose `due_ledger` has passed. `Active -> Expired`.
    ///
    /// Authorized by the admin (anytime), or by anyone once the order is objectively past due.
    pub fn expire_order(env: Env, order_id: BytesN<32>) -> Result<(), Error> {
        let mut order = Self::read_order(&env, &order_id)?;
        if order.status != OrderStatus::Active {
            return Err(Error::OrderNotActive);
        }

        let past_due = order.due_ledger != 0 && env.ledger().sequence() > order.due_ledger;
        if !past_due {
            // Not yet objectively expirable: only the admin may force the transition.
            Self::read_admin(&env)?.require_auth();
        }

        order.status = OrderStatus::Expired;
        Self::save_order(&env, &order);

        env.events()
            .publish((symbol_short!("expired"), order_id), ());
        Ok(())
    }

    /// Marks an `Active` order as failed. Authorized by the admin. `Active -> Failed`.
    pub fn mark_failed(env: Env, order_id: BytesN<32>, reason: Symbol) -> Result<(), Error> {
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let mut order = Self::read_order(&env, &order_id)?;
        if order.status != OrderStatus::Active {
            return Err(Error::OrderNotActive);
        }

        order.status = OrderStatus::Failed;
        Self::save_order(&env, &order);

        env.events()
            .publish((symbol_short!("failed"), order_id), reason);
        Ok(())
    }

    // --- internal helpers ---------------------------------------------------------------------

    fn read_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    fn read_order(env: &Env, order_id: &BytesN<32>) -> Result<PaymentOrder, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id.clone()))
            .ok_or(Error::OrderNotFound)
    }

    fn save_order(env: &Env, order: &PaymentOrder) {
        let key = DataKey::Order(order.order_id.clone());
        env.storage().persistent().set(&key, order);
        env.storage()
            .persistent()
            .extend_ttl(&key, ORDER_LIFETIME_THRESHOLD, ORDER_BUMP_AMOUNT);
    }
}

#[cfg(test)]
mod test;
