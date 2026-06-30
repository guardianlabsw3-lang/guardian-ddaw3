import { notFound } from 'next/navigation';
import { ApiError, PayOrderApi } from '@/src/lib/api';
import type { PublicPaymentOrder } from '@/src/lib/types';
import { getServerApiBaseUrl } from '@/src/config';
import { PaymentClient } from './PaymentClient';

export const dynamic = 'force-dynamic';

export default async function PublicPaymentPage({ params }: { params: { slug: string } }) {
  const api = new PayOrderApi(getServerApiBaseUrl());

  let order: PublicPaymentOrder | null = null;
  let initialError: string | null = null;

  try {
    order = await api.getPublicOrder(params.slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    // The API may be unreachable during SSR; the client component can retry.
    initialError = 'Não foi possível carregar a cobrança. Tente atualizar.';
  }

  return <PaymentClient slug={params.slug} initialOrder={order} initialError={initialError} />;
}
