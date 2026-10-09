# Buyback Operations Dashboard

A small operations dashboard for an electronics buyback workflow. It covers appointment scheduling, customer communication, device intake, invoice pricing, and payout tracking.

## What it includes

- meetup scheduling and appointment flow
- customer records and inbound communication threads
- device intake and inventory tracking by IMEI or serial
- pricing and invoice workflows
- P/L and cash-flow views
- admin settings for booking and inventory rules

## Stack

- Next.js 15 (App Router)
- Supabase for auth, Postgres, and realtime
- Twilio for optional SMS and voice features
- a device lookup service for identifying devices during intake

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in your own values:

   ```bash
   cp .env.example .env.local
   ```

3. Start the local Supabase stack:

   ```bash
   supabase start
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

## Notes

This repository is a sanitized public version of a private internal tool. It is intended to demonstrate the project structure and application logic without exposing production configuration, business data, or deployment details.

## License

This public repository is shared for demonstration purposes. If you want to reuse it commercially, check the licensing status of the original private project before publishing or distributing derived work.
