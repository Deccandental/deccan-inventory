import { NextResponse } from 'next/server';

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login')
  ) {
    return NextResponse.next();
  }
  const token = request.cookies.get('dd_auth')?.value;
  const secret = process.env.APP_SESSION_SECRET;
  if (
    secret && token &&
    (token === secret || token === `${secret}.viewer` || token === `${secret}.cpa`)
  ) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
