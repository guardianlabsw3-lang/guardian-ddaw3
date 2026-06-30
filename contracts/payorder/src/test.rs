#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger as _},
    token, vec, Address, BytesN, Env, IntoVal, Symbol,
};

// --- test helpers -----------------------------------------------------------------------------

struct Setup {
    env: Env,
    client: PayOrderContractClient<'static>,
    admin: Address,
    receiver: Address,
    payer: Address,
    token: Address,
    asset: AssetInfo,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PayOrderContract, ());
    let client = PayOrderContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let receiver = Address::generate(&env);
    let payer = Address::generate(&env);

    // Deploy a Stellar Asset Contract to act as the payment token and fund the payer.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    token::StellarAssetClient::new(&env, &token).mint(&payer, &1_000_000_000i128);

    let asset = AssetInfo {
        code: symbol_short!("XLM"),
        issuer: None,
    };

    Setup {
        env,
        client,
        admin,
        receiver,
        payer,
        token,
        asset,
    }
}

fn id(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

/// Registers an `Active` order with `amount` and `due_ledger`, returning its id.
fn register(s: &Setup, b: u8, amount: i128, due_ledger: u32) -> BytesN<32> {
    let order_id = id(&s.env, b);
    s.client.register_order(
        &order_id,
        &id(&s.env, 0xAA), // data_hash
        &id(&s.env, 0xBB), // tenant_ref
        &s.receiver,
        &s.token,
        &amount,
        &s.asset,
        &due_ledger,
    );
    order_id
}

// --- initialize -------------------------------------------------------------------------------

#[test]
fn initialize_sets_admin() {
    let s = setup();
    assert_eq!(s.client.admin(), s.admin);
}

#[test]
fn initialize_twice_fails() {
    let s = setup();
    let other = Address::generate(&s.env);
    assert_eq!(
        s.client.try_initialize(&other),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn register_before_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayOrderContract, ());
    let client = PayOrderContractClient::new(&env, &contract_id);

    let receiver = Address::generate(&env);
    let res = client.try_register_order(
        &id(&env, 1),
        &id(&env, 2),
        &id(&env, 3),
        &receiver,
        &receiver,
        &100i128,
        &AssetInfo {
            code: symbol_short!("XLM"),
            issuer: None,
        },
        &0u32,
    );
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

// --- register_order / get_order ---------------------------------------------------------------

#[test]
fn register_creates_active_order() {
    let s = setup();
    let order_id = register(&s, 1, 500, 0);

    let order = s.client.get_order(&order_id);
    assert_eq!(order.order_id, order_id);
    assert_eq!(order.status, OrderStatus::Active);
    assert_eq!(order.receiver, s.receiver);
    assert_eq!(order.amount, 500);
    assert_eq!(order.asset, s.asset);
    assert_eq!(order.data_hash, id(&s.env, 0xAA));
    assert_eq!(order.tenant_ref, id(&s.env, 0xBB));
    assert_eq!(order.paid_by, None);
    assert_eq!(order.paid_at, None);
}

#[test]
fn register_emits_registered_event() {
    // Clean env (no SAC mint) so `all()` contains exactly the `registered` event.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayOrderContract, ());
    let client = PayOrderContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    let receiver = Address::generate(&env);
    let token = Address::generate(&env);
    let asset = AssetInfo {
        code: symbol_short!("XLM"),
        issuer: None,
    };
    let order_id = id(&env, 1);
    client.register_order(
        &order_id,
        &id(&env, 0xAA),
        &id(&env, 0xBB),
        &receiver,
        &token,
        &500i128,
        &asset,
        &0u32,
    );

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id.clone(),
                (Symbol::new(&env, "registered"), order_id.clone()).into_val(&env),
                (receiver.clone(), 500i128).into_val(&env),
            ),
        ]
    );
}

#[test]
fn register_duplicate_fails() {
    let s = setup();
    register(&s, 1, 500, 0);
    let order_id = id(&s.env, 1);
    let res = s.client.try_register_order(
        &order_id,
        &id(&s.env, 0xAA),
        &id(&s.env, 0xBB),
        &s.receiver,
        &s.token,
        &500i128,
        &s.asset,
        &0u32,
    );
    assert_eq!(res, Err(Ok(Error::OrderAlreadyExists)));
}

#[test]
fn register_invalid_amount_fails() {
    let s = setup();
    let order_id = id(&s.env, 1);
    let res = s.client.try_register_order(
        &order_id,
        &id(&s.env, 0xAA),
        &id(&s.env, 0xBB),
        &s.receiver,
        &s.token,
        &0i128,
        &s.asset,
        &0u32,
    );
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn register_requires_admin_auth() {
    let s = setup();
    s.env.mock_auths(&[]); // no authorizations available
    let order_id = id(&s.env, 1);
    let res = s.client.try_register_order(
        &order_id,
        &id(&s.env, 0xAA),
        &id(&s.env, 0xBB),
        &s.receiver,
        &s.token,
        &500i128,
        &s.asset,
        &0u32,
    );
    assert!(res.is_err());
}

#[test]
fn get_order_not_found() {
    let s = setup();
    let res = s.client.try_get_order(&id(&s.env, 9));
    assert_eq!(res, Err(Ok(Error::OrderNotFound)));
}

// --- pay --------------------------------------------------------------------------------------

#[test]
fn pay_success_transfers_and_marks_paid() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);

    s.client.pay(&order_id, &s.payer, &1_000i128, &s.asset);

    let order = s.client.get_order(&order_id);
    assert_eq!(order.status, OrderStatus::Paid);
    assert_eq!(order.paid_by, Some(s.payer.clone()));
    assert!(order.paid_at.is_some());

    let tok = token::Client::new(&s.env, &s.token);
    assert_eq!(tok.balance(&s.receiver), 1_000);
    assert_eq!(tok.balance(&s.payer), 1_000_000_000 - 1_000);
}

#[test]
fn pay_amount_mismatch_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    let res = s.client.try_pay(&order_id, &s.payer, &999i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::AmountMismatch)));
}

#[test]
fn pay_asset_mismatch_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    let wrong = AssetInfo {
        code: symbol_short!("USDC"),
        issuer: Some(Address::generate(&s.env)),
    };
    let res = s.client.try_pay(&order_id, &s.payer, &1_000i128, &wrong);
    assert_eq!(res, Err(Ok(Error::AssetMismatch)));
}

#[test]
fn pay_twice_fails_double_payment() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.pay(&order_id, &s.payer, &1_000i128, &s.asset);
    let res = s.client.try_pay(&order_id, &s.payer, &1_000i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::OrderNotActive)));
}

#[test]
fn pay_cancelled_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.cancel_order(&order_id);
    let res = s.client.try_pay(&order_id, &s.payer, &1_000i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::OrderNotActive)));
}

#[test]
fn pay_past_due_ledger_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 100);
    s.env.ledger().with_mut(|li| li.sequence_number = 101);
    let res = s.client.try_pay(&order_id, &s.payer, &1_000i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::OrderExpired)));
}

#[test]
fn pay_within_due_ledger_succeeds() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 100);
    s.env.ledger().with_mut(|li| li.sequence_number = 100);
    s.client.pay(&order_id, &s.payer, &1_000i128, &s.asset);
    assert_eq!(s.client.get_order(&order_id).status, OrderStatus::Paid);
}

#[test]
fn pay_order_not_found() {
    let s = setup();
    let res = s
        .client
        .try_pay(&id(&s.env, 9), &s.payer, &1_000i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::OrderNotFound)));
}

// --- cancel_order -----------------------------------------------------------------------------

#[test]
fn cancel_by_admin_succeeds() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.cancel_order(&order_id);
    assert_eq!(s.client.get_order(&order_id).status, OrderStatus::Cancelled);
}

#[test]
fn cancel_unauthorized_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.env.mock_auths(&[]); // drop the admin's authorization
    let res = s.client.try_cancel_order(&order_id);
    assert!(res.is_err());
}

#[test]
fn cancel_non_active_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.cancel_order(&order_id);
    let res = s.client.try_cancel_order(&order_id);
    assert_eq!(res, Err(Ok(Error::OrderNotActive)));
}

// --- expire_order -----------------------------------------------------------------------------

#[test]
fn expire_after_due_by_anyone_succeeds() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 100);
    s.env.ledger().with_mut(|li| li.sequence_number = 200);
    // No admin auth needed once objectively past due.
    s.env.mock_auths(&[]);
    s.client.expire_order(&order_id);
    assert_eq!(s.client.get_order(&order_id).status, OrderStatus::Expired);
}

#[test]
fn expire_before_due_by_non_admin_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 100);
    s.env.ledger().with_mut(|li| li.sequence_number = 50); // not yet due
    s.env.mock_auths(&[]);
    let res = s.client.try_expire_order(&order_id);
    assert!(res.is_err());
    assert_eq!(s.client.get_order(&order_id).status, OrderStatus::Active);
}

#[test]
fn expire_non_active_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 100);
    s.client.cancel_order(&order_id);
    s.env.ledger().with_mut(|li| li.sequence_number = 200);
    let res = s.client.try_expire_order(&order_id);
    assert_eq!(res, Err(Ok(Error::OrderNotActive)));
}

// --- mark_failed ------------------------------------------------------------------------------

#[test]
fn mark_failed_by_admin_succeeds() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.mark_failed(&order_id, &symbol_short!("dispute"));
    assert_eq!(s.client.get_order(&order_id).status, OrderStatus::Failed);
}

#[test]
fn mark_failed_unauthorized_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.env.mock_auths(&[]);
    let res = s
        .client
        .try_mark_failed(&order_id, &symbol_short!("dispute"));
    assert!(res.is_err());
}

#[test]
fn mark_failed_then_pay_fails() {
    let s = setup();
    let order_id = register(&s, 1, 1_000, 0);
    s.client.mark_failed(&order_id, &symbol_short!("dispute"));
    let res = s.client.try_pay(&order_id, &s.payer, &1_000i128, &s.asset);
    assert_eq!(res, Err(Ok(Error::OrderNotActive)));
}
