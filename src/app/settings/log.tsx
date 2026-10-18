import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { useContentPadding } from '@/components/Screen';
import { EmptyState } from '@/components/States';
import { formatLogLine } from '@/features/log/formatLog';
import { LogRow } from '@/features/log/LogRow';
import { LOG_CAPACITY, useLogBuffer } from '@/state/logStore';
import { spacing, useColors } from '@/theme';
import type { LogDirection } from '@/wear';

type Filter = 'all' | LogDirection;

const FILTERS: readonly Filter[] = ['all', 'tx', 'rx', 'info', 'error'];

export default function LogScreen() {
  const { t } = useTranslation('settings');
  const colors = useColors();
  const padding = useContentPadding(false);
  const buffer = useLogBuffer();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  // Newest first. Search matches the formatted line (message, ids and hex), case-insensitive.
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return buffer
      .filter((e) => filter === 'all' || e.event.direction === filter)
      .filter((e) => needle === '' || formatLogLine(e.event).toLowerCase().includes(needle))
      .reverse();
  }, [buffer, filter, query]);

  async function copy(text: string, what: string) {
    await Clipboard.setStringAsync(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  // Copies what is shown, oldest first, so a search for "TruSleep" copies only those lines.
  function copyShown() {
    void copy(rows.slice().reverse().map((e) => formatLogLine(e.event)).join('\n'), 'shown');
  }

  const header = (
    <View style={[styles.toolbar, { backgroundColor: colors.background }]}>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Chip key={f} label={t(`log.filters.${f}`)} role="tab" selected={f === filter} onPress={() => setFilter(f)} />
        ))}
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Input
            icon="search"
            value={query}
            onChangeText={setQuery}
            placeholder={t('log.searchPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel={t('log.searchLabel')}
          />
        </View>
        <Button
          label={copied === 'shown' ? t('log.copied') : t('log.copy')}
          variant="secondary"
          icon="copy-outline"
          disabled={rows.length === 0}
          onPress={copyShown}
        />
      </View>
      <AppText variant="caption" muted>
        {t('log.summary', { shown: rows.length, buffered: buffer.length, capacity: LOG_CAPACITY })}
        {copied === 'line' ? ` ${t('log.lineCopied')}` : ''}
      </AppText>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(e) => String(e.id)}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={[0]}
      ListHeaderComponent={header}
      initialNumToRender={20}
      windowSize={9}
      removeClippedSubviews
      renderItem={({ item }) => (
        <Pressable
          onLongPress={() => void copy(formatLogLine(item.event), 'line')}
          accessibilityHint={t('log.lineHint')}>
          <LogRow event={item.event} />
        </Pressable>
      )}
      ListEmptyComponent={
        buffer.length === 0 ? (
          <EmptyState
            icon="terminal"
            title={t('log.emptyTitle')}
            description={t('log.emptyDesc')}
          />
        ) : (
          <EmptyState
            icon="terminal"
            title={t('log.noneTitle')}
            description={
              query.trim() !== ''
                ? t('log.noMatch', { query: query.trim() })
                : t('log.noFilter', { filter })
            }
            action={{
              label: t('log.clear'),
              onPress: () => {
                setFilter('all');
                setQuery('');
              },
            }}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: spacing.sm, paddingBottom: spacing.sm },
  filters: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: { flex: 1 },
});
