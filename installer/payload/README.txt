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

FAMILY SETUP AND ACCESS
-----------------------
After release activation, a caregiver signs in and creates their family and
patient. The creator becomes the Primary caregiver. Other caregivers request
access with a Family Code and a verified email. The Primary reviews requests,
roles, and patient assignments in Settings > Family Access. The host terminal
does not assign family roles.

Google must be enabled under Firebase Authentication > Sign-in method, and
maymay.local must be listed under Authentication > Settings > Authorized domains.

If MayMay displays a setup or maintenance state, ask the release operator to
complete the separately reviewed activation procedure. Ordinary host startup
does not modify Firestore data or publish rules.

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

UPDATES
-------
In the MayMay Host terminal, type "update" to check GitHub. If an update is
available, type "update" again to verify it, install it, and restart MayMay.
