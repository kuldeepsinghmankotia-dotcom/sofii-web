# WhatsApp setup

Sofii talks to Meta's WhatsApp Cloud API directly, not through a BSP
(Gupshup, AiSensy, Twilio). Direct adds no per-message markup, and Meta does
not charge for replies inside the 24-hour customer service window — which is
Sofii's entire usage pattern, so conversation traffic is free.

Until all four environment variables below exist, the webhook returns 404 and
the channel is simply off. Nothing else in the app changes.

## What you need

| Variable | Where it comes from |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | System user token (see below) |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup (the ID, not the number) |
| `WHATSAPP_APP_SECRET` | App settings → Basic → App Secret |
| `WHATSAPP_VERIFY_TOKEN` | You invent it; must match on both sides |

## Steps

1. **Create the app.** developers.facebook.com/apps → Create App → type
   **Business**. A brand-new Facebook account is often blocked from this;
   adding a phone number and enabling two-factor authentication usually
   clears it.

2. **Add WhatsApp** to the app. Meta provides a free test number, which can
   message up to five numbers you register — enough to develop against
   without business verification.

3. **Register your own number** under WhatsApp → API Setup → "To" → Manage
   phone number list. The test number cannot message you otherwise.

4. **Make the token permanent.** The token on the API Setup page expires in
   24 hours. business.facebook.com → Business settings → Users → System users
   → Add (role: Admin) → Add assets → your app, Full control → Generate new
   token → scopes `whatsapp_business_messaging` and
   `whatsapp_business_management`, expiry **Never**.

5. **Set the environment variables** locally in `.env.local` and on Vercel:

   ```bash
   vercel env add WHATSAPP_ACCESS_TOKEN production
   vercel env add WHATSAPP_PHONE_NUMBER_ID production
   vercel env add WHATSAPP_APP_SECRET production
   vercel env add WHATSAPP_VERIFY_TOKEN production
   vercel --prod
   ```

   The redeploy matters: environment changes do not reach a running
   deployment.

6. **Configure the webhook.** WhatsApp → Configuration → Edit:
   - Callback URL: `https://sofii-web.vercel.app/api/whatsapp/webhook`
   - Verify token: whatever you set as `WHATSAPP_VERIFY_TOKEN`

   Meta immediately performs a GET handshake against that URL. It will fail
   unless step 5 was deployed first.

   Then **subscribe to the `messages` field**. Without that subscription the
   webhook verifies successfully and then never receives anything, which is a
   confusing way to be broken.

## Connecting an account

A phone number in a webhook payload proves nothing on its own, so numbers are
bound to accounts explicitly:

1. Signed in on the web, open **WhatsApp** in the sidebar → **Get a linking
   code**.
2. Send that 6-character code to the WhatsApp number.

The code proves the account (it was issued to a signed-in session) and
sending it from the phone proves the number. Codes are single-use and expire
after 15 minutes.

## What works

- Text messages, with full memory, documents and tools
- Voice notes in — transcribed by Saaras, language auto-detected
- Voice notes out — spoken by Bulbul in the same language, alongside the text
- One rolling conversation per number, so context carries across messages

Images and documents over WhatsApp are not handled yet; Sofii says so rather
than ignoring them.

## Costs

Replies to a user who messaged first are free. You are only charged when
Sofii starts a conversation outside the 24-hour window — reminders and
briefings — billed as Utility messages (₹0.115 each in India, plus 18% GST).

## Verifying it works

The signature path can be exercised without Meta:

```bash
# Should echo the challenge
curl "https://sofii-web.vercel.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=TEST"

# Should return 403 — no valid signature
curl -X POST https://sofii-web.vercel.app/api/whatsapp/webhook -d '{}'
```

If the first returns 403, the verify token does not match. If it returns 404,
the environment variables have not reached the deployment.
