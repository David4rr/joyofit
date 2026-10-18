import { CloudHttpError, CloudNotConfiguredError, NotSignedInError } from '@/cloud/api';
import { familyErrorText } from '@/features/family/copy';
import { t } from '@/i18n';

/** The Worker asked for JoyoRogo Pro (402). */
export const isProRequired = (error: unknown): boolean => error instanceof CloudHttpError && error.status === 402;

/** An error from a family call in the words of the screen. An answer without a status means the phone never reached the Worker. */
export function describeFamilyError(error: unknown): string {
  if (error instanceof CloudHttpError) return familyErrorText(error.status, error.code);
  if (error instanceof NotSignedInError) return familyErrorText(401, null);
  if (error instanceof CloudNotConfiguredError) return t('family:errors.notConfigured');
  return familyErrorText(null, null);
}
