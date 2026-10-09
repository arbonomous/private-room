# mut3d (working name)

The repo is still called private-room.

Private video calls and chat in a link. For up to 4 people. No account, no phone number, no app to install, nothing stored.

Live: https://arbonomous-private-room.pages.dev

## What you get
- Group video and voice, mute and camera toggles, screen share (desktop browsers)
- Encrypted text chat
- Encrypted file send (up to 25 MB, goes straight to the other people, never stored)
- Host approval: by default people who open your link wait until you tap "Let in". Nothing (video, chat, files) flows to or from them until then.
- Verify this call: both sides see the same 5 symbols; read them aloud to confirm nobody is intercepting the call between your two devices.
- End room for everyone: wipes chat and files from every open tab and closes all connections. Optional auto-close timer (1, 4 or 24 hours).
- Join by link, with an optional name. Works in current Chrome, Edge, Firefox and Safari.

## How it works
- Start a call and you get a link. The secret key is the part after the `#`. Browsers never send that part to any server.
- Video and voice go browser to browser over WebRTC (built-in DTLS-SRTP encryption). Chat, names and files go over WebRTC data channels, additionally sealed with AES-GCM using the key from the link. Each message is bound to its type, sender and recipient.
- Admission: when two browsers connect, each sends the other a fresh random challenge sealed with the room key. Nothing is shared and no media flows until the other side returns it correctly. Someone who guesses the room id but lacks the key gets nothing.
- A free public PeerJS broker (0.peerjs.com) introduces browsers to each other, and Google/Twilio free STUN servers help with NAT. They never see the key or your content. They do see that a connection is being made, and IP addresses (as with any WebRTC call).
- Nothing is stored anywhere. Close the tab and it is gone. The "Privacy check" panel in the call shows what was sent to the introduction server.

## Honest limits
- Host approval, the burn button and the auto-close timer are enforced by each person's browser running this code. They protect against people without the link and honest clients. Someone with the link who runs modified code could ignore them, and anyone can screenshot or record.
- "Verify this call" detects someone intercepting the call between two devices. It does not prove who the person is.
- The host's signing key lives in the host's own address bar (the part after the #, not in the invite link). If the host refreshes, the page keeps working; if the host loses that tab's address they lose host rights.
- The cryptography here has **not been independently audited**. This is a small project, not a replacement for Signal or any audited tool. Do not use it where your safety depends on it.
- Anyone who has the full link can join, and can see and hear the call. Share the link only with people you trust, over a channel you trust. There is no user identity beyond the name people type.
- Peers connect directly, so people in the call can see each other's IP addresses. A small free relay (TURN, from metered.ca) is used only as a fallback when a direct connection fails. The relay passes encrypted media and chat, so it sees IP addresses and timing but not content. It is a small free tier (500 MB, shared, no guarantee), so a very strict network may still fail to connect.
- Up to 4 people. Screen share is not available on most phones.
- If someone's device is compromised, or they screenshot or record the call, no tool can stop that.

## Run it
```
npm install
node build.mjs        # makes dist/index.html, one self-contained file
node call-test.mjs    # two or three headless browsers: video, chat, mute, file, screen share, rejoin
node approve-test.mjs # host approval, impostor host, verify codes, burn, expiry
node neg.mjs          # outsider without the key gets nothing
node reflect.mjs      # replayed/reflected admission messages are rejected
```
Deploy `dist/index.html` to any static host.

## Parked
An earlier version added a shared code editor, local AI and a game preview. That code (`src/main.js`, `src/index.html`, and friends) is still in the repo but is not built or shown. The app is now one thing: private calls and chat.

## Feedback

"Send feedback" (home screen and More menu) sends one short note to the builders. The sheet shows the exact text before you tap Send. It contains only: worked / didn't work, your note, and, only if you tick the box, the app version, browser string and screen size. It never includes the room link or key, names, chat, files or anything about a call. Your network address is used only to limit spam (a salted hash kept for under an hour) and is not stored with the feedback. Notes are deleted after 60 days. Storage is a free Cloudflare D1 table written by `_worker.js`.

## Voice disguise

More menu > Voice disguise: Off (default), Deeper, Higher, Robot. It runs in your own browser on your microphone before the audio is sent, so the others hear the changed voice. It is a disguise, not anonymity: people can still recognise you by what you say and how you talk. "Hear myself" is off by default (use headphones, or you get echo). If the browser blocks audio processing, the call carries on with your normal voice. Effects use some battery on phones.


## Connection fallback

`/turn` (a Cloudflare Pages Function) hands the browser short-lived relay credentials (30 minutes). The long-lived secret stays on the server. The endpoint only answers same-site requests and is rate limited. The browser tries a direct path first and uses the relay only if that fails. `relay-test.mjs` forces relay-only and sends data through it.
