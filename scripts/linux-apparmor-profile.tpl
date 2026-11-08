abi <abi/4.0>,
include <tunables/global>

# The profile has to name the file that is really executed: the packaged "${executable}" is a launcher script that starts
# "${executable}.bin" (see scripts/linux-launcher.js). Ubuntu 24.04 only lets an app create the user namespace of
# Chromium's sandbox when a profile like this one covers its binary.
profile "${executable}" "/opt/${sanitizedProductName}/${executable}.bin" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
