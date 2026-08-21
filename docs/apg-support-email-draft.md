# DRAFT ONLY — not sent. Review and send manually if desired.

**To:** Bank Alfalah APG sandbox support
**Subject:** Bank Alfalah APG Sandbox Transaction Assistance — Hoja Seeds

Hello,

We are integrating Alfa Payment Gateway (sandbox) for our website
**www.hojaseeds.pk**. Our redirect-based handshake/SSO/hosted-checkout
flow is working correctly — we have successfully completed real sandbox
payments end-to-end (e.g. transaction IDs 344409383448 and 350718941234
on 2026-08-21, using the documented sample credit card).

We are unable to reach the documented Order Status Inquiry endpoint
(`{base}/HS/api/IPN/OrderStatus/{merchantId}/{storeId}/{orderId}`) from
our **server-side** integration (Google Apps Script). Every attempt
fails at the network/connection level (no HTTP response received at
all — "Address unavailable") — this is distinct from a normal HTTP error
response. The same domain's other endpoints (`/HS/HS/HS`, `/SSO/SSO/SSO`,
and the hosted checkout pages) are reachable without issue from a
regular browser.

Could you confirm whether the status-inquiry API endpoint has any
IP-based access restriction (e.g. an allowlist that would need our
server's outbound range added), or any other server-side-specific
configuration that would explain this? We'd like to complete
authoritative payment-status verification via this endpoint (or confirm
the Listener/IPN callback is the intended primary mechanism instead).

Details (no credentials included):
- Store Name: Hoja Seeds
- Endpoint attempted: `https://sandbox.bankalfalah.com/HS/api/IPN/OrderStatus/...`
- Failure: connection-level ("Address unavailable"), reproducible, not a 4xx/5xx HTTP response
- Return URL: https://www.hojaseeds.pk/?hs_view=payment-return
- Listener URL: (existing registered Apps Script Listener)
- Date/time observed: 2026-08-21 (multiple attempts)
- Sample Order IDs affected: HOJA-YNL9OLALRD9QO54M, HOJA-PBIIEDR53EJP63Q5

Thank you,
Hoja Seeds Engineering
