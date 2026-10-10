# Testing

All tests drive real headless Chromium browsers with Playwright against the built `dist/index.html`. Run them from the repository root after `npm install` and `npm run build`.

```
npm test                 # runs the whole suite in order
node tests/neg.mjs       # a single test
```

| Test | Checks |
| --- | --- |
| `call-test.mjs` | Three browsers: video, chat, mute, camera off, file transfer, screen share, leave and rejoin |
| `approve-test.mjs` | Host approval, impostor host, verify codes, end room, auto-close |
| `neg.mjs` | Someone without the key gets nothing |
| `reflect.mjs` | Replayed or reflected admission messages are rejected |
| `lock-test.mjs` | Room lock, waiting list, QR and short link |
| `rejoin-test.mjs` | Dropping and rejoining |
| `relay-test.mjs` | Relay-only path carries data |
| `voice-test.mjs` | Voice disguise options |
| `face-test.mjs`, `face-real-test.mjs` | Face effects; the second needs a face video at `/tmp/face.y4m` |
| `bg-test.mjs` | Background blur and theme toggle |
| `fb-test.mjs`, `fb-ui-test.mjs` | Feedback endpoint and sheet |
| `diag-test.mjs` | App version and privacy-check panel |

Headless tests cannot cover real phones: the native share sheet, QR scanning with a camera, cutout speed on older iPhones, or six or more people at once. Those are tested by hand and marked as untested in the README until someone has done it.
