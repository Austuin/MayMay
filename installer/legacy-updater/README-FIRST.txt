MAYMAY LEGACY UPDATER
=====================

Use this once on a computer running an older MayMay version that does not have
the "Check for updates" command.

1. Extract the entire MayMay-Legacy-Updater.zip file.
2. On the MayMay host computer, double-click Update-MayMay.cmd.
3. Keep the blue-on-black window open while it downloads and installs MayMay.
4. MayMay restarts when the update finishes.

The updater finds the existing MayMay installation automatically. If MayMay was
installed in a custom folder, it asks for that folder. It downloads the latest
release from https://github.com/Austuin/MayMay, verifies its SHA-256 checksum,
preserves the local Firebase Admin key, and adds permanent host updates.

Internet access is required for this one-time update. Do not add or email a
Firebase Admin JSON file with this updater.

