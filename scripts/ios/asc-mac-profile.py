#!/usr/bin/env python3
"""Get the App Store provisioning profile for the Apple Distribution identity that sits in the Mac's keychain.

    asc-mac-profile.py <bundle id> <certificate serial, hex> <out .mobileprovision> [required entitlement ...]

xcodebuild -exportArchive with automatic signing wants a cloud-managed distribution certificate, which this API
key may not create ("Cloud signing permission error"), so the export signs manually: this script finds the
certificate on App Store Connect by serial number, reuses the ACTIVE IOS_APP_STORE profile "joyo-mac <bundle id>
<cert id>" or makes it, and writes the profile. A profile that is not ACTIVE (enabling a capability makes it INVALID), or
is ACTIVE but lacks one of the required entitlements, is deleted and recreated. Prints "<uuid>", a tab, "<profile name>". Uses ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH through omarchy-apple-dev's asc.py.
"""

import base64
import os
import plistlib
import sys
import urllib.parse
from pathlib import Path

oad = Path(os.environ.get("OMARCHY_APPLE_DEV", Path.home() / ".local/share/omarchy-apple-dev"))
sys.path.insert(0, str(oad / "tools"))
import asc  # noqa: E402

if len(sys.argv) < 4:
    sys.exit(__doc__)
bundle, serial, out = sys.argv[1], sys.argv[2].upper().lstrip("0"), Path(sys.argv[3])
required = sys.argv[4:]


def granted_entitlements(profile):
    """The Entitlements dict of a profile: the plist sits inside the CMS signature as plain XML."""
    data = base64.b64decode(profile["attributes"]["profileContent"])
    start, end = data.index(b"<?xml"), data.rindex(b"</plist>") + len(b"</plist>")
    return plistlib.loads(data[start:end]).get("Entitlements", {})


def usable(profile):
    if profile["attributes"]["profileState"] != "ACTIVE":
        return False
    have = granted_entitlements(profile)
    missing = [k for k in required if k not in have]
    if missing:
        print(f"profile '{profile['attributes']['name']}' lacks {', '.join(missing)}; recreating", file=sys.stderr)
    return not missing

certs = asc.call("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200")["data"]
found = [c for c in certs if c["attributes"].get("serialNumber", "").upper().lstrip("0") == serial]
if not found:
    sys.exit(f"no Apple Distribution certificate with serial {serial} on App Store Connect (revoked?)")
cert_id = found[0]["id"]

name = f"joyo-mac {bundle} {cert_id}"
listed = asc.call("GET", f"/v1/profiles?filter[name]={urllib.parse.quote(name)}&filter[profileType]=IOS_APP_STORE")["data"]
active = [p for p in listed if usable(p)]
for stale in listed:
    if stale not in active:
        asc.call("DELETE", f"/v1/profiles/{stale['id']}")
        print(f"deleted {stale['attributes']['profileState']} profile '{name}'", file=sys.stderr)
if active:
    profile = active[0]
else:
    profile = asc.call("POST", "/v1/profiles", {"data": {
        "type": "profiles",
        "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": asc.rel("bundleIds", asc.bundle_id(bundle)),
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        },
    }})["data"]
    print(f"created App Store profile '{name}'", file=sys.stderr)
    have = granted_entitlements(profile)
    still_missing = [k for k in required if k not in have]
    if still_missing:
        sys.exit(f"the new profile does not grant {', '.join(still_missing)}; enable the capability on the bundle id")
out.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(profile["attributes"]["uuid"], name, sep="\t")
