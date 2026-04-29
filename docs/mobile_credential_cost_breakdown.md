# Mobile Credential Cost Breakdown — Apple Wallet Required

## Cost buckets you should expect

| Cost bucket | What it covers | Avoidable? | Notes |
|---|---|---:|---|
| Wallet-capable reader hardware | HID Signo, STid Architect Blue, or other Apple Wallet-compatible reader | No | Reader must support Apple's supported access credential path and vendor mobile credential ecosystem. |
| Reader configuration / credential format setup | Reader programming, OSDP/Wiegand output, facility/site code, reader manager tools | Usually no | Often done by integrator/reseller. |
| Mobile credential platform | HID Mobile Access / HID Origo, STid Mobile ID, SwiftConnect, Genea, Kisi, etc. | No, if Apple Wallet is mandatory | This is the provisioning layer that lets credentials be issued to Wallet. |
| Per-user or per-credential fees | Wallet/mobile IDs, replacements, temporary guests | Usually no | Pricing varies by reseller and contract. Ask for both annual and perpetual options. |
| Integration/API access | API access to sync credential IDs/status into your Pi database | Maybe | For a small HOA, CSV/manual sync may be cheaper than API access. |
| Physical card/fob backup | DESFire EV3 cards/fobs | Optional but strongly recommended | Gives access when phone battery/account provisioning fails. |
| Support/maintenance | Reseller support, firmware updates, lost phone workflows | Usually no | Critical for an HOA deployment. |

## Low-cost recommendation

Use Apple Wallet credentials only for residents who request mobile access, and issue DESFire EV3 cards/fobs as the default credential. This limits recurring mobile credential cost while preserving a modern user experience.

## Questions to ask vendors/resellers

1. Is Apple Wallet support included for this exact reader model and firmware?
2. Is Apple Watch included with the iPhone credential or billed separately?
3. Are credentials billed one-time, annually, or per active user?
4. What happens when a resident replaces their phone?
5. Can we export or API-sync the issued credential identifier to a Raspberry Pi controller?
6. Can the reader output a stable credential ID over OSDP/Wiegand that our Pi can validate?
7. Can the gate continue working locally if the internet is down?
8. Are guest/temporary passes billed differently from resident credentials?
9. Are there minimum license quantities?
10. Is HID Origo / Mobile Access / Wallet provisioning included or separate?
