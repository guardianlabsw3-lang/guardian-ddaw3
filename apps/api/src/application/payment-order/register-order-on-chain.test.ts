import { describe, it, expect, beforeEach } from 'vitest';
import { RegisterOrderOnChain } from './register-order-on-chain.js';
import {
  FixedClock,
  InMemoryPaymentOrderRepository,
  MockSorobanContract,
  RecordingLogger,
} from '../../../test/fakes.js';
import { FIXED_NOW, buildOrder } from '../../../test/fixtures.js';

const ORDER_ID = '00000000-0000-7000-8000-0000000000c1';

interface Harness {
  orders: InMemoryPaymentOrderRepository;
  contract: MockSorobanContract;
  logger: RecordingLogger;
  useCase: RegisterOrderOnChain;
}

function harness(): Harness {
  const orders = new InMemoryPaymentOrderRepository();
  const contract = new MockSorobanContract();
  const logger = new RecordingLogger();
  const useCase = new RegisterOrderOnChain({
    orders,
    contract,
    clock: new FixedClock(FIXED_NOW),
    logger,
  });
  return { orders, contract, logger, useCase };
}

describe('RegisterOrderOnChain', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('registers a CREATED order on-chain and transitions it to ACTIVE', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID, amount: '150' }));

    const result = await h.useCase.execute({ paymentOrderId: ORDER_ID, correlationId: 'corr-1' });

    expect(result.outcome).toBe('registered');
    expect(result.contractId).toBe('CA_TEST_CONTRACT');
    expect(result.txHash).toBe('TX_REGISTER_1');

    const order = await h.orders.findById(ORDER_ID);
    expect(order?.status).toBe('ACTIVE');
    expect(order?.sorobanContractId).toBe('CA_TEST_CONTRACT');
    expect(order?.blockchainTxHash).toBe('TX_REGISTER_1');

    expect(h.contract.registered).toHaveLength(1);
    expect(h.contract.registered[0]).toMatchObject({
      orderId: ORDER_ID,
      amount: '150.0000000',
      correlationId: 'corr-1',
    });

    const events = await h.orders.listEvents(ORDER_ID);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'registered']);
  });

  it('is idempotent: a re-run after registration is a no-op (already-active)', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID }));
    await h.useCase.execute({ paymentOrderId: ORDER_ID });

    const result = await h.useCase.execute({ paymentOrderId: ORDER_ID });

    expect(result.outcome).toBe('already-active');
    expect(h.contract.registered).toHaveLength(1); // no second on-chain call
  });

  it('reports missing when the order does not exist (non-retryable)', async () => {
    const result = await h.useCase.execute({ paymentOrderId: 'does-not-exist' });
    expect(result.outcome).toBe('missing');
    expect(h.logger.byLevel('error')).toHaveLength(1);
  });

  it('skips an order already in a terminal state', async () => {
    const order = buildOrder({ id: ORDER_ID });
    order.markRegisteredOnChain('CA', null, FIXED_NOW);
    order.cancel('admin', FIXED_NOW);
    await h.orders.save(order);

    const result = await h.useCase.execute({ paymentOrderId: ORDER_ID });
    expect(result.outcome).toBe('skipped');
    expect(h.contract.registered).toHaveLength(0);
  });

  it('rethrows transient adapter errors and leaves the order CREATED for retry', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID }));
    h.contract.failNextRegister(new Error('RPC timeout'));

    await expect(h.useCase.execute({ paymentOrderId: ORDER_ID })).rejects.toThrow('RPC timeout');

    const order = await h.orders.findById(ORDER_ID);
    expect(order?.status).toBe('CREATED');
  });

  it('markFailed transitions a still-CREATED order to FAILED', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID }));

    await h.useCase.markFailed(ORDER_ID, 'exhausted retries');

    const order = await h.orders.findById(ORDER_ID);
    expect(order?.status).toBe('FAILED');
    const events = await h.orders.listEvents(ORDER_ID);
    expect(events.map((e) => e.eventType)).toEqual(['created', 'failed']);
  });

  it('markFailed is a no-op once the order has advanced past CREATED', async () => {
    await h.orders.save(buildOrder({ id: ORDER_ID }));
    await h.useCase.execute({ paymentOrderId: ORDER_ID }); // now ACTIVE

    await h.useCase.markFailed(ORDER_ID, 'late failure');

    const order = await h.orders.findById(ORDER_ID);
    expect(order?.status).toBe('ACTIVE');
  });
});
