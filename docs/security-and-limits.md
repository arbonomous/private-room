# Security model and honest limits

**The cryptography in mut3d has not been independently audited.** It is a small project, not a replacement for Signal or any audited tool. Do not use it where your safety depends on it.

## What it tries to do
- Keep the room key out of every server: it lives after the `#` of the link.
- Keep call content between the browsers in the call: WebRTC media is DTLS-SRTP encrypted, and chat, names and files are additionally sealed with AES-GCM bound to message type, sender and recipient.
- Make people prove they hold the key before anything flows (fresh random challenge, sealed with the room key).
- Store nothing about calls.

## Limits
- Host approval, the lock, the waiting list and "End room for everyone" are enforced by each person's browser running this code. They protect against people without the link and against honest clients. Someone with the link who runs modified code could ignore them, and anyone can screenshot or record.
- "Verify this call" detects interception between two devices. It does not prove who a person is.
- The host's signing key lives in the host's own address bar (the part after the `#`, not in the invite link). If the host loses that tab's address they lose host rights. Lock and the waiting list live in the host's browser, so if the host closes the tab nobody is admitted.
- Anyone with the full link can knock, and can see and hear the call once let in. Share the link only over a channel you trust. There is no identity beyond the name people type.
- Peers connect directly, so people in a call can see each other's IP addresses. A small free relay (metered.ca TURN, 500 MB trial tier) is used only as a fallback. It sees IP addresses and timing, not content. A strict network may still fail to connect.
- Up to 6 people. Screen share is not available on most phones.
- Face and voice effects are disguises, not anonymity.
- If a device is compromised, no tool can help.
- Face and background-blur model licences were not independently verified; `@mediapipe/tasks-vision` is Apache-2.0.
