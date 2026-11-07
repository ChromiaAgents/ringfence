import { createFileRoute } from '@tanstack/react-router';
import { listTokens, quoteDeposit } from '../../../../src/pay.ts';
import { save } from '../../../../src/store.ts';
import { findJob, json, publicJob } from '../../../backend.ts';

export const Route = createFileRoute('/api/pay/$jobId/quote')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const job = findJob(params.jobId);
        if (!job) return json({ error: 'no such job' }, 404);
        if (job.payment && ['SUCCESS', 'PROCESSING', 'KNOWN_DEPOSIT_TX'].includes(job.payment.status)) return json({ error: 'already paid' }, 409);
        const { originAsset, refundTo } = await request.json().catch(() => ({}));
        const t = (await listTokens()).find((x) => x.assetId === originAsset);
        if (!t || !refundTo) return json({ error: 'pick a token and give a refund address' }, 400);
        try {
          const quote = await quoteDeposit({ usd: job.depositUsd, originAsset, refundTo: String(refundTo).trim(), dry: false });
          job.payment = { quote, status: 'PENDING_DEPOSIT', updatedAt: Date.now(), originSymbol: t.symbol, chain: t.blockchain };
          save();
          return json(publicJob(job));
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      },
    },
  },
});
