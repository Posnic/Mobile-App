# Published shop wording

The connected POS server is the authority for published Language & labels
profiles. Mobile POS reads `/api/mobile/v1/wording?locale=<selected language>`
using its existing mobile session. The server derives the shop, branch and staff
from that session; the app rejects a bundle with a different scope or locale.
Credentials are pinned to the selected server before making the request.

Only exact registered English source strings are replaced. Product names,
customer data, notes, machine keys and financial values are not searched or
rewritten. Missing, ambiguous or incompatible labels use bundled wording.
Servers without this endpoint keep the existing app usable with bundled labels.

The cache includes server, shop, branch, staff and language. Locked/training
screens do not consume it, sign-out and leaving training clear it, and delayed
responses from a prior scope cannot replace the current map. Refresh occurs on
entry, foreground and once per foreground minute. Transient failures retain
accepted same-scope wording without blocking sales. Revocation or a missing
endpoint clears it.

At checkout the existing atomic sale write captures the device receipt's
registered headings in `receiptWording`. Reprinting uses that saved wording.
This is local print metadata, excluded from the uploaded financial command.
The server independently captures its invoice wording at authoritative creation.
An offline device receipt and a server invoice created after later sync may
therefore retain different wording revisions; neither rewrites the other's
historical labels. No credentials or print jobs are replicated by this feature.

Validation covers exact matching, placeholder fallback and persisted checkout/
receipt wording, plus the existing mobile checks and web build. Physical devices
and printers remain a separate release verification step.
