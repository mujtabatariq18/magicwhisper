# MagicWhisper Android Parity Blueprint

Date: 2026-05-29

## Goal

Build a native Android app that behaves like the desktop MagicWhisper app and follows the Wispr Flow-style mobile flow:

- Floating dictation bubble over any app.
- Microphone capture only while recording.
- Accessibility-service text insertion into the active field.
- Dictation history, dictionary, snippets, styles, and developer mode.
- Copy-to-clipboard affordance after dictation.
- Settings for microphone, language, transcription engine, bubble size, and opacity.

## Required Android Architecture

Electron cannot ship this experience on Android. Use a native Android project:

- Language: Kotlin.
- Minimum OS: Android 13, target current Android SDK.
- UI: Jetpack Compose for the main app.
- Background input: Foreground service with microphone notification.
- Cross-app text insertion: AccessibilityService.
- Floating control: SYSTEM_ALERT_WINDOW overlay service.
- Transcription: cloud-first API mode plus optional on-device model later.
- Local storage: Room for history/snippets/dictionary/styles, DataStore for settings.

## Runtime Permissions

The app must guide the user through these setup gates:

- Microphone permission.
- Display over other apps.
- Accessibility service enabled.
- Post notifications on Android 13+.
- Battery optimization exclusion, recommended but not blocking.

## Core User Flow

1. User opens MagicWhisper Android.
2. Setup wizard verifies microphone, overlay, accessibility, and notification permissions.
3. User taps the floating bubble in any app.
4. Bubble changes to recording waveform and foreground notification becomes active.
5. Audio streams to the transcription engine.
6. User taps the bubble again to stop.
7. Text is processed through dictionary, snippets, style, and developer mode.
8. Accessibility service inserts text into the focused field.
9. Bubble shows success, then a temporary copy button for 5 seconds.
10. History and usage stats update in the app.

## Feature Parity Checklist

- Home hub: stats, recent activity, history.
- Any-app dictation through accessibility insertion.
- Dictionary with manual terms and corrections.
- Snippets with search/filter and text expansion.
- Styles by app category: Personal, Work, Email, Other.
- Developer mode: jargon, camelCase, snake_case, acronyms, file references.
- 100+ language selector with auto-detect option.
- Floating bubble appearance: size and opacity.
- Copy last transcript button after completion.
- Secure settings storage for API keys.
- Error states for missing mic/accessibility/overlay permissions.

## Implementation Phases

1. Create native Android shell with Compose navigation and settings storage.
2. Build setup wizard and permission diagnostics.
3. Build overlay service and foreground microphone service.
4. Add audio capture and transcription API client.
5. Add AccessibilityService insertion.
6. Port text processing rules from desktop JavaScript to shared Kotlin logic.
7. Add history, dictionary, snippets, styles, and developer mode UI.
8. Run device QA across Android 13, 14, 15, and 16; include OEM battery restriction checks.

## Important Constraint

The Android version cannot be "exactly the same" at the implementation layer because Android requires AccessibilityService and overlay permissions for cross-app dictation. It can match the user-facing flow and feature set.
