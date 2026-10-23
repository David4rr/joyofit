import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { authClient } from '@/cloud/auth';
import { rogo, type RogoReportReason, type RogoReportTarget } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChoiceDialog } from '@/components/ChoiceDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Notice } from '@/components/States';
import { hide } from '@/features/social/moderation';
import { errorMessage } from '@/format';
import { overlay, spacing, useTheme } from '@/theme';

/** JoyoRogo's own reasons and its limit for the note (`social.report`). */
const REASONS: readonly RogoReportReason[] = ['spam', 'kasar', 'salah_info', 'lainnya'];
export const REPORT_NOTE_MAX = 200;

/** What the "..." menu acts on: one post, one comment or the profile of `author`. */
export type ModerationTarget = { kind: 'post'; id: string } | { kind: 'comment'; id: string } | { kind: 'profile' };

interface ModerationMenuProps {
  target: ModerationTarget;
  /** Who made it; reporting a profile and blocking both act on this account. */
  author: { id: string; name: string };
  /** The author was blocked: a profile screen leaves itself. */
  onBlocked?: () => void;
}

type Step = 'closed' | 'menu' | 'report' | 'block';

function reportTarget(target: ModerationTarget, authorId: string): RogoReportTarget {
  return target.kind === 'post' ? { postId: target.id } : target.kind === 'comment' ? { commentId: target.id } : { userId: authorId };
}

/**
 * The "..." button of a post, a comment or a profile: "Report" (reason and an optional note) and "Block user", the two
 * things Google Play asks of an app with user content. Nothing for the person's own content or a signed-out phone.
 * A report hides its content for the reporter once the thank-you is closed; a block hides the person at once.
 */
export function ModerationMenu({ target, author, onBlocked }: ModerationMenuProps) {
  const { t } = useTranslation(['social', 'common']);
  const me = authClient.useSession().data?.user.id;
  const [step, setStep] = useState<Step>('closed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<RogoReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const { colors } = useTheme();

  if (!me || author.id === me) return null;

  const close = () => {
    if (busy) return;
    setStep('closed');
    setError(null);
    setReason(null);
    setNote('');
  };
  const open = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await rogo.social.report(reportTarget(target, author.id), reason, note.trim() || undefined);
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The thank-you is closed: only now does the reported content leave the screen (and this menu with it).
  const finishReport = () => {
    setSent(false);
    setStep('closed');
    hide(target.kind === 'post' ? 'reportedPosts' : target.kind === 'comment' ? 'reportedComments' : 'reportedUsers', target.kind === 'profile' ? author.id : target.id);
  };

  const block = async () => {
    setBusy(true);
    setError(null);
    try {
      await rogo.social.block(author.id);
      hide('blockedUsers', author.id);
      setStep('closed');
      onBlocked?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = t(`moderation.kind.${target.kind}`);
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('moderation.more', { kind: kindLabel })}
        hitSlop={8}
        onPress={() => open('menu')}
        style={styles.trigger}>
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.mutedForeground} />
      </PressableScale>

      <ChoiceDialog
        visible={step === 'menu'}
        title={t('moderation.menuTitle', { name: author.name })}
        message={t('moderation.menuMessage')}
        choices={[
          { label: t('moderation.report.action', { kind: kindLabel }), variant: 'secondary', onPress: () => open('report') },
          { label: t('moderation.block.action'), variant: 'destructive', onPress: () => open('block') },
        ]}
        onCancel={close}
      />

      <ConfirmDialog
        visible={step === 'block'}
        title={t('moderation.block.title', { name: author.name })}
        message={error ? `${t('moderation.block.message')}\n\n${error}` : t('moderation.block.message')}
        confirmLabel={t('moderation.block.confirm')}
        destructive
        busy={busy}
        onConfirm={() => void block()}
        onCancel={close}
      />

      <Modal visible={step === 'report'} transparent animationType="slide" onRequestClose={sent ? finishReport : close} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
          <Pressable style={styles.scrim} onPress={sent ? finishReport : close} accessibilityLabel={t('common:actions.cancel')}>
            <Pressable
              accessibilityViewIsModal
              onPress={() => {}}
              style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.hairline }]}>
              {sent ? (
                <>
                  <View style={styles.thanks}>
                    <Ionicons name="checkmark-circle" size={40} color={colors.primary} />
                    <AppText variant="heading" accessibilityRole="header">
                      {t('moderation.report.thanksTitle')}
                    </AppText>
                    <AppText variant="body" style={styles.center}>
                      {t('moderation.report.thanks')}
                    </AppText>
                  </View>
                  <Button label={t('moderation.report.done')} variant="primary" onPress={finishReport} />
                </>
              ) : (
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
                  <AppText variant="heading" accessibilityRole="header">
                    {t('moderation.report.title', { kind: kindLabel })}
                  </AppText>
                  <AppText variant="caption" muted>
                    {t('moderation.report.ask', { kind: kindLabel })}
                  </AppText>
                  <View accessibilityRole="radiogroup" style={styles.reasons}>
                    {REASONS.map((value) => {
                      const on = reason === value;
                      return (
                        <PressableScale
                          key={value}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => setReason(value)}
                          style={styles.reason}>
                          <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.mutedForeground} />
                          <AppText variant="body" style={styles.fill}>
                            {t(`moderation.report.reason.${value}`)}
                          </AppText>
                        </PressableScale>
                      );
                    })}
                  </View>
                  <AppText variant="label" muted>
                    {t('moderation.report.noteCount', { n: note.length, max: REPORT_NOTE_MAX })}
                  </AppText>
                  <Input
                    value={note}
                    onChangeText={setNote}
                    maxLength={REPORT_NOTE_MAX}
                    multiline
                    placeholder={t('moderation.report.notePlaceholder')}
                    accessibilityLabel={t('moderation.report.noteLabel')}
                  />
                  {error ? <Notice tone="danger">{error}</Notice> : null}
                  <Button label={t('moderation.report.send')} variant="primary" loading={busy} disabled={!reason} onPress={() => void send()} />
                  <Button label={t('common:actions.cancel')} disabled={busy} onPress={close} />
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  trigger: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: overlay.scrim, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, maxHeight: '90%', gap: spacing.md },
  form: { gap: spacing.md },
  reasons: { gap: spacing.xs },
  reason: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  thanks: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  center: { textAlign: 'center' },
});
