# Relay (TURN) usage and options

mut3d connects people directly when it can. A relay server is only a fallback for strict networks (some cellular carriers, corporate Wi-Fi). Relayed traffic is still end-to-end encrypted; the relay only sees encrypted packets.

## How it works now

- The app asks its own server (`/turn`) for short-lived relay credentials, same-origin only and rate limited.
- The relay is the free trial of a hosted TURN service: 0.5 GB per month, no card on file.
- The server checks the quota. When 95% is used, it stops handing out credentials and the app shows a one-time "free relay is busy this month" message if a connection cannot be made. If the usage check itself fails, it fails open (keeps working as before).

## If the free quota runs out

Card-free options, none of them set up yet:

- Wait for the monthly reset (the app keeps working for everyone who can connect directly).
- Run your own TURN server (for example coturn) on a free host. Needs a host that gives a public IP without a card, which I have not verified.

Options that need a card (not enabled): the 20 GB paid plan of the same service, or Cloudflare's TURN service. Say so before anything is switched on.

## Not tested

- Behavior at exactly 95% of the quota has not been seen with real traffic. It was checked against the usage API response only.
- Real phones on strict cellular networks.
