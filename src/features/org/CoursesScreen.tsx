import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, Chip, FadeIn, Header, Input, Row, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { MasarMascot } from '../../design/mascot';
import { spacing } from '../../design/tokens';
import { createCourse } from '../../data/actions';

export function CoursesScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, refresh, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [committeeId, setCommitteeId] = useState<string | null>(db.committees[0]?.id ?? null);
  const [title, setTitle] = useState('');
  const [field, setField] = useState('');
  const [desc, setDesc] = useState('');
  const [sessionsCount, setSessionsCount] = useState('8');
  const [topics, setTopics] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!creating) {
      setErrors({});
      setTitle('');
      setField('');
      setDesc('');
      setSessionsCount('8');
      setTopics('');
      setCommitteeId(db.committees[0]?.id ?? null);
    }
  }, [creating, db.committees]);

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 3) {
      errs.title = t('management.titleMin');
    }
    if (!field.trim() || field.trim().length < 2) {
      errs.field = t('management.fieldMin');
    }
    const count = parseInt(sessionsCount, 10);
    if (!count || count < 1 || count > 100) {
      errs.sessionsCount = t('management.sessionsRange');
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const palette = ['#8B5CF6', '#14B8A6', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899'];
      await createCourse({
        committeeId: committeeId || null,
        title: title.trim(),
        field: field.trim() || t('common.general'),
        description: desc.trim(),
        topics: topics.split('\n').map((x) => x.trim()).filter(Boolean),
        sessionsCount: Math.max(1, parseInt(sessionsCount, 10) || 8),
        color: palette[db.courses.length % palette.length],
      });
      await refresh();
      setCreating(false);
      setTitle(''); setDesc(''); setTopics('');
      toast(t('common.done') + ' ✓', 'success');
    } catch (error) {
      const msg = (error as Error).message;
      setErrors((prev) => ({ ...prev, general: msg }));
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('courses.title')} back={() => navigation.goBack()} right={<Btn title={t('courses.new')} size="sm" icon="add" onPress={() => setCreating(true)} />} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12, paddingBottom: spacing.s8 }}>
        {db.courses.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <MasarMascot size={90} mode="greeting" interactive hideFloatingBubble />
            <View style={{ height: 12 }} />
            <Txt variant="body" color={theme.textSecondary} align="center">
              {t('courses.title')}
            </Txt>
            <Spacer size={16} />
            <Btn title={t('courses.new')} onPress={() => setCreating(true)} />
          </View>
        ) : null}
        {db.courses.map((c, i) => {
          const batches = db.batches.filter((b) => b.courseId === c.id);
          const active = batches.filter((b) => b.status === 'active').length;
          return (
            <FadeIn key={c.id} index={i}>
              <Card onPress={() => navigation.navigate('CourseManagement', { courseId: c.id })}>
                <Row center gap={12}>
                  <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.color, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="book" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyMed">{c.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{c.field} · {t('explore.sessionsCount', { x: c.sessionsCount })} · {active} {t('org.activeBatches')}</Txt>
                  </View>
                  <Tag
                    label={t(`common.${c.status}` as any)}
                    color={c.status === 'published' ? theme.success : c.status === 'draft' ? theme.warn : theme.textMuted}
                    bg={c.status === 'published' ? theme.successSoft : c.status === 'draft' ? theme.warnSoft : theme.bg}
                  />
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>

      <Sheet visible={creating} onClose={() => setCreating(false)} title={t('courses.new')}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40, gap: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {errors.general ? (
            <Card color="#EF44441F" style={{ borderColor: '#EF4444', padding: 10 }}>
              <Txt variant="caption" color="#EF4444">{errors.general}</Txt>
            </Card>
          ) : null}

          {db.committees.length > 0 ? (
            <>
              <Txt variant="caption" color={theme.textSecondary}>{t('org.committees')}</Txt>
              <Row gap={6} wrap>
                {db.committees.map((committee) => (
                  <Chip key={committee.id} label={committee.name} active={committeeId === committee.id} onPress={() => setCommitteeId(committee.id)} />
                ))}
              </Row>
            </>
          ) : null}

          <Input
            label={t('courses.titleLabel')}
            value={title}
            onChange={(v) => { setTitle(v); setErrors((e) => ({ ...e, title: '' })); }}
            placeholder={t('courses.titlePh')}
            icon="book"
            error={errors.title}
          />
          <Input
            label={t('courses.fieldLabel')}
            value={field}
            onChange={(v) => { setField(v); setErrors((e) => ({ ...e, field: '' })); }}
            placeholder={t('courses.fieldPh')}
            icon="bookmark"
            error={errors.field}
          />
          <Input
            label={t('courses.descLabel')}
            value={desc}
            onChange={setDesc}
            placeholder={t('courses.descPh')}
            multiline
          />
          <Row gap={10}>
            <View style={{ flex: 1 }}>
              <Input
                label={t('courses.sessionsLabel')}
                value={sessionsCount}
                onChange={(v) => { setSessionsCount(v); setErrors((e) => ({ ...e, sessionsCount: '' })); }}
                keyboardType="numeric"
                icon="calendar"
                error={errors.sessionsCount}
              />
            </View>
          </Row>
          <Input
            label={t('courses.topicsLabel')}
            value={topics}
            onChange={setTopics}
            placeholder={t('courses.topicsPh')}
            multiline
          />
          <Btn title={t('courses.save')} full size="lg" loading={saving} onPress={save} icon="checkmark-circle" />
        </ScrollView>
      </Sheet>
    </View>
  );
}
