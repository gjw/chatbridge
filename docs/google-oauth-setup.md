# Google OAuth Setup for Vocab Quiz App

One-time setup to get the Google Sheets quiz app working. Takes ~20 minutes.

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Click the project dropdown (top-left) → **New Project**
3. Name: `ChatBridge` → **Create**
4. Make sure it's selected in the dropdown

## 2. Enable Google Sheets API

1. Go to **APIs & Services → Library** (left sidebar)
2. Search "Google Sheets API"
3. Click it → **Enable**

## 3. Configure OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** → **Create**
3. Fill in:
   - App name: `ChatBridge`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue**
5. **Scopes** page → **Add or Remove Scopes**
   - Search for `spreadsheets.readonly`
   - Check `Google Sheets API .../auth/spreadsheets.readonly`
   - Click **Update** → **Save and Continue**
6. **Test users** page → **Add Users**
   - Add the real Google/Gmail account(s) you'll sign into during the demo
   - These are **real Google accounts**, completely separate from ChatBridge
     users. When a ChatBridge student clicks "Connect Google," a Google login
     popup opens and they sign in with their actual Gmail. Google checks if
     that Gmail is on this list. If not, it blocks them.
   - One Gmail account is enough for the demo — you can reuse it across all
     three ChatBridge users (admin, teacher, student).
   - No changes to ChatBridge seed data needed. The ChatBridge account and
     Google account are unrelated; the server just stores the resulting
     token keyed to whichever ChatBridge user triggered the flow.
   - Click **Save and Continue**
7. Click **Back to Dashboard**

> **Note:** In Testing mode, only the users you explicitly add here can
> authorize. This is fine — you never need to publish or verify the app
> for a class demo.

## 4. Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `ChatBridge Web`
5. **Authorized redirect URIs** — add both:
   - `http://localhost:3100/api/oauth/google/callback` (local dev)
   - `https://chatbridge.foramerica.dev/api/oauth/google/callback` (production)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## 5. Set environment variables

Add to your server environment (however you manage env vars — `.env`, PM2 ecosystem, etc.):

```
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx
```

For local dev, you can pass them inline:

```bash
GOOGLE_CLIENT_ID=xxxx GOOGLE_CLIENT_SECRET=xxxx pnpm dev:server
```

## 6. Re-seed the database

The google-quiz app needs to be registered:

```bash
pnpm --filter @chatbridge/server build
node server/dist/db/seed.js
```

## 7. Serve the app

**Production:** Nothing to do. Nginx already serves `apps/google-quiz/` as static
files, same as chess/wordle/quiz. Just pull the code, re-seed, and bounce PM2.

**Local dev only:**

```bash
npx serve apps/google-quiz -l 3205
```

## 8. Create a test flashcard sheet

1. Open [Google Sheets](https://sheets.google.com) with one of your test accounts
2. Create a new spreadsheet, name it something like "Chapter 5 Vocab"
3. Fill it in:

| A (Term) | B (Definition) | C (Hint) |
|---|---|---|
| Term | Definition | Hint |
| photosynthesis | Process by which plants convert light energy into chemical energy | Think about what plants need from the sun |
| mitochondria | Organelle that generates most of the cell's ATP | "Powerhouse of the ___" |
| osmosis | Movement of water across a semipermeable membrane from low to high solute concentration | Water moves toward the "saltier" side |
| chloroplast | Organelle where photosynthesis takes place in plant cells | Green because of chlorophyll |
| DNA | Deoxyribonucleic acid — molecule carrying genetic instructions | Double helix shape |

> Row 1 is treated as a header and skipped. Only columns A and B are required.

4. Click **Share** → set to "Anyone with the link can view" (or share with specific test accounts)
5. Copy the sheet URL

## 9. Test the flow

1. Start everything: `pnpm dev`, `pnpm dev:server`, `npx serve apps/google-quiz -l 3205`
2. Log in to ChatBridge as any user
3. Type: "I want to study some vocab"
4. The LLM should call `authorize_google` → click **Connect Google** → authorize in popup
5. When it asks for the sheet, paste the URL from step 8
6. The LLM loads the deck and starts quizzing

## Troubleshooting

**"Google OAuth not configured"**
→ `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` not set in the server environment.

**"Access blocked: ChatBridge has not completed the Google verification process"**
→ You're trying to authorize with an account that isn't in the test users list (step 3.6).

**"Not authorized or no access to this sheet"**
→ The sheet isn't shared with the account that authorized, or the OAuth token expired. Re-authorize.

**Popup opens but nothing happens after closing**
→ Check browser console for CORS errors. Make sure the redirect URI in Google Console matches exactly (including trailing slash — don't add one).

**"Google Quiz app not registered"**
→ Re-run the seed (step 6).
