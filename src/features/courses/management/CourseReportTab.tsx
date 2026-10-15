/**
 * features/courses/management/CourseReportTab.tsx — كتابة تقارير الكورس ونشرها (UX-C3)
 *
 * سلطة المنظّم كاملة: يكتب التقرير (ملخص/ما تحقق/التحديات/التوصيات)، يدرج الملخص
 * الرقمي بضغطة، يحفظ مسودة، ينشر للطلاب (مع إشعار تلقائي مرة واحدة)، أو يحذف.
 *
 * الأرقام تصل من المرآة المحلية `courseReportSummary` (مطابقة لـRPC 0037)، والكتابة
 * تمر عبر `saveCourseReport` / `publishCourseReport` / `deleteCourseReport` — كلها RPCs مُدقَّقة.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../../../data/store';
import { courseReportSummary } from '../../../data/engine';
import { deleteCourseReport, publishCourseReport, saveCourseReport } from '../../../data/actions';
import { useTheme } from '../../../design/theme';
import { useI18n } from '../../../i18n';
import { Btn, Card, Empty, Input, Row, Spacer, Tag, Txt } from '../../../design/components';
import { Icon } from '../../../design/icons';
import { spacing } from '../../../design/tokens';
import { formatDate } from '../../../shared/format';
import type { Course } from '../../../data/types';
import type { Lang } from '../../../i18n';

interface DraftState {
  id: string | null;
  title: string;
  summary: string;
  achievements: string;
  challenges: string;
  recommendations: string;
  published: boolean;
}

const EMPTY_DRAFT: DraftState = {
  id: null, title: '', summary: '', achievements: '', challenges: '', recommendations: '', published: false,
};

export function CourseReportTab({ course, canEdit, batches }: { course: Course; canEdit: boolean; batches: Array<{ id: string; room: string }> }) {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const { db, refresh, toast } = useApp();
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => courseReportSummary(db, course.id), [db, course.id]);
  const existing = useMemo(
    () => db.courseReports.filter((r) => r.courseId === course.id).sort((a, b) => b.createdAt - a.createdAt),
    [db.courseReports, course.id],
  );

  const statsLine = useMemo(() => {
    const attendancePct = summary.attendance.total > 0
      ? Math.round(((summary.attendance.present + summary.attendance.late) / summary.attendance.total) * 100)
      : 0;
    return [
      t('creport.statStudents', { x: summary.students }),
      t('creport.statSessions', { x: summary.sessionsClosed, y: summary.sessionsTotal }),
      t('creport.statAttendance', { x: attendancePct }),
      t('creport.statUnderstanding', { x: summary.learning.avgUnderstanding.toFixed(1) }),
      t('creport.statRating', { x: summary.ratings.avg.toFixed(1), y: summary.ratings.count }),
      t('creport.statCerts', { x: summary.certificates }),
    ].join(' · ');
  }, [summary, t]);

  const patch = (next: Partial<DraftState>) => setDraft((prev) => ({ ...prev, ...next }));

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

  const save = (publish: boolean) => {
    if (!draft.summary.trim() && !draft.achievements.trim() && !draft.challenges.trim() && !draft.recommendations.trim()) {
      toast(t('creport.needContent'), 'error');
      return;
    }
    void run(publish ? t('creport.published') : t('creport.saved'), async () => {
      const result = await saveCourseReport({
        courseId: course.id,
        reportId: draft.id,
        title: draft.title.trim() || course.title,
        summary: draft.summary,
        achievements: draft.achievements,
        challenges: draft.challenges,
        recommendations: draft.recommendations,
        publish,
      });
      patch({ id: result.id, published: result.published });
    });
  };

  if (!canEdit) {
    return (
      <Empty
        emoji="📘"
        title={t('creport.noPermissionTitle')}
        body={t('creport.noPermissionBody')}
      />
    );
  }

  return (
    <View style={{ gap: spacing.s3 }}>
      {/* الملخص الرقمي — وقود التقرير */}
      <Card color={theme.brandSoft} style={{ borderColor: theme.brand + '33' }}>
        <Row between center>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt variant="caption" color={theme.textSecondary}>{t('creport.statsTitle')}</Txt>
            <Txt variant="micro" color={theme.textMuted}>{statsLine}</Txt>
          </View>
          <Icon name="stats-chart" size={24} color={theme.brand} />
        </Row>
        <Spacer size={spacing.s3} />
        <Btn
          title={t('creport.insertStats')}
          size="sm"
          variant="secondary"
          icon="add-circle"
          full
          onPress={() => {
            const block = `${t('creport.statsTitle')}\n${statsLine}${
              summary.missingReports > 0 ? `\n${t('creport.statMissing', { x: summary.missingReports })}` : ''
            }`;
            patch({ summary: draft.summary ? `${draft.summary}\n\n${block}` : block });
          }}
        />
      </Card>

      {/* محرّر التقرير */}
      <Card>
        <Row between center>
          <Row center gap={spacing.s2}>
            <Icon name="document-text" size={18} color={theme.brand} />
            <Txt variant="h3">{draft.id ? t('creport.editTitle') : t('creport.newTitle')}</Txt>
          </Row>
          {draft.id ? (
            <Tag
              label={draft.published ? t('creport.publishedTag') : t('creport.draftTag')}
              color={draft.published ? theme.success : theme.warn}
              bg={draft.published ? theme.successSoft : theme.warnSoft}
            />
          ) : null}
        </Row>
        <Spacer size={spacing.s3} />
        <View style={{ gap: spacing.s3 }}>
          <Input
            label={t('creport.titleLabel')}
            value={draft.title}
            onChange={(value: string) => patch({ title: value })}
            placeholder={course.title}
            maxLength={160}
          />
          <Input
            label={t('creport.summaryLabel')}
            value={draft.summary}
            onChange={(value: string) => patch({ summary: value })}
            placeholder={t('creport.summaryPlaceholder')}
            multiline
          />
          <Input
            label={t('creport.achievementsLabel')}
            value={draft.achievements}
            onChange={(value: string) => patch({ achievements: value })}
            placeholder={t('creport.achievementsPlaceholder')}
            multiline
          />
          <Input
            label={t('creport.challengesLabel')}
            value={draft.challenges}
            onChange={(value: string) => patch({ challenges: value })}
            placeholder={t('creport.challengesPlaceholder')}
            multiline
          />
          <Input
            label={t('creport.recommendationsLabel')}
            value={draft.recommendations}
            onChange={(value: string) => patch({ recommendations: value })}
            placeholder={t('creport.recommendationsPlaceholder')}
            multiline
          />
        </View>

        <Spacer size={spacing.s4} />
        <Row gap={spacing.s2} wrap>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Btn
              title={t('creport.saveDraft')}
              variant="secondary"
              icon="save"
              loading={busy}
              full
              onPress={() => save(false)}
            />
          </View>
          <View style={{ flex: 1, minWidth: 150 }}>
            <Btn
              title={draft.published ? t('creport.updatePublished') : t('creport.publish')}
              variant="primary"
              icon="send"
              loading={busy}
              full
              onPress={() => save(true)}
            />
          </View>
        </Row>
        {draft.id ? (
          <>
            <Spacer size={spacing.s2} />
            <Btn
              title={draft.published ? t('creport.unpublish') : t('creport.publish')}
              size="sm"
              variant="ghost"
              icon={draft.published ? 'eye-off' : 'eye'}
              full
              onPress={() => void run(t('creport.publishChanged'), () => publishCourseReport(draft.id as string, !draft.published).then(() => patch({ published: !draft.published })))}
            />
          </>
        ) : null}
      </Card>

      {/* التقارير المحفوظة */}
      {existing.length > 0 ? (
        <>
          <Row between center style={{ marginHorizontal: 4 }}>
            <Txt variant="h3">{t('creport.savedTitle')}</Txt>
            <Tag label={String(existing.length)} color={theme.brand} bg={theme.brandSoft} />
          </Row>
          {existing.map((report) => (
            <Card key={report.id} style={{ borderColor: report.published ? theme.success + '44' : theme.line }}>
              <Row between center gap={spacing.s2}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Txt variant="bodyMed" numberOfLines={1}>{report.title || course.title}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>
                    {formatDate(report.createdAt, lang as Lang)}
                    {report.published ? ` · ${t('creport.publishedTag')}` : ` · ${t('creport.draftTag')}`}
                  </Txt>
                </View>
                <Row center gap={spacing.s1}>
                  <Btn
                    title={t('creport.open')}
                    size="sm"
                    variant="ghost"
                    icon="create"
                    onPress={() => setDraft({
                      id: report.id,
                      title: report.title,
                      summary: report.summary,
                      achievements: report.achievements,
                      challenges: report.challenges,
                      recommendations: report.recommendations,
                      published: report.published,
                    })}
                  />
                  <Btn
                    title={t('creport.delete')}
                    size="sm"
                    variant="danger"
                    icon="trash"
                    onPress={() => void run(t('creport.deleted'), () => deleteCourseReport(report.id).then(() => {
                      if (draft.id === report.id) setDraft(EMPTY_DRAFT);
                    }))}
                  />
                </Row>
              </Row>
              {report.summary ? (
                <>
                  <Spacer size={spacing.s2} />
                  <Txt variant="caption" color={theme.textSecondary} numberOfLines={3}>{report.summary}</Txt>
                </>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      <Txt variant="micro" color={theme.textMuted} align="center" style={{ paddingHorizontal: spacing.s4 }}>
        {t('creport.hint')}
      </Txt>
      <Spacer size={spacing.s8} />
    </View>
  );
}
