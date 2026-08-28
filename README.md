# Deccan Dental — Inventory App

A shared-password inventory app for dental supplies. Built with Next.js + Supabase,
deploys on Vercel. Scan a supply label's QR code to open its record; add, edit,
archive, or delete items; filter and sort by category, manufacturer, or supplier;
attach a photo of each item for quick visual identification.

## Environment variables

Set these four in Vercel (Project → Settings → Environment Variables), and in a
local `.env.local` file if you run it on your machine:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `APP_PASSWORD` | The shared password staff type to get in |
| `APP_SESSION_SECRET` | A long random string (already generated in `.env.example`) |

## Deploy

1. Run `01_supabase_setup.sql` in the Supabase SQL Editor first (creates the table,
   imports the 225 supplies, and makes the `item-images` storage bucket).
2. Put this project in a GitHub repo.
3. In Vercel, import the repo, add the four environment variables above, and deploy.
4. Open the URL, enter the password, and you're in.

## Notes

- The security rules in the SQL are a temporary dev setting. Once the app works,
  tighten them so only the app can read/write.
