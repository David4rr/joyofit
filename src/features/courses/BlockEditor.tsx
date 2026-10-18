import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider } from '@/components/Screen';
import { REPEAT_MAX, REPEAT_MIN, type BlockDraft, type StepDraft } from '@/features/courses/courseModel';
import { IconAction } from '@/features/courses/IconAction';
import { StepEditor } from '@/features/courses/StepEditor';
import { spacing, useColors } from '@/theme';

interface BlockEditorProps {
  /** "Step 2" or "Group 2". */
  label: string;
  block: BlockDraft;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onRepeat: (repeat: number) => void;
  onAddStep: () => void;
  onStepChange: (stepId: string, patch: Partial<StepDraft>) => void;
  onStepMove: (stepId: string, direction: -1 | 1) => void;
  onStepRemove: (stepId: string) => void;
}

/** One block: a plain step, or a group of steps repeated 1 to 99 times. */
export function BlockEditor({
  label,
  block,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onRepeat,
  onAddStep,
  onStepChange,
  onStepMove,
  onStepRemove,
}: BlockEditorProps) {
  const { t } = useTranslation('watch');
  const colors = useColors();
  const plain = block.repeat === 1 && block.steps.length === 1;
  const inGroup = block.steps.length > 1;

  const blockActions = (
    <>
      <IconAction icon="arrow-up" label={t('courses.moveUp', { label })} disabled={isFirst} onPress={() => onMove(-1)} />
      <IconAction icon="arrow-down" label={t('courses.moveDown', { label })} disabled={isLast} onPress={() => onMove(1)} />
      <IconAction icon="trash" label={t('courses.remove', { label })} danger onPress={onRemove} />
    </>
  );

  const repeatRow = (
    <View style={styles.repeat}>
      <View style={styles.repeatText}>
        <AppText variant="label" muted>
          {t('courses.repeat')}
        </AppText>
        <AppText variant="caption" muted>
          {t('courses.repeatHint')}
        </AppText>
      </View>
      <IconAction
        icon="remove"
        label={t('courses.repeatFewer', { label })}
        disabled={block.repeat <= REPEAT_MIN}
        onPress={() => onRepeat(block.repeat - 1)}
      />
      <AppText variant="bodyStrong" style={styles.count} accessibilityLabel={t('courses.repeatsA11y', { count: block.repeat })}>
        {`\u00d7${block.repeat}`}
      </AppText>
      <IconAction
        icon="add"
        label={t('courses.repeatMore', { label })}
        disabled={block.repeat >= REPEAT_MAX}
        onPress={() => onRepeat(block.repeat + 1)}
      />
    </View>
  );

  return (
    <View style={styles.block}>
      {plain ? null : (
        <View style={styles.header}>
          <AppText variant="heading" style={styles.title}>
            {block.repeat > 1 ? `${label} \u00b7 \u00d7${block.repeat}` : label}
          </AppText>
          {blockActions}
        </View>
      )}
      {block.steps.map((step, index) => (
        <View key={step.id} style={[styles.stepWrap, !plain && { borderLeftColor: colors.primary }, !plain && styles.indent]}>
          {index > 0 ? <Divider /> : null}
          <StepEditor
            title={plain ? label : t('courses.step', { n: index + 1 })}
            step={step}
            onChange={(patch) => onStepChange(step.id, patch)}
            actions={
              plain ? (
                blockActions
              ) : inGroup ? (
                <>
                  <IconAction
                    icon="arrow-up"
                    label={t('courses.moveUp', { label: t('courses.step', { n: index + 1 }) })}
                    disabled={index === 0}
                    onPress={() => onStepMove(step.id, -1)}
                  />
                  <IconAction
                    icon="arrow-down"
                    label={t('courses.moveDown', { label: t('courses.step', { n: index + 1 }) })}
                    disabled={index === block.steps.length - 1}
                    onPress={() => onStepMove(step.id, 1)}
                  />
                  <IconAction icon="close" label={t('courses.remove', { label: t('courses.step', { n: index + 1 }) })} danger onPress={() => onStepRemove(step.id)} />
                </>
              ) : undefined
            }
          />
        </View>
      ))}
      {repeatRow}
      <Button label={plain ? t('courses.addToPlain') : t('courses.addToGroup')} icon="add" onPress={onAddStep} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48 },
  title: { flex: 1 },
  stepWrap: { gap: spacing.sm },
  indent: { borderLeftWidth: 3, paddingLeft: spacing.md },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  repeatText: { flex: 1 },
  count: { minWidth: 44, textAlign: 'center' },
});
