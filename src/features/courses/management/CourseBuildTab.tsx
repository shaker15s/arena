/**
 * features/courses/management/CourseBuildTab.tsx — تبويب «بناء الكورس» (UX-C1)
 *
 * الفجوة التي يسدّها: كان المنظّم يستطيع إنشاء وحدة تعليمية عبر RPC، لكن **لا توجد
 * واجهة** تربط محاضرة بوحدة، ولا تكتب محتوى المحاضرة (أهداف/محاور/ملخص/موارد).
 * النتيجة: الكورسات تُبنى نظريًا وتبقى مسطّحة عمليًا.
 *
 * هنا سلطة كاملة وبسيطة:
 *   • إنشاء وحدة + إعادة تسميتها + ترتيبها + حذفها (المحاضرات تُفصل ولا تُحذف).
 *   • ربط/فصل أي محاضرة بأي وحدة من نفس الكورس.
 *   • كتابة محتوى كل محاضرة: أهداف التعلّم، المحاور، الملخص، الموارد.
 *
 * كل كتابة تمر عبر RPC مُدقَّق (0036 + 0035): `create_course_module`,
 * `rename_course_module`, `reorder_course_module`, `delete_course_module`,
 * `set_session_module`, `save_session_content` — ثم `refresh()` من المتجر.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  createCourseModule, deleteCourseModule, renameCourseModule, reorderCourseModule,
  saveSessionContent, setSessionModule,
} from '../../../data/actions';
import { useApp } from '../../../data/store';
import { useTheme } from '../../../design/theme';
import { useI18n } from '../../../i18n';
import { Btn, Card, Empty, Input, Row, Sheet, Spacer, Tag, Txt } from '../../../design/components';
import { Icon } from '../../../design/icons';
import { radii, spacing } from '../../../design/tokens';
import { formatDate } from '../../../shared/format';
import type { Course, TrainingSession } from '../../../data/types';
import type { Lang } from '../../../i18n';

interface Props {
  db: ReturnType<typeof useApp>['db'];
  course: Course;
  sessions: TrainingSession[];
  canEdit: boolean;
}

export function CourseBuildTab({ db, course, sessions, canEdit }: Props) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const [newUnitOpen, setNewUnitOpen] = useState(false);
  const [newUnitTitle, setNewUnitTitle] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [assignTarget, setAssignTarget] = useState<TrainingSession | null>(null);
  const [contentTarget, setContentTarget] = useState<TrainingSession | null>(null);

  const modules = useMemo(
    () => db.modules.filter((m) => m.courseId === course.id).sort((a, b) => a.seq - b.seq),
    [db.modules, course.id],
  );

  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => a.seq - b.seq), [sessions]);

  const unitOfSession = (session: TrainingSession) =>
    session.moduleId ? modules.find((m) => m.id === session.moduleId) : undefined;

  const run = async (label: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      toast(label, 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUnit = () => {
    const title = newUnitTitle.trim();
    if (!title) return;
    void run(t('build.unitCreated'), async () => {
      await createCourseModule(course.id, title);
      setNewUnitTitle('');
      setNewUnitOpen(false);
    });
  };

  const handleRename = () => {
    if (!renameTarget) return;
    const title = renameTarget.title.trim();
    if (!title) return;
    const target = renameTarget;
    void run(t('build.unitRenamed'), async () => {
      await renameCourseModule(target.id, title);
      setRenameTarget(null);
    });
  };

  if (!canEdit) {
    return <Empty emoji="🔒" title={t('build.noPermissionTitle')} body={t('build.noPermissionBody')} />;
  }

  const unitsTotal = modules.reduce((sum, m) => {
    const count = sortedSessions.filter((s) => s.moduleId === m.id).length;
    return sum + count;
  }, 0);
  const unassigned = sortedSessions.length - unitsTotal;

  return (
    <View style={{ gap: spacing.s3 }}>
      <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '33' }}>
        <Row between center>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="caption" color={theme.textSecondary}>{t('build.title')}</Txt>
            <Txt variant="bodyMed" color={theme.brand}>
              {t('build.summary', { units: modules.length, sessions: sortedSessions.length })}
            </Txt>
            <Txt variant="micro" color={theme.textMuted}>{t('build.hint')}</Txt>
          </View>
          <Icon name="construct" size={26} color={theme.brand} />
        </Row>
        <Spacer size={spacing.s3} />
        <Btn
          title={t('build.newUnit')}
          size="sm"
          variant="primary"
          icon="add"
          full
          onPress={() => setNewUnitOpen(true)}
        />
      </Card>

      {/* الوحدات الحالية */}
      {modules.map((unit, index) => {
        const unitSessions = sortedSessions.filter((s) => s.moduleId === unit.id);
        return (
          <Card key={unit.id}>
            <Row between center gap={spacing.s2}>
              <Row center gap={spacing.s2} style={{ flex: 1, minWidth: 0 }}>
                <View style={[styles.badge, { backgroundColor: theme.brandSoft, borderColor: theme.brand + '33' }]}>
                  <Txt variant="caption" bold color={theme.brand}>{index + 1}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="bodyMed" numberOfLines={1}>{unit.title}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>
                    {t('build.unitSessions', { x: unitSessions.length })}
                  </Txt>
                </View>
              </Row>
              <Row center gap={spacing.s1} wrap>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('build.moveUp')}
                  disabled={busy || index === 0}
                  onPress={() => void run(t('build.reordered'), () => reorderCourseModule(unit.id, -1))}
                  style={[styles.iconBtn, { borderColor: theme.line, opacity: index === 0 ? 0.4 : 1 }]}
                >
                  <Icon name="chevron-up" size={16} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('build.moveDown')}
                  disabled={busy || index === modules.length - 1}
                  onPress={() => void run(t('build.reordered'), () => reorderCourseModule(unit.id, 1))}
                  style={[styles.iconBtn, { borderColor: theme.line, opacity: index === modules.length - 1 ? 0.4 : 1 }]}
                >
                  <Icon name="chevron-down" size={16} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('build.rename')}
                  disabled={busy}
                  onPress={() => setRenameTarget({ id: unit.id, title: unit.title })}
                  style={[styles.iconBtn, { borderColor: theme.line }]}
                >
                  <Icon name="pencil" size={15} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('build.delete')}
                  disabled={busy}
                  onPress={() => void run(t('build.unitDeleted'), () => deleteCourseModule(unit.id))}
                  style={[styles.iconBtn, { borderColor: theme.danger + '55', backgroundColor: theme.dangerSoft }]}
                >
                  <Icon name="trash" size={15} color={theme.danger} />
                </Pressable>
              </Row>
            </Row>

            {unitSessions.length > 0 ? (
              <>
                <Spacer size={spacing.s3} />
                <View style={{ gap: spacing.s2 }}>
                  {unitSessions.map((sess) => (
                    <Row key={sess.id} center gap={spacing.s2} style={[styles.sessionChip, { backgroundColor: theme.fill }]}>
                      <Txt variant="micro" color={theme.textMuted}>{sess.seq}</Txt>
                      <Txt variant="caption" style={{ flex: 1 }} numberOfLines={1}>{sess.title}</Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('build.detach')}
                        disabled={busy}
                        onPress={() => void run(t('build.sessionDetached'), () => setSessionModule(sess.id, null))}
                      >
                        <Icon name="close-circle" size={17} color={theme.textMuted} />
                      </Pressable>
                    </Row>
                  ))}
                </View>
              </>
            ) : (
              <Txt variant="micro" color={theme.textMuted} style={{ marginTop: spacing.s3 }}>
                {t('build.unitEmpty')}
              </Txt>
            )}
          </Card>
        );
      })}

      {/* المحاضرات غير المرتبطة */}
      {unassigned > 0 || modules.length === 0 ? (
        <Card>
          <Row between center>
            <Txt variant="bodyMed">{t('build.unassignedTitle')}</Txt>
            <Tag label={String(unassigned)} color={theme.textSecondary} bg={theme.fill} />
          </Row>
          <Spacer size={spacing.s2} />
          <View style={{ gap: spacing.s2 }}>
            {sortedSessions
              .filter((s) => !unitOfSession(s))
              .map((sess) => (
                <Row key={sess.id} center gap={spacing.s2} style={[styles.sessionChip, { backgroundColor: theme.fill }]}>
                  <Txt variant="micro" color={theme.textMuted}>{sess.seq}</Txt>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt variant="caption" numberOfLines={1}>{sess.title}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>{formatDate(sess.startsAt, lang as Lang)}</Txt>
                  </View>
                  <Btn
                    title={t('build.attach')}
                    size="sm"
                    variant="ghost"
                    icon="add"
                    disabled={modules.length === 0}
                    onPress={() => setAssignTarget(sess)}
                  />
                </Row>
              ))}
          </View>
          {modules.length === 0 ? (
            <Txt variant="micro" color={theme.textMuted} style={{ marginTop: spacing.s2 }}>
              {t('build.createUnitFirst')}
            </Txt>
          ) : null}
        </Card>
      ) : null}

      {/* محتوى المحاضرات */}
      <Card>
        <Row center gap={spacing.s2}>
          <Icon name="document-text" size={18} color={theme.brand} />
          <Txt variant="h3">{t('build.contentTitle')}</Txt>
        </Row>
        <Spacer size={spacing.s2} />
        <Txt variant="micro" color={theme.textMuted}>{t('build.contentHint')}</Txt>
        <Spacer size={spacing.s3} />
        <View style={{ gap: spacing.s2 }}>
          {sortedSessions.map((sess) => {
            const content = db.sessionContent.find((c) => c.sessionId === sess.id);
            const filled = Boolean(content && (content.objectives.length || content.topics.length || content.summary));
            return (
              <Pressable
                key={sess.id}
                accessibilityRole="button"
                accessibilityLabel={`${t('build.editContent')}: ${sess.title}`}
                onPress={() => setContentTarget(sess)}
                style={[styles.sessionChip, { backgroundColor: filled ? theme.successSoft : theme.fill, borderColor: filled ? theme.success + '33' : theme.line, borderWidth: 1, borderRadius: radii.md, padding: spacing.s2 }]}
              >
                <Row center gap={spacing.s2}>
                  <Icon name={filled ? 'checkmark-circle' : 'ellipse-outline'} size={17} color={filled ? theme.success : theme.textMuted} />
                  <Txt variant="caption" style={{ flex: 1 }} numberOfLines={1}>{`${sess.seq}. ${sess.title}`}</Txt>
                  <Icon name="chevron-forward" size={15} color={theme.textMuted} />
                </Row>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* نافذة وحدة جديدة */}
      <Sheet visible={newUnitOpen} onClose={() => setNewUnitOpen(false)} title={t('build.newUnit')}>
        <View style={{ gap: spacing.s3 }}>
          <Input
            label={t('build.unitTitle')}
            value={newUnitTitle}
            onChange={setNewUnitTitle}
            placeholder={t('build.unitTitlePlaceholder')}
            maxLength={120}
          />
          <Btn title={t('build.create')} icon="checkmark" full loading={busy} onPress={handleCreateUnit} />
        </View>
      </Sheet>

      {/* نافذة إعادة التسمية */}
      <Sheet visible={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title={t('build.rename')}>
        <View style={{ gap: spacing.s3 }}>
          <Input
            label={t('build.unitTitle')}
            value={renameTarget?.title ?? ''}
            onChange={(value: string) => setRenameTarget((prev) => (prev ? { ...prev, title: value } : prev))}
            maxLength={120}
          />
          <Btn title={t('common.save')} icon="checkmark" full loading={busy} onPress={handleRename} />
        </View>
      </Sheet>

      {/* نافذة ربط محاضرة بوحدة */}
      <Sheet visible={Boolean(assignTarget)} onClose={() => setAssignTarget(null)} title={t('build.attach')}>
        <View style={{ gap: spacing.s2 }}>
          <Txt variant="caption" color={theme.textSecondary} numberOfLines={2}>{assignTarget?.title}</Txt>
          {modules.map((unit) => (
            <Btn
              key={unit.id}
              title={unit.title}
              variant="secondary"
              full
              loading={busy}
              onPress={() => {
                const target = assignTarget;
                if (!target) return;
                void run(t('build.sessionAttached'), async () => {
                  await setSessionModule(target.id, unit.id);
                  setAssignTarget(null);
                });
              }}
            />
          ))}
        </View>
      </Sheet>

      <SessionContentSheet
        session={contentTarget}
        onClose={() => setContentTarget(null)}
        onSaved={() => setContentTarget(null)}
      />
    </View>
  );
}

// ─────────────────────── محرّر محتوى المحاضرة ───────────────────────

function SessionContentSheet({
  session,
  onClose,
  onSaved,
}: {
  session: TrainingSession | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { db, refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [objectives, setObjectives] = useState('');
  const [topics, setTopics] = useState('');
  const [summary, setSummary] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // تحميل القيم مرة واحدة لكل محاضرة (بدل useEffect مع اعتماد على كائن يتغيّر)
  if (session && loadedFor !== session.id) {
    const content = db.sessionContent.find((c) => c.sessionId === session.id);
    setLoadedFor(session.id);
    setObjectives((content?.objectives ?? []).join('\n'));
    setTopics((content?.topics ?? []).join('\n'));
    setSummary(content?.summary ?? '');
  }

  const split = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

  const save = async () => {
    if (!session || busy) return;
    setBusy(true);
    try {
      await saveSessionContent({
        sessionId: session.id,
        objectives: split(objectives).slice(0, 12),
        topics: split(topics).slice(0, 20),
        summary: summary.trim().slice(0, 4000),
        resources: db.sessionContent.find((c) => c.sessionId === session.id)?.resources ?? [],
      });
      await refresh();
      toast(t('build.contentSaved'), 'success');
      onSaved();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={Boolean(session)} onClose={onClose} title={t('build.editContent')}>
      <View style={{ gap: spacing.s3 }}>
        <Txt variant="caption" color={theme.textSecondary} numberOfLines={2}>{session?.title}</Txt>
        <Input
          label={t('build.objectivesLabel')}
          value={objectives}
          onChange={setObjectives}
          placeholder={t('build.objectivesPlaceholder')}
          multiline
        />
        <Input
          label={t('build.topicsLabel')}
          value={topics}
          onChange={setTopics}
          placeholder={t('build.topicsPlaceholder')}
          multiline
        />
        <Input
          label={t('build.summaryLabel')}
          value={summary}
          onChange={setSummary}
          placeholder={t('build.summaryPlaceholder')}
          multiline
        />
        <Txt variant="micro" color={theme.textMuted}>{t('build.onePerLine')}</Txt>
        <Btn title={t('common.save')} icon="checkmark" full loading={busy} onPress={() => void save()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionChip: {
    borderRadius: radii.md,
    paddingVertical: spacing.s2,
    paddingHorizontal: spacing.s3,
  },
});
