import { NextResponse } from 'next/server';

export async function POST(request) {
  const { password } = await request.json();
  if (password && password === process.env.APP_PASSWORD) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('dd_auth', process.env.APP_SESSION_SECRET, {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}
