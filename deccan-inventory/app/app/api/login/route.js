import { NextResponse } from 'next/server';

// Roles:
//   APP_PASSWORD         -> admin  (existing password; can add/edit/delete set-ups)
//   APP_VIEWER_PASSWORD  -> viewer (optional; can view set-ups only)
//   APP_CPA_PASSWORD     -> cpa    (optional; cannot see the Set-ups page)
export async function POST(request) {
  const { password } = await request.json();
  let role = null;
  if (password) {
    if (password === process.env.APP_PASSWORD) role = 'admin';
    else if (process.env.APP_VIEWER_PASSWORD && password === process.env.APP_VIEWER_PASSWORD) role = 'viewer';
    else if (process.env.APP_CPA_PASSWORD && password === process.env.APP_CPA_PASSWORD) role = 'cpa';
  }
  if (!role) return NextResponse.json({ ok: false }, { status: 401 });
  const secret = process.env.APP_SESSION_SECRET;
  // admin keeps the original cookie value so existing sessions keep working
  const value = role === 'admin' ? secret : `${secret}.${role}`;
  const res = NextResponse.json({ ok: true, role });
  res.cookies.set('dd_auth', value, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
