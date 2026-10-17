import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field, Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Notice } from '@/components/States';
import { mapCopy } from '@/features/routes/map/copy';
import { normalizeQuery, type Place } from '@/features/routes/map/geocodeClient';
import { isAborted } from '@/features/routes/map/http';
import { MapButton } from '@/features/routes/map/MapButton';
import { geocoder } from '@/features/routes/map/services';
import { HIT, spacing, useTheme } from '@/theme';

const copy = mapCopy.draw;

/** The rounded card the drawing screen's sheets share. */
export function SheetCard({ children }: { children: ReactNode }) {
  const { colors, radius } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.hairline, borderRadius: radius.card }]}>
      {children}
    </View>
  );
}

interface NameSheetProps {
  initialName: string;
  /** What the save is doing now; the sheet is locked while it is not null. */
  busy: 'elevation' | 'saving' | null;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** Asks for the route's name, then hands it to the screen, which fetches the altitude and saves. */
export function NameSheet({ initialName, busy, error, onSave, onCancel }: NameSheetProps) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <SheetCard>
      <AppText variant="heading" accessibilityRole="header">
        {copy.nameTitle}
      </AppText>
      <Field
        label={copy.nameLabel}
        value={name}
        onChangeText={setName}
        maxLength={60}
        autoFocus
        editable={busy === null}
        returnKeyType="done"
        onSubmitEditing={() => trimmed !== '' && busy === null && onSave(trimmed)}
        hint={copy.nameElevationHint}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={styles.actions}>
        <View style={styles.grow}>
          <Button label={copy.cancel} onPress={onCancel} disabled={busy !== null} />
        </View>
        <View style={styles.grow}>
          <Button
            label={busy === 'elevation' ? copy.fetchingElevation : busy === 'saving' ? copy.saving : copy.save}
            variant="primary"
            icon="checkmark"
            loading={busy !== null}
            disabled={trimmed === ''}
            onPress={() => onSave(trimmed)}
          />
        </View>
      </View>
    </SheetCard>
  );
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; places: readonly Place[] }
  | { kind: 'error'; message: string };

interface SearchSheetProps {
  onPick: (place: Place) => void;
  onClose: () => void;
}

/**
 * One place search, started only by the Cari button or the keyboard's search key: no search while typing, so the service
 * sees one request per submit (its policy forbids autocomplete).
 */
export function SearchSheet({ onPick, onClose }: SearchSheetProps) {
  const [text, setText] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  const submit = async () => {
    if (state.kind === 'loading') return;
    if (!normalizeQuery(text)) {
      setState({ kind: 'error', message: copy.searchTooShort });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'loading' });
    try {
      const places = await geocoder.search(text, controller.signal);
      setState({ kind: 'done', places });
    } catch (e) {
      if (!isAborted(e)) setState({ kind: 'error', message: copy.searchFailed });
    }
  };

  return (
    <SheetCard>
      <View style={styles.header}>
        <AppText variant="heading" accessibilityRole="header" style={styles.grow}>
          {copy.search}
        </AppText>
        <MapButton icon="close" label={copy.searchClose} onPress={onClose} />
      </View>
      <Input
        icon="search"
        value={text}
        onChangeText={setText}
        placeholder={copy.searchPlaceholder}
        accessibilityLabel={copy.search}
        autoFocus
        autoCorrect={false}
        maxLength={100}
        returnKeyType="search"
        onSubmitEditing={submit}
      />
      <Button label={copy.searchSubmit} variant="primary" icon="search" loading={state.kind === 'loading'} onPress={submit} />
      {state.kind === 'error' ? <Notice tone="danger">{state.message}</Notice> : null}
      {state.kind === 'done' && state.places.length === 0 ? <Notice>{copy.searchEmpty}</Notice> : null}
      {state.kind === 'done' && state.places.length > 0 ? (
        <ScrollView style={styles.results} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {state.places.map((place, index) => (
            <PlaceRow key={`${place.lat},${place.lon},${index}`} place={place} onPress={() => onPick(place)} />
          ))}
        </ScrollView>
      ) : null}
      <AppText variant="caption" muted>
        {copy.searchHint} {mapCopy.searchCredit}
      </AppText>
    </SheetCard>
  );
}

function PlaceRow({ place, onPress }: { place: Place; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={copy.pickPlace(place.name)}
      onPress={onPress}
      style={[styles.place, { backgroundColor: colors.muted, borderRadius: radius.input }]}>
      <Ionicons name="location-outline" size={20} color={colors.mutedForeground} />
      <View style={styles.grow}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        {place.detail ? (
          <AppText variant="caption" muted numberOfLines={2}>
            {place.detail}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
  results: { maxHeight: 200, flexGrow: 0 },
  list: { gap: spacing.sm },
  place: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
