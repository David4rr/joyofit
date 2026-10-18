import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChip } from '@/components/IconChip';
import { Field } from '@/components/Input';
import { KeyValue } from '@/components/KeyValue';
import { Section, Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { metresToKmText, parseKm } from '@/features/gear/form';
import { GEAR_KINDS, stravaKind, type Gear, type GearKind } from '@/features/gear/model';
import { allGearTotals, deleteGear, getGear, saveGear, setGearRetired } from '@/features/gear/store';
import { StravaGearLink, type StravaGearLinkValue } from '@/features/gear/ui/StravaGearLink';
import { errorMessage } from '@/format';
import { fmtDistance, fmtDuration, fmtInt, getLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing, useColors } from '@/theme';

const PHOTO = 96;
const KIND_ICON = { shoes: 'footsteps', bike: 'bicycle', other: 'cube-outline' } as const satisfies Record<GearKind, string>;

interface Form {
  kind: GearKind;
  name: string;
  brand: string;
  model: string;
  startKm: string;
  retireKm: string;
  photoUri: string | null;
  strava: StravaGearLinkValue | null;
}

const BLANK: Form = { kind: 'shoes', name: '', brand: '', model: '', startKm: '', retireKm: '', photoUri: null, strava: null };

function formOf(gear: Gear): Form {
  const comma = getLocale() === 'id';
  return {
    kind: gear.kind,
    name: gear.name,
    brand: gear.brand ?? '',
    model: gear.model ?? '',
    startKm: metresToKmText(gear.startDistanceM, comma),
    retireKm: metresToKmText(gear.retireAtM, comma),
    photoUri: gear.photoUri,
    strava: gear.stravaGearId ? { id: gear.stravaGearId, name: gear.stravaGearName ?? gear.stravaGearId } : null,
  };
}

function photoDirectory(): Directory {
  const dir = new Directory(Paths.document, 'gear');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** A photo file in the app's own folder; the picker's copy lives in the cache and goes away. */
async function keepPhoto(sourceUri: string): Promise<string> {
  const extension = /\.(jpe?g|png|webp|heic)$/i.exec(sourceUri)?.[0] ?? '.jpg';
  const name = `${Date.now().toString(36)}-${Math.floor(Math.random() * 36 ** 5).toString(36)}${extension}`;
  const target = new File(photoDirectory(), name);
  await new File(sourceUri).copy(target);
  return target.uri;
}

function removePhotoFile(uri: string | null) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file that is already gone is the goal.
  }
}

/** Add or edit one gear (`?id=` edits). */
export default function GearEditScreen() {
  const { t } = useTranslation('gear');
  const colors = useColors();
  const db = useSQLiteContext();
  const router = useRouter();
  const cloud = useCloud();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;

  const [form, setForm] = useState<Form>(BLANK);
  const [loaded, setLoaded] = useState(id === null);
  const [saved, setSaved] = useState<Gear | null>(null);
  const [lifetime, setLifetime] = useState<{ distanceM: number; seconds: number; workouts: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The copy made in this visit that is not stored yet: it is removed again if the screen closes without saving.
  const unsavedPhoto = useRef<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    void (async () => {
      const [gear, totals] = await Promise.all([getGear(db, id), allGearTotals(db)]);
      if (!live) return;
      if (gear) {
        setSaved(gear);
        setForm(formOf(gear));
        setLifetime(totals.get(gear.id) ?? null);
      }
      setLoaded(true);
    })().catch(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [db, id]);

  useEffect(
    () => () => {
      removePhotoFile(unsavedPhoto.current);
    },
    [],
  );

  const sync = useCallback(() => {
    if (cloud.signedIn) void cloud.syncNow().catch(() => {});
  }, [cloud]);

  const update = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const changeKind = (kind: GearKind) =>
    setForm((current) => ({
      ...current,
      kind,
      strava: current.strava && stravaKind(current.strava.id) === kind ? current.strava : null,
    }));

  const pickPhoto = async () => {
    if (busy) return;
    setBusy(true);
    setPhotoError(null);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (picked.canceled || picked.assets.length === 0) return;
      const uri = await keepPhoto(picked.assets[0].uri);
      removePhotoFile(unsavedPhoto.current);
      unsavedPhoto.current = uri;
      update('photoUri', uri);
    } catch (e) {
      setPhotoError(t('edit.photo.error', { error: errorMessage(e) }));
    } finally {
      setBusy(false);
    }
  };

  const dropPhoto = () => {
    removePhotoFile(unsavedPhoto.current);
    unsavedPhoto.current = null;
    setPhotoError(null);
    update('photoUri', null);
  };

  const start = parseKm(form.startKm);
  const retire = parseKm(form.retireKm);
  const nameMissing = form.name.trim() === '';
  const valid = !nameMissing && start.ok && retire.ok;

  const save = async () => {
    setSubmitted(true);
    if (!valid || !start.ok || !retire.ok || busy) return;
    setBusy(true);
    try {
      await saveGear(db, {
        id: id ?? undefined,
        kind: form.kind,
        name: form.name,
        brand: form.brand,
        model: form.model,
        photoUri: form.photoUri,
        startDistanceM: start.metres ?? 0,
        retireAtM: retire.metres,
        stravaGearId: form.strava?.id ?? null,
        stravaGearName: form.strava?.name ?? null,
      });
      // The stored photo is replaced or removed: the old file is no longer used. The new one is kept.
      if (saved?.photoUri && saved.photoUri !== form.photoUri) removePhotoFile(saved.photoUri);
      unsavedPhoto.current = null;
      sync();
      router.back();
    } catch (e) {
      setPhotoError(errorMessage(e));
      setBusy(false);
    }
  };

  const toggleRetired = async () => {
    if (!saved || busy) return;
    setBusy(true);
    try {
      await setGearRetired(db, saved.id, saved.retiredAt === null);
      setSaved(await getGear(db, saved.id));
      sync();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!saved) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      await deleteGear(db, saved.id);
      removePhotoFile(saved.photoUri);
      sync();
      router.back();
    } catch (e) {
      setPhotoError(errorMessage(e));
      setBusy(false);
    }
  };

  const title = id === null ? t('edit.newTitle') : t('edit.editTitle');
  const kindOptions = GEAR_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }));

  if (!loaded) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Section title={t('title')} icon={KIND_ICON[form.kind]}>
        <AppText variant="label" muted>
          {t('edit.kind')}
        </AppText>
        <Segmented options={kindOptions} value={form.kind} onChange={changeKind} />
        <Field
          label={t('edit.name')}
          value={form.name}
          onChangeText={(text) => update('name', text)}
          placeholder={t('edit.namePlaceholder')}
          autoCapitalize="words"
          returnKeyType="next"
        />
        {submitted && nameMissing ? (
          <AppText variant="caption" danger>
            {t('edit.nameRequired')}
          </AppText>
        ) : null}
        <Field label={t('edit.brand')} value={form.brand} onChangeText={(text) => update('brand', text)} autoCapitalize="words" returnKeyType="next" />
        <Field label={t('edit.model')} value={form.model} onChangeText={(text) => update('model', text)} autoCapitalize="words" returnKeyType="next" />
      </Section>

      <Section title={t('edit.distancesTitle')} icon="speedometer-outline">
        <Field
          label={t('edit.startDistance')}
          hint={t('edit.startDistanceHint')}
          value={form.startKm}
          onChangeText={(text) => update('startKm', text)}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        {!start.ok ? (
          <AppText variant="caption" danger>
            {t('edit.numberInvalid')}
          </AppText>
        ) : null}
        <Field
          label={t('edit.retireAt')}
          hint={t('edit.retireAtHint')}
          value={form.retireKm}
          onChangeText={(text) => update('retireKm', text)}
          keyboardType="decimal-pad"
        />
        {!retire.ok ? (
          <AppText variant="caption" danger>
            {t('edit.numberInvalid')}
          </AppText>
        ) : null}
      </Section>

      <Section title={t('edit.photoTitle')} icon="image-outline">
        <View style={styles.photoRow}>
          {form.photoUri ? (
            <Image source={{ uri: form.photoUri }} style={[styles.photo, { backgroundColor: colors.muted }]} accessibilityIgnoresInvertColors />
          ) : (
            <IconChip icon={KIND_ICON[form.kind]} size="lg" />
          )}
          <View style={styles.photoActions}>
            <Button
              label={form.photoUri ? t('edit.photo.change') : t('edit.photo.add')}
              icon="image"
              onPress={() => void pickPhoto()}
              disabled={busy}
            />
            {form.photoUri ? <Button label={t('edit.photo.remove')} variant="ghost" onPress={dropPhoto} /> : null}
          </View>
        </View>
        {photoError ? <Notice tone="danger">{photoError}</Notice> : null}
      </Section>

      <Section title={t('strava.title')} icon="link" tint="link">
        <StravaGearLink kind={form.kind} link={form.strava} onChange={(link) => update('strava', link)} />
      </Section>

      {saved && lifetime ? (
        <Section title={t('edit.lifetime')} icon="stats-chart-outline">
          <KeyValue icon="navigate-outline" label={t('edit.lifetimeDistance')} value={fmtDistance(lifetime.distanceM)} />
          <KeyValue icon="time-outline" label={t('edit.lifetimeTime')} value={fmtDuration(lifetime.seconds)} />
          <KeyValue icon="footsteps-outline" label={t('edit.lifetimeWorkouts')} value={fmtInt(lifetime.workouts)} />
        </Section>
      ) : null}

      <Button label={t('edit.save')} variant="primary" icon="checkmark" onPress={() => void save()} loading={busy} />

      {saved ? (
        <View style={styles.actions}>
          <Button
            label={saved.retiredAt === null ? t('edit.retire') : t('edit.unretire')}
            icon={saved.retiredAt === null ? 'archive-outline' : 'refresh'}
            onPress={() => void toggleRetired()}
            disabled={busy}
          />
          <Button label={t('edit.delete')} variant="destructive" icon="trash-outline" onPress={() => setConfirmDelete(true)} disabled={busy} />
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmDelete}
        title={t('edit.deleteTitle', { name: saved?.name ?? form.name })}
        message={t('edit.deleteBody')}
        confirmLabel={t('edit.deleteConfirm')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: PHOTO, height: PHOTO, borderRadius: 16 },
  photoActions: { flex: 1, gap: spacing.sm },
  actions: { gap: spacing.sm },
});
