MAYMAY LOCAL HOST
=================

Start MayMay from the desktop shortcut or Start-MayMay.cmd.

Caregiver address:
  http://maymay.local/

All caregiver devices must be on the same local network as this computer.
If local-name discovery is blocked by the router, use the numbered fallback
address printed by the MayMay Host terminal.

FIREBASE ADMIN KEY
------------------
The Firebase Admin JSON is never included in the installer. Use
Set-Firebase-Key.cmd to select the key after installation. It stays on the host
computer and must never be sent to caregivers or placed in the web browser.

REGISTER A CAREGIVER
--------------------
The caregiver opens http://maymay.local/ and selects Continue with Google. Their
Google account is registered automatically the first time. After registration,
enter "users" in the host terminal, then approve the account with:
  caregiver caregiver@example.com
The new account cannot read care information until the host approves it.

Google must be enabled under Firebase Authentication > Sign-in method, and
maymay.local must be listed under Authentication > Settings > Authorized domains.

OFFLINE INSTALLATION
--------------------
This package installs without downloading Node.js or application dependencies.
MayMay still needs an outside internet connection while running to sign users
in and synchronize with Firebase. The local network lets phones, tablets, and
computers reach the host.

WINDOWS FIREWALL
----------------
On first launch, allow Node.js on Private networks when Windows asks. Do not
enable it for Public networks.
