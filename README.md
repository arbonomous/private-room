# private-room

Private video calls and chat in a link. For up to 4 people. No account, no phone number, no app to install, nothing stored.

Live: https://arbonomous-private-room.pages.dev

## What you get
- Group video and voice, mute and camera toggles, screen share (desktop browsers)
- Encrypted text chat
- Encrypted file send (up to 25 MB, goes straight to the other people, never stored)
- Join by link, with an optional name. Works in current Chrome, Edge, Firefox and Safari.

## How it works
- Start a call and you get a link. The secret key is the part after the `#`. Browsers never send that part to any server.
- Video and voice go browser to browser over WebRTC (built-in DTLS-SRTP encryption). Chat, names and files go over WebRTC data channels, additionally sealed with AES-GCM using the key from the link. Each message is bound to its type, sender and recipient.
- Admission: when two browsers connect, each sends the other a fresh random challenge sealed with the room key. Nothing is shared and no media flows until the other side returns it correctly. Someone who guesses the room id but lacks the key gets nothing.
- A free public PeerJS broker (0.peerjs.com) introduces browsers to each other, and Google/Twilio free STUN servers help with NAT. They never see the key or your content. They do see that a connection is being made, and IP addresses (as with any WebRTC call).
- Nothing is stored anywhere. Close the tab and it is gone. The "Privacy check" panel in the call shows what was sent to the introduction server.

## Honest limits
- The cryptography here has **not been independently audited**. This is a small project, not a replacement for Signal or any audited tool. Do not use it where your safety depends on it.
- Anyone who has the full link can join, and can see and hear the call. Share the link only with people you trust, over a channel you trust. There is no user identity beyond the name people type.
- Peers connect directly, so people in the call can see each other's IP addresses. There is no relay server (TURN), so some strict networks (some corporate and cellular networks) may fail to connect.
- Up to 4 people. Screen share is not available on most phones.
- If someone's device is compromised, or they screenshot or record the call, no tool can stop that.

## Run it
```
npm install
node build.mjs        # makes dist/index.html, one self-contained file
node call-test.mjs    # two or three headless browsers: video, chat, mute, file, screen share, rejoin
node neg.mjs          # outsider without the key gets nothing
node reflect.mjs      # replayed/reflected admission messages are rejected
```
Deploy `dist/index.html` to any static host.

## Parked
An earlier version added a shared code editor, local AI and a game preview. That code (`src/main.js`, `src/index.html`, and friends) is still in the repo but is not built or shown. The app is now one thing: private calls and chat.
