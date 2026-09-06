// supabase/functions/push-dispatch/index.ts
//
// عامل إرسال الإشعارات: يسحب دفعة من `push_outbox`، يرسلها إلى Expo Push API،
// ثم يسوّي الحالة عبر `settle_push_batch` (ويحذف التوكنات الميتة).
//
// النشر:
//   supabase functions deploy push-dispatch --no-verify-jwt
//   supabase secrets set PUSH_DISPATCH_SECRET=<سر عشوائي طويل>
// الجدولة (pg_cron + pg_net أو Supabase Scheduled Functions) كل دقيقة:
//   select net.http_post(
//     url := 'https://<ref>.functions.supabase.co/push-dispatch',
//     headers := jsonb_build_object('x-dispatch-secret','<السر>')
//   );
//
// الأمان: الدالة تستخدم service-role key من البيئة ولا تقبل أي مدخل من العميل
// سوى الترويسة السرّية — فلا يمكن لأحد استدعاؤها لإرسال محتوى مخصّص.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface OutboxRow {
  id: number;
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // حد Expo لكل طلب

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || req.headers.get('x-dispatch-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: rows, error } = await supabase.rpc('claim_push_batch', { p_limit: BATCH_SIZE });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const batch = (rows ?? []) as OutboxRow[];
  if (batch.length === 0) return Response.json({ ok: true, claimed: 0 });

  const messages = batch.map((r) => ({
    to: r.token,
    title: r.title,
    body: r.body,
    data: r.data,
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  }));

  const sent: number[] = [];
  const failed: number[] = [];
  const invalidTokens: string[] = [];
  let lastError: string | null = null;

  try {
    const res = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip, deflate' },
      body: JSON.stringify(messages),
    });
    const json = await res.json().catch(() => null);
    const tickets: Array<{ status: string; message?: string; details?: { error?: string } }> =
      json?.data ?? [];

    if (!res.ok || tickets.length !== batch.length) {
      lastError = `expo_http_${res.status}`;
      failed.push(...batch.map((r) => r.id));
    } else {
      tickets.forEach((ticket, i) => {
        const row = batch[i];
        if (ticket.status === 'ok') {
          sent.push(row.id);
          return;
        }
        failed.push(row.id);
        lastError = ticket.message ?? ticket.details?.error ?? 'expo_error';
        if (ticket.details?.error === 'DeviceNotRegistered') invalidTokens.push(row.token);
      });
    }
  } catch (e) {
    lastError = (e as Error).message;
    failed.push(...batch.map((r) => r.id));
  }

  const { error: settleError } = await supabase.rpc('settle_push_batch', {
    p_sent: sent,
    p_failed: failed,
    p_error: lastError,
    p_invalid_tokens: invalidTokens,
  });
  if (settleError) return Response.json({ ok: false, error: settleError.message }, { status: 500 });

  return Response.json({ ok: true, claimed: batch.length, sent: sent.length, failed: failed.length });
});
