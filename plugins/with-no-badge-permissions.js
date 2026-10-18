// expo-notifications pulls in ShortcutBadger, whose manifest asks for one badge permission per third-party launcher (Sony, HTC,
// Huawei, Oppo, Samsung, Nova-style "everything.me", ...). JoyoFit badges through the system only, so each one is marked
// tools:node="remove", which drops it from the merged manifest. POST_NOTIFICATIONS, c2dm RECEIVE and READ_APP_BADGE stay.
const { withAndroidManifest } = require('expo/config-plugins');

const BADGE_PERMISSIONS = [
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.huawei.android.launcher.permission.CHANGE_BADGE',
  'com.huawei.android.launcher.permission.READ_SETTINGS',
  'com.huawei.android.launcher.permission.WRITE_SETTINGS',
  'com.majeur.launcher.permission.UPDATE_BADGE',
  'com.oppo.launcher.permission.READ_SETTINGS',
  'com.oppo.launcher.permission.WRITE_SETTINGS',
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];

function removeBadgePermissions(manifest) {
  manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
  const perms = (manifest['uses-permission'] ??= []);
  for (const name of BADGE_PERMISSIONS) {
    const existing = perms.find((p) => p.$['android:name'] === name);
    if (existing) existing.$['tools:node'] = 'remove';
    else perms.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  }
  return manifest;
}

module.exports = function withNoBadgePermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    removeBadgePermissions(cfg.modResults.manifest);
    return cfg;
  });
};
