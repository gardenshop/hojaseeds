# DRAFT ONLY — not sent. Review and send manually if desired.

**To:** Bank Alfalah APG sandbox support
**Subject:** Bank Alfalah APG Sandbox IPN/Listener Whitelist Assistance — Hoja Seeds

Hello,

We are integrating Alfa Payment Gateway (sandbox) for our website
**www.hojaseeds.pk** using Page Redirection ChannelId 1001. Handshake, SSO,
hosted checkout, Return, and two real sandbox card payments succeeded. Bank
transaction IDs were **344409383448** and **350718941234** on 2026-08-21;
both were PKR 470.00 and the Bank OrderStatus response reports `Paid`.

We are unable to reach the documented Order Status Inquiry endpoint
(`https://sandbox.bankalfalah.com/HS/api/IPN/OrderStatus/{MerchantId}/{StoreId}/{OrderId}`)
from our **server-side** Google Apps Script integration. The exact URL returns
HTTP 200 JSON with `ResponseCode=00` and `TransactionStatus=Paid` from an
external/browser request and from local network testing, but Apps Script fails
at connection level with **"Address unavailable"** and receives no HTTP
response. The Listener endpoint itself returns HTTP 200 `OK`, but Hoja cannot
complete the status GET from Apps Script.

Please confirm:
1. Hoja's Listener URL is whitelisted for sandbox IPN.
2. The sandbox OrderStatus endpoint is active for this Store.
3. Whether Google Apps Script/Google outbound infrastructure requires
   source-IP whitelisting or another network exception.
4. Whether the Listener is expected to receive `url=<OrderStatus URL>` as
   stated in the official guide.
5. Whether any additional sandbox IPN activation is required.

Details (no credentials included):
- Store Name: Hoja Seeds
- Merchant ID: 15248
- Store ID: 567250
- Endpoint attempted: `https://sandbox.bankalfalah.com/HS/api/IPN/OrderStatus/15248/567250/{OrderId}`
- Failure: connection-level ("Address unavailable"), reproducible, not a 4xx/5xx HTTP response
- Return URL: https://www.hojaseeds.pk/?hs_view=payment-return
- Listener URL: https://script.google.com/macros/s/AKfycbz2OLBzz6igtHiGlVmC3b4ANqmjikDbninRqYlTqiUC9a6PtnZD23bdwsWmMGd4pK0/exec?action=bankAlfalahListener
- Date/time observed: 2026-08-21, approximately 19:26–19:28 PKT
- Sample Order IDs: HOJA-YNL9OLALRD9QO54M, HOJA-PBIIEDR53EJP63Q5
- Bank transaction IDs: 344409383448, 350718941234

Thank you,
Hoja Seeds Engineering
