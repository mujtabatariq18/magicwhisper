# MagicWhisper

MagicWhisper is a Windows desktop voice dictation app built with Electron. It captures microphone audio from a global hotkey, transcribes through local Whisper or cloud transcription, cleans the text, and pastes it into the active application.

## Current Update Flow

MagicWhisper uses GitHub Releases and `electron-updater` for future app updates.

- The installed app checks for updates after startup.
- The tray menu has `Check for updates...`.
- New versions are published by pushing a `vX.Y.Z` tag.
- GitHub Actions builds the Windows installer and release metadata.

See [docs/update-mechanism.md](docs/update-mechanism.md) for the exact release steps.

## Build

```powershell
npm ci
npm run build:win
```

The Windows installer is written to `dist/`.

## Local Data

Installed app data is stored under `%APPDATA%\MagicWhisper`, so in-place installer updates keep existing settings, history, dictionary, snippets, models, and logs.
