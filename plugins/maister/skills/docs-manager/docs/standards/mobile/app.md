## Mobile App

### Touch Targets and Labels
Tap targets are at least 44x44 pt on iOS and 48x48 dp on Android, every icon-only control has an accessibility label (`accessibilityLabel`, `contentDescription`), and text sizes follow the user's setting (Dynamic Type, `sp`).

### Permissions in Context
Request a permission (location, camera, notifications) when the user starts the feature that needs it, not at launch, and check it again before each use. When it is denied, the rest of the app keeps working and the feature says what is missing.
