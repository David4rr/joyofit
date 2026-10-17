/**
 * Build-time settings of JoyoFit Fuel. The only line a developer edits is PEER_FINGERPRINT (see README.md, "Phone link").
 */

/** This app's bundleName; the same string is in config.json and the AppGallery Connect app. */
export var BUNDLE_NAME = 'com.joyodigitama.joyofit.fuel';
export var APP_VERSION = '1.0.0';

/** The phone app the watch app talks to (JoyoFit's package name). */
export var PEER_PKG = 'com.joyodigitama.joyofit';

/** Left in PEER_FINGERPRINT until the developer pastes the real value; link.js treats it as "not set". */
export var PEER_FINGERPRINT_PLACEHOLDER = 'PASTE_JOYOFIT_SHA256_HERE';

/**
 * SHA-256 of JoyoFit's APK signing certificate, uppercase hex without separators (64 characters). JoyoFit shows it with
 * a Copy button on Watch > Apps > JoyoFit Fuel. The same value goes into config.json, module.metaData.customizeData
 * "supportLists", after "com.joyodigitama.joyofit:".
 */
export var PEER_FINGERPRINT = 'PASTE_JOYOFIT_SHA256_HERE';
