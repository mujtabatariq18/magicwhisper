# MagicWhisper Update Mechanism

MagicWhisper now updates through GitHub Releases using `electron-updater`.

## How Users Update

- Installed apps check for updates after startup.
- The tray menu item `Check for updates...` runs a live update check.
- If a newer release exists, MagicWhisper prompts to download it.
- After download, MagicWhisper prompts to restart and install.
- App data stays in `%APPDATA%\MagicWhisper`, so settings, history, dictionary, snippets, models, and logs are preserved.

## How To Publish A Future Update

1. Make the code changes.
2. Bump the version:

   ```powershell
   npm version 1.0.3 --no-git-tag-version
   ```

3. Commit and push to GitHub.
4. Create and push a matching tag:

   ```powershell
   git tag v1.0.3
   git push origin v1.0.3
   ```

5. GitHub Actions builds the Windows installer and publishes release assets.
6. Existing installed apps can then detect the release from `Check for updates...`.

## Important Notes

- Keep `build.appId` as `com.magicwhisper.app`; changing it makes Windows treat the app as a different application.
- Keep `build.productName` as `MagicWhisper`; changing it can change install paths.
- Do not store API keys or signing certificates in source code.
- Public GitHub Releases are the simplest updater source. Private releases require authenticated download handling and are not suitable for general auto-update without extra infrastructure.
