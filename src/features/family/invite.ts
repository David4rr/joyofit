import type { FamilyInvitePreview } from '@/cloud/family';

export const INVITE_CODE_LENGTH = 8;

/**
 * What a person typed or pasted as a code: letters and digits only, upper case, so `abcd 2345` and `ABCD-2345` are the
 * same code. A pasted invite link (`.../keluarga/ABCD2345`) gives its code.
 */
export function normalizeInviteCode(input: string): string {
  const code = input.includes('/keluarga/') ? input.split('/keluarga/').pop()! : input;
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, INVITE_CODE_LENGTH);
}

/** Who asks what, for the screen that shows an invite before it is accepted. */
export function previewLine(preview: Pick<FamilyInvitePreview, 'inviterName' | 'inviterRole'>): string {
  return preview.inviterRole === 'watcher'
    ? `${preview.inviterName} ingin ikut memantau kabarmu dari jam Huawei-mu.`
    : `${preview.inviterName} mengundangmu memantau kabarnya dari jam Huawei-nya.`;
}
