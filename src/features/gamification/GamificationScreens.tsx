/**
 * features/gamification — S19 المحفظة + S20 الدوري + S21 الإنجازات + قواعد اللعبة الشفافة.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import {
  balanceOf, badgeProgress, getWeeklyLeague, levelOf, nearestBadge, profileOf,
  risingStars, simulateWeekClose,
} from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Avatar, Btn, Card, CountUp, Empty, FadeIn, Flame, Header, ProgressBar,
  Row, Segmented, Spacer, Tag, Txt,
} from '../../design/components';
import { spacing, radii, leagueTierColors, levels } from '../../design/tokens';
import { formatDate, timePast } from '../../shared/format';
import { PointReason, BadgeRarity } from '../../data/types';

// ───────────────────────────── S19 المحفظة ─────────────────────────────

const REASON_ICONS: Record<PointReason, { icon: keyof typeof Ionicons.glyphMap; key: PointReason }> = {
  'attendance.present': { icon: 'checkmark-circle', key: 'attendance.present' },
  'attendance.late': { icon: 'time', key: 'attendance.late' },
  'course.complete': { icon: 'trophy', key: 'course.complete' },
  kudos: { icon: 'heart', key: 'kudos' },
  rating: { icon: 'star', key: 'rating' },
  'month.bonus': { icon: 'calendar', key: 'month.bonus' },
  'admin.grant': { icon: 'gift', key: 'admin.grant' },
};

export function WalletScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  if (!user) return null;
  const balance = balanceOf(db, user.id);
  const { level, into, nextAt } = levelOf(db, user.id);
  const levelThresholds = [0, 100, 300, 700, 1500, 3000, 6000, 12000];
  const levelSpan = nextAt != null ? nextAt - levelThresholds[level - 1] : null;
  const levelProgress = levelSpan ? into / levelSpan : 1;
  const events = [...db.pointEvents].filter((e) => e.userId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const levelMeta = levels[level - 1];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('wallet.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        {/* البطاقة الكبرى */}
        <FadeIn index={0}>
          <Card color={theme.brand} style={{ borderColor: 'transparent', paddingVertical: 26 }}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Txt variant="caption" color="rgba(255,255,255,0.8)">{t('wallet.total')}</Txt>
              <CountUp value={balance} variant="display" color="#fff" />
              <Row center gap={8} style={{ marginTop: 4 }}>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 5 }}>
                  <Row center gap={5}>
                    <Ionicons name="shield-half" size={14} color="#fff" />
                    <Txt variant="caption" color="#fff">{t('wallet.level')} {level} · {t(`level.${level}` as any)}</Txt>
                  </Row>
                </View>
              </Row>
            </View>
          </Card>
        </FadeIn>

        {/* تقدم المستوى */}
        <FadeIn index={1}>
          <Card>
            <Row between center style={{ marginBottom: 8 }}>
              <Txt variant="bodyMed">{t(`level.${level}` as any)}</Txt>
              <Txt variant="caption" color={theme.brand}>
                {nextAt != null ? t('wallet.toNext', { x: nextAt - balance, name: t(`level.${level + 1}` as any) }) : t('wallet.maxLevel')}
              </Txt>
            </Row>
            <ProgressBar progress={levelProgress} color={levelMeta.color} />
          </Card>
        </FadeIn>

        {/* الدفتر */}
        <FadeIn index={2}>
          <Txt variant="h3">{t('wallet.ledger')}</Txt>
        </FadeIn>
        {events.length === 0 ? (
          <Empty emoji="💫" title={t('wallet.empty')} />
        ) : (
          events.map((e, i) => {
            const meta = REASON_ICONS[e.reasonCode];
            const grantedBy = e.awardedBy ? profileOf(db, e.awardedBy) : null;
            return (
              <FadeIn key={e.id} index={Math.min(i, 5)}>
                <Card>
                  <Row center gap={12}>
                    <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: theme.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={meta.icon} size={20} color={theme.success} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt variant="bodyMed">{t(`reason.${e.reasonCode}` as any)}</Txt>
                      <Txt variant="micro" color={theme.textMuted}>
                        {timePast(e.createdAt, lang)}
                        {grantedBy ? ` · ${t('wallet.manualGrant', { name: grantedBy.fullName })}` : ''}
                      </Txt>
                    </View>
                    <Txt variant="h3" color={theme.success}>+{e.points}</Txt>
                  </Row>
                </Card>
              </FadeIn>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S20 الدوري ─────────────────────────────

export function LeagueScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user, mutate, toast } = useApp();
  const [board, setBoard] = useState<'league' | 'rising'>('league');
  const [closing, setClosing] = useState(false);
  if (!user) return null;

  const league = getWeeklyLeague(db, user.id);
  const rising = risingStars(db, user.id);
  const tierColor = leagueTierColors[league.tier];
  const remaining = league.endsAt - Date.now();
  const daysLeft = Math.floor(remaining / 86_400_000);
  const hoursLeft = Math.floor((remaining % 86_400_000) / 3_600_000);

  const closeWeek = async () => {
    setClosing(true);
    await mutate((d) => simulateWeekClose(d, user.id));
    setClosing(false);
    toast(t('league.weekClosed'), 'success');
  };

  const renderRow = (r: { user: any; xp: number; rank: number; zone: string; isYou: boolean }, i: number) => (
    <FadeIn key={r.user.id} index={Math.min(i, 8)}>
      <Card
        color={r.isYou ? theme.brandSoft : undefined}
        style={{
          borderColor: r.isYou ? theme.brand : theme.line,
          borderWidth: r.isYou ? 2 : 1,
          backgroundColor:
            r.zone === 'promotion' ? theme.successSoft + 'AA'
            : r.zone === 'relegation' ? theme.line + '55'
            : r.isYou ? theme.brandSoft : theme.card,
        }}
      >
        <Row center gap={10}>
          <Txt variant="h3" color={theme.textSecondary} style={{ width: 28 }}>#{r.rank}</Txt>
          <Avatar name={r.user.fullName} color={r.user.avatarColor} size={38} />
          <View style={{ flex: 1 }}>
            <Txt variant="bodyMed">{r.isYou ? `${r.user.fullName} (${t('league.you')})` : r.user.fullName}</Txt>
          </View>
          <Row center gap={4}>
            <Ionicons name="flash" size={13} color={theme.certGold} />
            <Txt variant="h3">{r.xp}</Txt>
          </Row>
        </Row>
      </Card>
    </FadeIn>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('league.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        {/* درع الفئة */}
        <FadeIn index={0}>
          <Card style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
            <Ionicons name="shield" size={58} color={tierColor} />
            <Txt variant="h2" color={tierColor}>{t(`tier.${league.tier}` as any)}</Txt>
            <Row center gap={6}>
              <Ionicons name="hourglass" size={13} color={theme.textMuted} />
              <Txt variant="caption" color={theme.textMuted}>
                {t('league.endsIn')} {daysLeft} {t('common.days')} · {hoursLeft} {t('common.hours')}
              </Txt>
            </Row>
            <Row gap={14} style={{ marginTop: 4 }}>
              <Txt variant="micro" color={theme.success}>▲ {t('league.promotionHint', { x: league.promoPct })}</Txt>
              <Txt variant="micro" color={theme.textMuted}>▼ {t('league.relegationHint', { x: league.relPct })}</Txt>
            </Row>
          </Card>
        </FadeIn>

        <Segmented
          value={board}
          onChange={setBoard}
          options={[
            { value: 'league', label: t(`tier.${league.tier}` as any), icon: 'shield' },
            { value: 'rising', label: t('league.rising'), icon: 'rocket' },
          ]}
        />

        {board === 'rising' ? (
          <>
            <Txt variant="caption" color={theme.textMuted}>{t('league.risingHint')}</Txt>
            {rising.length === 0 ? <Empty emoji="🌱" title={t('league.firstWeek')} /> : rising.map(renderRow)}
          </>
        ) : league.rows.length === 0 ? (
          <Empty emoji="🏁" title={t('league.firstWeek')} />
        ) : (
          <>
            {/* مفتاح المناطق */}
            <Row gap={12} style={{ justifyContent: 'center' }}>
              <Row center gap={4}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: theme.success + '55' }} /><Txt variant="micro" color={theme.textMuted}>{t('league.promotionZone')}</Txt></Row>
              <Row center gap={4}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: theme.card }} /><Txt variant="micro" color={theme.textMuted}>{t('league.safeZone')}</Txt></Row>
              <Row center gap={4}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: theme.line }} /><Txt variant="micro" color={theme.textMuted}>{t('league.relegationZone')}</Txt></Row>
            </Row>
            {league.rows.map(renderRow)}
          </>
        )}

        {/* زر تجريبي: محاكاة كرون إقفال الأسبوع (السبت 23:59 على السيرفر) */}
        <FadeIn index={9}>
          <Btn title={t('league.simCloseWeek')} variant="ghost" size="sm" loading={closing} onPress={closeWeek} icon="flask" />
        </FadeIn>
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── S21 قاعة الإنجازات ─────────────────────────────

export function AchievementsScreen({ navigation }: any) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { db, user } = useApp();
  const [rarityFilter, setRarityFilter] = useState<'all' | BadgeRarity>('all');
  if (!user) return null;

  const rarityColor = (r: BadgeRarity) =>
    r === 'legendary' ? theme.rarityLegendary : r === 'epic' ? theme.rarityEpic : r === 'rare' ? theme.rarityRare : theme.rarityCommon;
  const rarityLabel = (r: BadgeRarity) => t(`achievements.rarity.${r}` as any);

  const badges = db.badges.filter((b) => b.active && (rarityFilter === 'all' || b.rarity === rarityFilter));
  const earnedCount = db.userBadges.filter((u) => u.userId === user.id).length;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('achievements.title')} subtitle={`${earnedCount}/${db.badges.length}`} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 12 }}>
        <Row gap={8} wrap>
          {(['all', 'common', 'rare', 'epic', 'legendary'] as const).map((r) => (
            <Btn
              key={r}
              title={r === 'all' ? t('common.all') : rarityLabel(r)}
              size="sm"
              variant={rarityFilter === r ? 'secondary' : 'ghost'}
              onPress={() => setRarityFilter(r as any)}
            />
          ))}
        </Row>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {badges.map((badge, i) => {
            const earned = db.userBadges.find((u) => u.userId === user.id && u.badgeCode === badge.code);
            const progress = badgeProgress(db, user.id, badge.code);
            const color = rarityColor(badge.rarity);
            return (
              <FadeIn key={badge.code} index={Math.min(i, 8)} style={{ width: '47%' }}>
                <Card style={{ alignItems: 'center', gap: 8, opacity: earned ? 1 : 0.82 }}>
                  <View style={{
                    width: 66, height: 66, borderRadius: 33,
                    backgroundColor: earned ? color + '22' : theme.bg,
                    borderWidth: 2.5, borderColor: earned ? color : theme.line,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: earned ? color : 'transparent', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
                  }}>
                    <Ionicons name={badge.icon as any} size={30} color={earned ? color : theme.textMuted} />
                    {!earned ? <Ionicons name="lock-closed" size={14} color={theme.textMuted} style={{ position: 'absolute', bottom: -2, end: -2, backgroundColor: theme.card, borderRadius: 8, padding: 1 }} /> : null}
                  </View>
                  <Txt variant="micro" color={color}>{rarityLabel(badge.rarity)}</Txt>
                  <Txt variant="caption" align="center" bold>{lang === 'ar' ? badge.nameAr : badge.nameEn}</Txt>
                  <Txt variant="micro" color={theme.textMuted} align="center" numberOfLines={2}>
                    {t('achievements.howTo')}: {lang === 'ar' ? badge.descAr : badge.descEn}
                  </Txt>
                  {!earned && progress > 0 ? (
                    <View style={{ alignSelf: 'stretch', gap: 3 }}>
                      <ProgressBar progress={progress} height={5} color={color} />
                      <Txt variant="micro" color={theme.textMuted} align="center">{Math.round(progress * 100)}%</Txt>
                    </View>
                  ) : earned ? (
                    <Tag label={t('achievements.earned')} color={theme.success} bg={theme.successSoft} icon="checkmark" />
                  ) : (
                    <Tag label={t('achievements.locked')} color={theme.textMuted} bg={theme.bg} icon="lock-closed" />
                  )}
                </Card>
              </FadeIn>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ───────────────────────────── قواعد اللعبة (شفافية عامة) ─────────────────────────────

export function RulesGuideScreen({ navigation }: any) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db } = useApp();
  const rv = (key: string, def: number) => {
    const r = db.rules.find((x) => x.key === key);
    return typeof r?.value === 'number' ? r.value : def;
  };

  const rows: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string }> = [
    { icon: 'checkmark-circle', label: t('rules.presentPts'), value: `+${rv('points.present', 10)}`, color: theme.success },
    { icon: 'time', label: t('rules.latePts'), value: `+${rv('points.late', 7)}`, color: theme.warn },
    { icon: 'hourglass', label: t('rules.lateWindow'), value: t('rules.minutesX', { x: rv('attendance.late_window_min', 15) }), color: theme.brand },
    { icon: 'calendar', label: t('rules.monthBonus'), value: `+${rv('points.month_bonus', 50)}`, color: theme.teal },
    { icon: 'trophy', label: t('rules.completeBonus'), value: `+${rv('points.course_complete', 100)}`, color: theme.certGold },
    { icon: 'ribbon', label: t('rules.certPct'), value: `${rv('certificate.min_attendance_pct', 75)}%`, color: theme.brand },
    { icon: 'snow', label: t('rules.freezeMax'), value: `${rv('streak.freeze_max_hold', 2)}`, color: theme.info },
    { icon: 'trending-up', label: t('rules.leagueMove'), value: `${rv('league.promotion_pct', 15)}%`, color: theme.success },
    { icon: 'heart', label: t('rules.kudosQuota'), value: `${rv('kudos.monthly_quota_per_instructor', 200)}`, color: theme.danger },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Header title={t('rules.title')} back={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.s5, gap: 14 }}>
        <FadeIn index={0}>
          <Card glass>
            <Row center gap={8}>
              <Ionicons name="eye" size={18} color={theme.brand} />
              <Txt variant="caption" color={theme.textSecondary} style={{ flex: 1 }}>{t('rules.updatedBy')}</Txt>
            </Row>
          </Card>
        </FadeIn>

        <FadeIn index={1}>
          <Txt variant="h3">{t('rules.pointsSection')}</Txt>
          <Spacer size={8} />
          <Card noPad>
            {rows.slice(0, 5).map((r, i) => (
              <RuleLine key={i} {...r} last={i === 4} />
            ))}
          </Card>
        </FadeIn>

        <FadeIn index={2}>
          <Txt variant="h3">{t('rules.streakSection')}</Txt>
          <Spacer size={8} />
          <Card>
            <Row center gap={6} style={{ marginBottom: 6 }}>
              <Flame size={18} />
              <Txt variant="bodyMed">🔥</Txt>
            </Row>
            <Txt variant="body" color={theme.textSecondary}>{t('rules.streakBody')}</Txt>
            <Spacer size={8} />
            <Txt variant="caption" color={theme.info}>{t('rules.freezeNote')}</Txt>
          </Card>
        </FadeIn>

        <FadeIn index={3}>
          <Txt variant="h3">{t('rules.leagueSection')}</Txt>
          <Spacer size={8} />
          <Card>
            <Txt variant="body" color={theme.textSecondary}>{t('rules.leagueBody')}</Txt>
          </Card>
        </FadeIn>

        <FadeIn index={4}>
          <Txt variant="h3">{t('rules.certSection')}</Txt>
          <Spacer size={8} />
          <Card noPad>
            {rows.slice(5).map((r, i) => (
              <RuleLine key={i} {...r} last={i === rows.slice(5).length - 1} />
            ))}
          </Card>
        </FadeIn>
      </ScrollView>
    </View>
  );
}

function RuleLine({ icon, label, value, color, last }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string; last?: boolean }) {
  const { theme } = useTheme();
  return (
    <Row center gap={12} style={{ padding: 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: color + '1F', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Txt variant="body" style={{ flex: 1 }}>{label}</Txt>
      <Txt variant="h3" color={color}>{value}</Txt>
    </Row>
  );
}
