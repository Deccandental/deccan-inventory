import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Runs daily via Vercel Cron (see vercel.json). Emails a reminder about the
// next scheduled inventory count: coming up, due today, or past due.
export async function GET(request) {
  // If CRON_SECRET is set, only allow Vercel's cron (it sends this header).
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: 'supabase env missing' }, { status: 500 });
  const supabase = createClient(url, key);

  const { data, error } = await supabase.from('inventory_sessions').select('*')
    .eq('status', 'scheduled').order('scheduled_date', { ascending: true }).limit(1);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const sess = data && data[0];
  if (!sess || !sess.scheduled_date) return NextResponse.json({ ok: true, sent: false, reason: 'no scheduled count' });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sched = new Date(sess.scheduled_date + 'T00:00:00');
  const daysUntil = Math.round((sched - today) / 86400000);
  const before = parseInt(process.env.REMINDER_DAYS_BEFORE || '3', 10);

  let stage = null, tone = '#e8622a';
  if (daysUntil === before) stage = `coming up in ${before} day${before === 1 ? '' : 's'}`;
  else if (daysUntil > 0 && daysUntil < before && daysUntil === 1) stage = 'coming up tomorrow';
  else if (daysUntil === 0) { stage = 'due today'; tone = '#e8622a'; }
  else if ([-1, -3, -7, -14].includes(daysUntil)) { stage = `past due by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'}`; tone = '#b4231f'; }

  if (!stage) return NextResponse.json({ ok: true, sent: false, daysUntil });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'RESEND_API_KEY not set' }, { status: 500 });

  const from = process.env.REMINDER_FROM || 'Deccan Inventory <noreply@mydeccandental.com>';
  const to = (process.env.REMINDER_RECIPIENTS || 'info@mydeccandental.com').split(',').map((s) => s.trim()).filter(Boolean);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://deccan-inventory.vercel.app';
  const niceDate = sched.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const who = sess.assigned_to ? `Assigned to: <b>${sess.assigned_to}</b>` : 'No one assigned yet';

  const subject = `Inventory count ${stage} — ${niceDate}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#3a3a3a">
      <div style="border-bottom:3px solid #e8622a;padding-bottom:10px;margin-bottom:16px">
        <span style="font-size:18px;font-weight:700;color:#5a5a5a">Deccan Dental — Inventory</span>
      </div>
      <p style="font-size:16px">The inventory count is <b style="color:${tone}">${stage}</b>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0">
        <tr><td style="padding:6px 0;color:#888">Scheduled</td><td style="padding:6px 0"><b>${niceDate}</b></td></tr>
        <tr><td style="padding:6px 0;color:#888">Assigned</td><td style="padding:6px 0">${sess.assigned_to || '—'}</td></tr>
      </table>
      <a href="${appUrl}" style="display:inline-block;background:#e8622a;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">Open the inventory app</a>
      <p style="color:#999;font-size:12px;margin-top:24px">${who}. You're getting this because a count is scheduled in the Deccan inventory app.</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ ok: false, error: body }, { status: 500 });
  return NextResponse.json({ ok: true, sent: true, stage, to, daysUntil });
}
