import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const token = cookies().get('dd_auth')?.value || '';
  const secret = process.env.APP_SESSION_SECRET || '';
  let role = 'none';
  if (secret && token === secret) role = 'admin';
  else if (secret && token === `${secret}.viewer`) role = 'viewer';
  else if (secret && token === `${secret}.cpa`) role = 'cpa';
  return NextResponse.json({ role });
}
