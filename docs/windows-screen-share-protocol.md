# Windows interactive screen-share protocol (proposal)

This protocol is intentionally consent-first. It is not operational until the Windows interactive-session companion, relay routing, and desktop integration are all implemented and tested.

## Session lifecycle

1. The desktop client sends a `command` action `start_screen_share` with a requested width, height and frame rate.
2. The Windows companion displays a persistent local banner and asks the signed-in user to approve sharing. No frame may be captured before approval.
3. On approval, the companion sends `screen_share_started`. It captures only the current interactive desktop, not the lock screen or secure desktop.
4. JPEG frames are sent as binary WebSocket messages. The companion must cap frame size, clamp dimensions to supported values, and enforce the requested frame-rate limit.
5. Either side can send `stop_screen_share`. The companion immediately stops its capture timer, releases capture resources, and acknowledges with `screen_share_stopped`.
6. Disconnect, logoff, session lock, user denial, or an authorization expiry must stop sharing and clear the persistent indicator.

## Request fields

- `width`: one of 854, 1280, 1600, 1920
- `height`: one of 480, 720, 900, 1080
- `fps`: 1, 5, 10, or 15
- `format`: `jpeg`
- `requireLocalConsent`: must be `true`

The relay must authenticate both endpoints, allow only the desktop to request start/stop, route only within the paired Windows session, reject stale command timestamps and invalid settings, and limit binary frames to a conservative maximum. Do not allow generic binary messages from an unpaired client. Tokens must never be logged or exposed to the UI.

## Implementation status

- Desktop panel component: added as `apps/desktop/src/components/ScreenSharePanel.tsx`.
- Styles: added as `apps/desktop/src/components/screen-share.css`.
- Not yet wired into `App.tsx` or the current relay protocol.
- Windows interactive-session capture companion and automated build/tests are still required. Do not describe screen sharing as working until these pieces are completed and tested end to end.
