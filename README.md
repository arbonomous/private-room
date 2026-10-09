# private-room

Private, end-to-end encrypted video rooms with live co-editing, no accounts, no server that sees content. Scoping stage only. Paper only, free infra only.

## Idea
A browser page like Google Meet where 2-4 friends join by link, talk on video, and edit code together. The room key lives in the URL fragment (after #), so no server ever receives it.

## Pieces (all free)
- Video and voice: WebRTC peer to peer (encrypted by default, DTLS-SRTP)
- Live co-editing: Yjs (CRDT) over y-webrtc, Monaco editor
- Signaling: one tiny Cloudflare Worker that only relays encrypted handshakes
- Relay for hard networks: Cloudflare Realtime TURN lists 1,000 GB/month free; unverified whether signup needs a card. v1 can ship with public STUN only and accept some failed connections.
- Cap rooms at 4 people for v1 (mesh video gets heavy beyond that)

## First slice (about a weekend)
1. One static page: create a room, copy the link
2. Two people join, video and voice, key in the link fragment
3. Shared code editor with both cursors
4. Proof: network tab shows the signaling server only saw handshakes, and code never left the two browsers

Not in v1: accounts, payments, chat history, screen share, strict no-server decentralization (DHT or Nostr signaling is a later option).

## Prior art
Jitsi (E2EE limited to Chromium browsers, does not cover chat), OpenCall, P2Pigeon, Quibble (small p2p encrypted call projects, no live co-coding), VS Code Live Share, Zed, Replit, Google Meet (all server mediated).

## Money
Unlikely to earn soon: free private chat tools already exist. Best case is dev teams that cannot send code through Google or Microsoft. Treat as a build-for-fun and reputation project.
