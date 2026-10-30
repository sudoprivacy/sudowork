# Browser mode selection before startup

Moss 0.1.92 keeps profile ownership unchanged during passive state reads. An
explicit Start action associates the owner's browser with the selected
conversation. This also applies when an ended conversation remains the recorded
holder of a stopped browser.

The shared Desktop/WebUI panel exposes the launch mode and connection settings
before that action. Choosing a windowed browser must send `isHeadless: false` in
the first Start request. The panel must not start a headless browser and require
a second, confirmed restart to reach the requested mode.

Before the first session state arrives, the panel has no capability information.
It therefore withholds the server-upgrade warning until it has an actual session
whose capabilities require that warning. Profile ownership and input exclusion
continue to be enforced by the host.

The model's browser tools continue to choose headless/windowed mode from the task
and available capabilities. These panel settings describe an explicit user
startup request, without changing the model's policy or the normal Stop/chat
continuation flow.

## Regression coverage

- The component test covers both extension and CDP mode selection before an
  ended profile is claimed. Both cases fail against the earlier component and
  pass after the change. It also verifies that no restart request is sent.
- The live WebUI journey reads ownership, requires a stopped browser and an
  explicitly listed predecessor fixture, and uses the visible mode selector
  before Start. It then runs the existing refresh, exact clipboard, Chinese
  input, persistent-login and real-model checks.
- A successful component check does not qualify the published application or
  physical phone. The wider release gates remain in
  [browser joint acceptance](browser-joint-acceptance.md).
