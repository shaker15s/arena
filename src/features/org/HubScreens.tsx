/**
 * features/org — Hub: S49 قواعد اللعبة + S50 استوديو الشارات + S51 المراسلات + S52 سجل العمليات
 * + S46 إصدار الشهادات.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  audit, batchOf, batchStudents, courseOf, issuanceTable, previewRuleImpact,
  profileOf, rpcBroadcast, rpcIssueCertificates, rpcUpdateRule, ruleValue,
} from '../../data/engine';
import { RULE_DEFS } from '../../data/rules';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, Chip, CustomSwitch, Empty, FadeIn, Header, Input,
  ListRow, Row, Segmented, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { CelebrationModal } from '../../design/celebrations';
import { spacing, radii } from '../../design/tokens';
import { timePast, formatDate } from '../../shared/format';
import { Certificate } from '../../data/types';

// ───────────────────────────── Hub (مقسّم) ─────────────────────────────

type HubTab = 'rules' | 'badges' | 'broadcast' | 'audit';

export function HubScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<HubTab>('rules');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.s3, padding: spacing.s5, gap: 12, paddingBottom: 130 }}>
        <Header title={t('tabs.hub')} />
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as HubTab)}
          options={[
            { value: 'rules', label: t('studio.title'), icon: 'options' },
            { value: 'badges', label: t('badges.title'), icon: 'medal' },
            { value: 'broadcast', label: t('broadcast.title'), icon: 'megaphone' },
            { value: 'audit', label: t('audit.title'), icon: 'document-lock' },
          ]}
        />
        {tab === 'rules' ? <RulesStudio /> : null}
        {tab === 'badges' ? <BadgeStudio /> : null}
        {tab === 'broadcast' ? <BroadcastComposer /> : null}
        {tab === 'audit' ? <AuditLog /> : null}
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S49 قواعد اللعبة — الجوهرة الإدارية ─────────────────────────────

function RulesStudio() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [impact, setImpact] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const labels: Record<string, string> = {
    'points.present': t('rules.presentPts'),
    'points.late': t('rules.latePts'),
    'attendance.late_window_min': t('rules.lateWindow'),
    'certificate.min_attendance_pct': t('rules.certPct'),
    'kudos.monthly_quota_per_instructor': t('rules.kudosQuota'),
    'streak.freeze_max_hold': t('rules.freezeMax'),
    'league.promotion_pct': t('rules.leagueMove') + ' ↗',
    'league.relegation_pct': t('rules.leagueMove') + ' ↘',
    'points.month_bonus': t('rules.monthBonus'),
    'points.course_complete': t('rules.completeBonus'),
    'points.rating': t('reason.rating'),
  };

  const openEdit = (key: string) => {
    const v = ruleValue(db, key);
    setEditing({ key, value: String(v) });
    setImpact(null);
  };

  const computeImpact = (key: string, value: number) => {
    const r = previewRuleImpact(db, key, value);
    setImpact(r.affected);
  };

  const save = async () => {
    if (!editing) return;
    const value = parseFloat(editing.value);
    setSaving(true);
    const r = await mutate((d) => rpcUpdateRule(d, user.id, editing.key, value));
    setSaving(false);
    if (!r.ok) {
      toast(t('studio.outOfBounds'), 'error');
      return;
    }
    toast(t('studio.saved'), 'success');
    setEditing(null);
    setImpact(null);
  };

  return (
    <>
      <Card glass>
        <Row center gap={8}>
          <Ionicons name="flash" size={16} color={theme.brand} />
          <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('rules.updatedBy')}</Txt>
        </Row>
      </Card>
      {RULE_DEFS.map((def, i) => {
        const current = ruleValue(db, def.key);
        const defLabel = labels[def.key] ?? def.key;
        return (
          <FadeIn key={def.key} index={i}>
            <Card>
              <Row center gap={12}>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{defLabel}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{t('studio.minMax', { min: def.min, max: def.max })}</Txt>
                </View>
                <Tag label={def.unit === 'pct' ? `${current}%` : String(current)} color={theme.brand} bg={theme.brandSoft} icon="options" />
                <Btn title={t('common.edit')} size="sm" variant="secondary" onPress={() => openEdit(def.key)} />
              </Row>

              {editing?.key === def.key ? (
                <View style={{ marginTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 12 }}>
                  <Row gap={10}>
                    <View style={{ flex: 1 }}>
                      <Input
                        value={editing.value}
                        onChange={(v) => {
                          setEditing({ key: def.key, value: v.replace(/[^\d.]/g, '') });
                          setImpact(null);
                        }}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Btn title={t('studio.impact')} variant="ghost" icon="analytics" onPress={() => computeImpact(def.key, parseFloat(editing.value) || 0)} />
                  </Row>
                  {impact != null ? (
                    <Card color={impact > 0 ? theme.warnSoft : theme.successSoft} noPad style={{ padding: 10, borderColor: impact > 0 ? theme.warn + '44' : theme.success + '44' }}>
                      <Row center gap={8}>
                        <Ionicons name={impact > 0 ? 'warning' : 'checkmark-circle'} size={16} color={impact > 0 ? theme.warn : theme.success} />
                        <Txt variant="caption" color={impact > 0 ? theme.warn : theme.success} style={{ flex: 1 }}>
                          {impact > 0 ? t('studio.impactResult', { x: impact }) : t('studio.impactNone')}
                        </Txt>
                      </Row>
                    </Card>
                  ) : null}
                  <Row gap={8}>
                    <Btn title={t('studio.save')} loading={saving} onPress={save} icon="checkmark" />
                    <Btn title={t('common.cancel')} variant="ghost" onPress={() => { setEditing(null); setImpact(null); }} />
                  </Row>
                </View>
              ) : null}
            </Card>
          </FadeIn>
        );
      })}
    </>
  );
}

// ───────────────────────────── S50 استوديو الشارات ─────────────────────────────

function BadgeStudio() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, mutate, toast } = useApp();

  const rarityColor = (r: string) =>
    r === 'legendary' ? theme.rarityLegendary : r === 'epic' ? theme.rarityEpic : r === 'rare' ? theme.rarityRare : theme.rarityCommon;

  return (
    <>
      {db.badges.map((badge, i) => {
        const holders = db.userBadges.filter((u) => u.badgeCode === badge.code).length;
        return (
          <FadeIn key={badge.code} index={i}>
            <Card>
              <Row center gap={12}>
                <View style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: rarityColor(badge.rarity) + '22',
                  borderWidth: 2, borderColor: rarityColor(badge.rarity),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name={badge.icon as any} size={22} color={badge.active ? rarityColor(badge.rarity) : theme.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyMed">{lang === 'ar' ? badge.nameAr : badge.nameEn}</Txt>
                  <Txt variant="micro" color={theme.textMuted}>{lang === 'ar' ? badge.descAr : badge.descEn}</Txt>
                  <Txt variant="micro" color={theme.brand}>{holders} {t('common.students')}</Txt>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Tag label={t(`achievements.rarity.${badge.rarity}` as any)} color={rarityColor(badge.rarity)} bg={rarityColor(badge.rarity) + '1F'} />
                  <CustomSwitch
                    value={badge.active}
                    onChange={async (v) => {
                      await mutate((d) => {
                        const b = d.badges.find((x) => x.code === badge.code);
                        if (b) b.active = v;
                      });
                      toast(t('common.done') + ' ✓', 'success');
                    }}
                  />
                </View>
              </Row>
            </Card>
          </FadeIn>
        );
      })}
    </>
  );
}

// ───────────────────────────── S51 المراسلات الجماعية ─────────────────────────────

function BroadcastComposer() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const [scope, setScope] = useState<'all' | 'branch' | 'batch'>('all');
  const [branchId, setBranchId] = useState<string>(db.branches[0]?.id ?? '');
  const [batchId, setBatchId] = useState<string>(db.batches[0]?.id ?? '');
  const [type, setType] = useState<'alert' | 'reminder' | 'congrats'>('reminder');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  if (!user) return null;

  const targetCount =
    scope === 'all' ? db.profiles.filter((p) => p.role === 'student' || p.role === 'volunteer').length
    : scope === 'branch' ? db.profiles.filter((p) => p.branchId === branchId && (p.role === 'student' || p.role === 'volunteer')).length
    : batchStudents(db, batchId).length;

  const typeMeta = {
    alert: { icon: 'alert-circle' as const, color: theme.danger, label: t('broadcast.typeAlert') },
    reminder: { icon: 'alarm' as const, color: theme.brand, label: t('broadcast.typeReminder') },
    congrats: { icon: 'sparkles' as const, color: theme.certGold, label: t('broadcast.typeCongrats') },
  };

  const send = async () => {
    if (title.trim().length < 2 || body.trim().length < 4) return;
    setSending(true);
    const scopeArg = scope === 'all' ? { kind: 'all' as const } : scope === 'branch' ? { kind: 'branch' as const, branchId } : { kind: 'batch' as const, batchId };
    const r = await mutate((d) => rpcBroadcast(d, user.id, scopeArg as any, title.trim(), body.trim()));
    setSending(false);
    toast(t('broadcast.sent', { x: r.reached }), 'success');
    setTitle('');
    setBody('');
  };

  const meta = typeMeta[type];

  return (
    <View style={{ gap: 14 }}>
      <Card>
        <Txt variant="caption" color={theme.textSecondary}>{t('broadcast.scope')}</Txt>
        <Spacer size={8} />
        <Row gap={8} wrap>
          <Chip label={t('broadcast.scopeAll')} active={scope === 'all'} onPress={() => setScope('all')} />
          <Chip label={t('broadcast.scopeBranch')} active={scope === 'branch'} onPress={() => setScope('branch')} />
          <Chip label={t('broadcast.scopeBatch')} active={scope === 'batch'} onPress={() => setScope('batch')} />
        </Row>
        {scope === 'branch' ? (
          <>
            <Spacer size={8} />
            <Row gap={8} wrap>
              {db.branches.map((b) => (
                <Chip key={b.id} label={b.name.replace('فرع ', '')} active={branchId === b.id} onPress={() => setBranchId(b.id)} />
              ))}
            </Row>
          </>
        ) : null}
        {scope === 'batch' ? (
          <>
            <Spacer size={8} />
            <Row gap={8} wrap>
              {db.batches.map((b) => (
                <Chip key={b.id} label={courseOf(db, b.courseId)?.title ?? b.id} active={batchId === b.id} onPress={() => setBatchId(b.id)} />
              ))}
            </Row>
          </>
        ) : null}
        <Spacer size={10} />
        <Row center gap={6}>
          <Ionicons name="people" size={14} color={theme.brand} />
          <Txt variant="caption" color={theme.brand}>{targetCount}</Txt>
        </Row>
      </Card>

      <Card>
        <Txt variant="caption" color={theme.textSecondary}>{t('broadcast.type')}</Txt>
        <Spacer size={8} />
        <Row gap={8} wrap>
          {(['alert', 'reminder', 'congrats'] as const).map((x) => (
            <Chip key={x} label={typeMeta[x].label} active={type === x} onPress={() => setType(x)} icon={typeMeta[x].icon} />
          ))}
        </Row>
        <Spacer size={10} />
        <Input label={t('common.name')} value={title} onChange={setTitle} icon="megaphone" />
        <Spacer size={10} />
        <Input label={t('broadcast.message')} value={body} onChange={setBody} multiline />
      </Card>

      {/* معاينة حية كما ستصل */}
      {title.trim() ? (
        <FadeIn>
          <Txt variant="caption" color={theme.textMuted}>{t('broadcast.preview')}</Txt>
          <Card style={{ borderColor: meta.color + '55', backgroundColor: theme.card }}>
            <Row center gap={12}>
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: meta.color + '1F', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={meta.icon} size={19} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyMed">{title}</Txt>
                <Txt variant="caption" color={theme.textSecondary}>{body}</Txt>
                <Txt variant="micro" color={theme.textMuted}>مسار · الآن</Txt>
              </View>
            </Row>
          </Card>
        </FadeIn>
      ) : null}

      <Btn title={t('broadcast.send')} size="lg" full icon="send" loading={sending} onPress={send} disabled={title.trim().length < 2 || body.trim().length < 4} />
    </View>
  );
}

// ───────────────────────────── S52 سجل العمليات ─────────────────────────────

function AuditLog() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db } = useApp();

  const actionIcon = (action: string): keyof typeof Ionicons.glyphMap =>
    action === 'award_kudos' ? 'heart'
    : action === 'admin_update_rule' ? 'options'
    : action === 'broadcast' ? 'megaphone'
    : action === 'issue_certificates' ? 'ribbon'
    : action === 'close_session' ? 'stop-circle'
    : action === 'start_session' ? 'play-circle'
    : 'document-text';

  return (
    <>
      {db.audit.length === 0 ? (
        <Empty emoji="📜" title={t('audit.empty')} />
      ) : (
        db.audit.slice(0, 40).map((a, i) => {
          const actor = profileOf(db, a.actorId);
          return (
            <FadeIn key={a.id} index={Math.min(i, 6)}>
              <Card>
                <Row center gap={10}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={actionIcon(a.action)} size={17} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="caption" bold>{a.action}</Txt>
                    <Txt variant="micro" color={theme.textMuted}>
                      {t('audit.actor')}: {actor?.fullName ?? a.actorId} · {timePast(a.createdAt, lang)}
                    </Txt>
                    <Txt variant="micro" color={theme.textMuted} numberOfLines={1}>
                      {a.target} · {JSON.stringify(a.payload)}
                    </Txt>
                  </View>
                </Row>
              </Card>
            </FadeIn>
          );
        })
      )}
    </>
  );
}

// ───────────────────────────── S46 إصدار الشهادات ─────────────────────────────

export function IssueCertificatesScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const completedBatches = db.batches.filter((b) => b.status === 'completed');
  const [batchId, setBatchId] = useState<string | null>(completedBatches[0]?.id ?? null);
  const [issuing, setIssuing] = useState(false);
  const [celebrate, setCelebrate] = useState<number | null>(null);

  if (!user) return null;
  const pctRule = ruleValue(db, 'certificate.min_attendance_pct');
  const table = batchId ? issuanceTable(db, batchId) : [];
  const eligibleRows = table.filter((r) => r.eligible && !r.alreadyIssued);
  const alreadyAll = table.length > 0 && eligibleRows.length === 0;

  const issue = async () => {
    if (!batchId) return;
    setIssuing(true);
    const r = await mutate((d) => rpcIssueCertificates(d, user.id, batchId));
    setIssuing(false);
    setCelebrate(r.issued.length);
    toast(t('issue.issuedSnack', { x: r.issued.length }), 'success');
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('issue.title')} back={() => navigation.goBack()} subtitle={t('issue.ruleNote', { pct: pctRule })} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12, paddingBottom: 40 }}>
        {completedBatches.length === 0 ? (
          <Empty emoji="🎓" title={t('issue.noCompleted')} />
        ) : (
          <>
            <Txt variant="caption" color={theme.textSecondary}>{t('issue.pickBatch')}</Txt>
            <Row gap={8} wrap>
              {completedBatches.map((b) => (
                <Chip key={b.id} label={courseOf(db, b.courseId)?.title ?? b.id} active={batchId === b.id} onPress={() => setBatchId(b.id)} />
              ))}
            </Row>

            {table.map((row, i) => (
              <FadeIn key={row.user.id} index={Math.min(i, 8)}>
                <Card>
                  <Row center gap={10}>
                    <Avatar name={row.user.fullName} color={row.user.avatarColor} size={40} />
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{row.user.fullName}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>{t('issue.attendancePct')}: {row.pct}%</Txt>
                    </View>
                    {row.alreadyIssued ? (
                      <Tag label={t('issue.alreadyIssued')} color={theme.brand} bg={theme.brandSoft} icon="ribbon" />
                    ) : row.eligible ? (
                      <Tag label={t('issue.eligible')} color={theme.success} bg={theme.successSoft} icon="checkmark-circle" />
                    ) : (
                      <Tag label={`${t('issue.notEligible')} — ${row.pct}%`} color={theme.danger} bg={theme.dangerSoft} icon="close-circle" />
                    )}
                  </Row>
                </Card>
              </FadeIn>
            ))}

            {alreadyAll ? (
              <Card glass>
                <Row center gap={8}>
                  <Ionicons name="checkmark-done" size={18} color={theme.success} />
                  <Txt variant="body" color={theme.success}>{t('issue.alreadyIssued')}</Txt>
                </Row>
              </Card>
            ) : (
              <Btn
                title={t('issue.issueAll', { x: eligibleRows.length })}
                size="lg" full icon="ribbon"
                loading={issuing}
                disabled={eligibleRows.length === 0}
                onPress={issue}
              />
            )}
          </>
        )}
      </ScrollView>

      <CelebrationModal
        visible={celebrate != null}
        onClose={() => setCelebrate(null)}
        title={t('issue.issuedSnack', { x: celebrate ?? 0 })}
        subtitle={t('certs.congrats')}
        emoji="🎓"
      />
    </View>
  );
}
