# 1top mobile v1.3.0 (preview)

Adds an explicit connection-server field on sign-in and Settings. A mobile credential is bound to its relay; switching servers requires signing out. Sign-in validates the selected server before saving the credential, and live connection tickets cannot redirect to another socket origin.

- Android: signed APK for direct installation, signed AAB for Play Console upload preparation. Both use the existing upload certificate.
- iOS: development archive and IPA, installed and launched on a paired physical iPhone. These are not public App Store or TestFlight artifacts.
- Mobile TypeScript and lint checks pass. Physical-device Google sign-in, remote controls, and store submission are separate checks and are not implied by a successful build or launch.
