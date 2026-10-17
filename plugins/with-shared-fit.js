// A .fit file or a Huawei export .zip shared to JoyoFit (ACTION_SEND, the file in EXTRA_STREAM) is turned into a view intent whose data is that
// file, the shape React Native, expo-linking and expo-router already deliver as a URL (src/app/+native-intent.ts sends
// it to the FIT or Huawei import screen). "Open with" (ACTION_VIEW) needs no code, only the intent filters in app.json.
const { withMainActivity } = require('expo/config-plugins');

const MARKER = '// joyofit-shared-fit';

const METHODS = `  ${MARKER}
  override fun onNewIntent(intent: android.content.Intent) {
    viewSharedFile(intent)
    super.onNewIntent(intent)
  }

  /** ACTION_SEND with a stream becomes ACTION_VIEW with that stream as data; any other intent is left as it is. */
  @Suppress("DEPRECATION")
  private fun viewSharedFile(intent: android.content.Intent?) {
    if (intent?.action != android.content.Intent.ACTION_SEND) return
    val stream =
      if (android.os.Build.VERSION.SDK_INT >= 33) {
        intent.getParcelableExtra(android.content.Intent.EXTRA_STREAM, android.net.Uri::class.java)
      } else {
        intent.getParcelableExtra<android.net.Uri>(android.content.Intent.EXTRA_STREAM)
      }
    if (stream == null) return
    intent.action = android.content.Intent.ACTION_VIEW
    intent.data = stream
    intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

`;

function applySharedFit(kotlin) {
  if (kotlin.includes(MARKER)) return kotlin;
  let out = kotlin.replace(/^(class MainActivity : ReactActivity\(\) \{\n)/m, `$1${METHODS}`);
  out = out.replace(/^(\s*)super\.onCreate\(null\)/m, '$1viewSharedFile(intent)\n$1super.onCreate(null)');
  if (!out.includes(MARKER) || !out.includes('viewSharedFile(intent)\n')) {
    throw new Error('with-shared-fit: MainActivity layout changed; shared files not handled');
  }
  return out;
}

module.exports = function withSharedFit(config) {
  return withMainActivity(config, (cfg) => {
    cfg.modResults.contents = applySharedFit(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applySharedFit = applySharedFit;
