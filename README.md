# private-room

Video rooms with a live shared code editor for 2-4 people. No accounts, free infrastructure only.

## How it works
- The room key is in the link after the `#`. Browsers never send that part to any server.
- Video and voice go browser to browser over WebRTC (built-in DTLS-SRTP encryption). Code edits (Yjs) and cursors go over WebRTC data channels, additionally sealed with AES-GCM using the room key.
- A free public PeerJS broker (0.peerjs.com) introduces browsers to each other. Google's free STUN server helps with NAT. Neither sees the key or your content.
- Admission: when two browsers connect, each sends a random challenge sealed with the room key and must return the other side's challenge. Until that passes, the connection is dropped after 8 seconds, takes no room slot, receives no data, and no video or voice is sent or accepted.
- The page includes a live "Privacy check" panel counting what was sent to the broker.

## Limits (be honest about these)
- Max 4 people. No TURN relay, so strict networks may fail to connect.
- The broker sees peer ids derived from a hash of the key, plus IP addresses and connection setup data (SDP). A malicious broker could disrupt or block rooms, or occupy free slot ids, but cannot read content without the key. Because video and voice rely on WebRTC's own key exchange carried through the broker, a malicious broker could in theory impersonate a peer for video and voice. Code data is protected by the room key either way.
- Anyone with the full link can join. Share it privately.
- Tested in desktop Chromium only.

## Build and test
```
npm i
node build.mjs     # writes dist/index.html (single file)
node test.mjs      # 3 browsers: join, video, edit sync, leave and rejoin, network capture
node neg.mjs       # outsider who knows peer ids but not the key: no media, no slot, no content
```
Set `URL0=https://...` for neg.mjs to test a deployed copy. Deployed as a single static file on Cloudflare Pages.
