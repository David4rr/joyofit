import { afterEach, describe, expect, test } from 'bun:test';

import {
  consentAlerts,
  consentIntro,
  consentRevoke,
  consentTitle,
  CONSENT_DEFAULT_SCOPES,
  familyErrorText,
  inviteShareMessage,
  notificationHref,
  prePermissionBody,
  prePermissionMonitoredBody,
  scopeRows,
} from '@/features/family/copy';
import { applyLocale } from '@/i18n';

afterEach(() => applyLocale('id'));

describe('consent copy', () => {
  test('names the watcher in the title and the body', () => {
    expect(consentTitle('Dina')).toBe('Izinkan Dina melihat kabarmu?');
    expect(consentIntro('Dina')).toBe('Dina ingin ikut memantau kabarmu dari jam Huawei-mu. Kamu yang menentukan apa yang dibagikan.');
    expect(consentAlerts('Dina')).toBe(
      'Dina bisa dapat pemberitahuan kalau datamu terlihat tidak biasa, misalnya belum ada langkah sampai siang. Itu bukan diagnosis dokter.',
    );
    expect(consentRevoke('Dina')).toBe(
      'Kamu bisa jeda atau berhenti kapan saja. Kalau berhenti, Dina langsung tidak bisa melihat apa pun dan riwayatnya kami hapus.',
    );
  });

  test('every category but the required sync one starts off', () => {
    expect(CONSENT_DEFAULT_SCOPES).toEqual({ sync: true, steps: false, sleep: false, restingHr: false, spo2: false });
    expect(scopeRows().map((row) => row.key)).toEqual(['sync', 'steps', 'sleep', 'restingHr', 'spo2']);
  });
});

describe('prePermissionBody', () => {
  test('is the exact sentence of the design, with the person named', () => {
    expect(prePermissionBody('Ibu')).toBe(
      'Aktifkan notifikasi supaya kamu dapat kabar dari Ibu. Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu.',
    );
  });

  test('the monitored side hears about being asked how they are', () => {
    expect(prePermissionMonitoredBody('Dina')).toBe(
      'Aktifkan notifikasi supaya kamu tahu kalau Dina menanyakan kabarmu. Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu.',
    );
  });
});

describe('notificationHref', () => {
  test('an alert and a poke open the link they are about', () => {
    expect(notificationHref({ type: 'family_alert', linkId: 'abc-123', rule: 'noSync' })).toBe('/family/abc-123');
    expect(notificationHref({ type: 'family_poke', linkId: 'f3a9_c1' })).toBe('/family/f3a9_c1');
  });

  test('anything else opens nothing', () => {
    expect(notificationHref({ type: 'other', linkId: 'abc' })).toBeNull();
    expect(notificationHref({ type: 'family_alert' })).toBeNull();
    expect(notificationHref({ type: 'family_alert', linkId: 42 })).toBeNull();
    expect(notificationHref(null)).toBeNull();
    expect(notificationHref('family_alert')).toBeNull();
  });

  test('a link id that could change the route is refused', () => {
    expect(notificationHref({ type: 'family_alert', linkId: '../settings' })).toBeNull();
    expect(notificationHref({ type: 'family_alert', linkId: 'a/b' })).toBeNull();
    expect(notificationHref({ type: 'family_alert', linkId: '' })).toBeNull();
  });
});

describe('familyErrorText', () => {
  test('the Worker error codes get their own sentence', () => {
    expect(familyErrorText(404, 'invite_invalid')).toContain('Kode undangan tidak berlaku');
    expect(familyErrorText(400, 'own_invite')).toContain('buat sendiri');
    expect(familyErrorText(409, 'limit_reached')).toContain('Batas');
    expect(familyErrorText(429, 'poke_throttled')).toContain('satu jam');
    expect(familyErrorText(409, 'already_linked')).toBe('Kalian sudah terhubung.');
    expect(familyErrorText(409, 'not_active')).toContain('belum mengizinkan');
  });

  test('without a known code the status decides', () => {
    expect(familyErrorText(null, null)).toContain('Periksa internet');
    expect(familyErrorText(401, null)).toContain('Sesi JoyoRogo');
    expect(familyErrorText(503, null)).toContain('Server');
    expect(familyErrorText(418, 'teapot')).toBe('Terjadi kesalahan. Coba lagi.');
  });
});

describe('inviteShareMessage', () => {
  test('carries both the link and the code, whichever side invites', () => {
    for (const role of ['watcher', 'monitored'] as const) {
      const message = inviteShareMessage(role, 'https://fit.joyorogo.com/keluarga/ABCD2345', 'ABCD2345');
      expect(message).toContain('https://fit.joyorogo.com/keluarga/ABCD2345');
      expect(message).toContain('kode ABCD2345');
    }
  });

  test('says who wants to look at whom', () => {
    expect(inviteShareMessage('watcher', 'u', 'C')).toContain('Aku ingin ikut melihat kabarmu');
    expect(inviteShareMessage('monitored', 'u', 'C')).toContain('melihat kabarku');
  });
});

describe('English', () => {
  test('consent, permission and error copy follow the language', async () => {
    await applyLocale('en');
    expect(consentTitle('Dina')).toBe('Let Dina see how you are doing?');
    expect(prePermissionBody('Mom')).toBe(
      'Turn on notifications to get updates about Mom. Notifications can be late and do not guarantee you find out right away.',
    );
    expect(familyErrorText(null, null)).toContain('Check your internet');
    expect(familyErrorText(409, 'already_linked')).toBe('You are already connected.');
    expect(familyErrorText(418, 'teapot')).toBe('Something went wrong. Try again.');
    expect(scopeRows()[0].label).toBe('When the watch last connected, and battery');
  });

  test('the share message is built in the sender language', async () => {
    await applyLocale('en');
    const message = inviteShareMessage('monitored', 'https://x/keluarga/ABCD2345', 'ABCD2345');
    expect(message).toContain('I am inviting you');
    expect(message).toContain('enter the code ABCD2345');
  });
});
