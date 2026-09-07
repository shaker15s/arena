import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../data/store';
import { profileOf } from '../../data/engine';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import {
  Btn, Card, FadeIn, Header, Input, Row, Sheet, Spacer, Tag, Txt,
} from '../../design/components';
import { MasarMascot } from '../../design/mascot';
import { spacing } from '../../design/tokens';
import { createBranch, createCommittee } from '../../data/actions';

export function OrgManagerScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { db, refresh, toast } = useApp();
  const [branchSheet, setBranchSheet] = useState(false);
  const [committeeSheet, setCommitteeSheet] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [gov, setGov] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const saveBranch = async () => {
    if (!name.trim() || !gov.trim()) return;
    setSaving(true);
    try {
      await createBranch({ name: name.trim(), governorate: gov.trim(), address: address.trim() });
      await refresh();
      setBranchSheet(false);
      setName(''); setGov(''); setAddress('');
      toast(t('common.done') + ' ✓', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCommittee = async () => {
    if (!name.trim() || !committeeSheet) return;
    setSaving(true);
    try {
      await createCommittee(committeeSheet, name.trim());
      await refresh();
      setCommitteeSheet(null);
      setName('');
      toast(t('common.done') + ' ✓', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingTop: spacing.s3, padding: spacing.s5, gap: 14, paddingBottom: 130 }}>
        <Header title={t('org.branches')} right={<Btn title={t('org.newBranch')} size="sm" icon="add" onPress={() => setBranchSheet(true)} />} />
        {db.branches.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <MasarMascot size={90} mode="greeting" interactive hideFloatingBubble />
            <View style={{ height: 12 }} />
            <Txt variant="body" color={theme.textSecondary} align="center">
              {t('org.branches')}{'\n'}{t('wizard.s1Body')}
            </Txt>
            <Spacer size={16} />
            <Btn title={t('org.newBranch')} onPress={() => setBranchSheet(true)} />
          </View>
        ) : null}
        {db.branches.map((b, i) => {
          const committees = db.committees.filter((c) => c.branchId === b.id);
          const activeBatches = db.batches.filter((x) => x.branchId === b.id && x.status === 'active').length;
          const supervisor = b.supervisorId ? profileOf(db, b.supervisorId) : null;
          return (
            <FadeIn key={b.id} index={i}>
              <Card>
                <Row center gap={12}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="business" size={26} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3">{b.name}</Txt>
                    <Txt variant="caption" color={theme.textSecondary}>{b.governorate} · {b.address}</Txt>
                    <Row center gap={6} style={{ marginTop: 4 }}>
                      <Ionicons name="person-circle" size={13} color={theme.textMuted} />
                      <Txt variant="micro" color={theme.textMuted}>{supervisor ? supervisor.fullName : t('org.pickSupervisor')}</Txt>
                    </Row>
                  </View>
                  <Tag label={`${activeBatches} ${t('org.activeBatches')}`} color={theme.success} bg={theme.successSoft} icon="pulse" />
                </Row>
                <Spacer size={10} />
                <Txt variant="caption" color={theme.textMuted}>{t('org.committees')}:</Txt>
                <Spacer size={6} />
                <Row gap={6} wrap>
                  {committees.map((c) => (
                    <Tag key={c.id} label={c.name} color={theme.brand} bg={theme.brandSoft} icon="git-network" />
                  ))}
                  <Btn title={t('org.newCommittee')} size="sm" variant="ghost" icon="add" onPress={() => { setCommitteeSheet(b.id); setName(''); }} />
                </Row>
              </Card>
            </FadeIn>
          );
        })}
      </ScrollView>

      <Sheet visible={branchSheet} onClose={() => setBranchSheet(false)} title={t('org.newBranch')}>
        <View style={{ gap: 12 }}>
          <Input label={t('common.name')} value={name} onChange={setName} icon="business" />
          <Input label={t('org.governorate')} value={gov} onChange={setGov} icon="map" />
          <Input label={t('org.address')} value={address} onChange={setAddress} icon="location" />
          <Btn title={t('common.save')} full loading={saving} onPress={saveBranch} icon="checkmark" disabled={!name.trim() || !gov.trim()} />
        </View>
      </Sheet>

      <Sheet visible={committeeSheet != null} onClose={() => setCommitteeSheet(null)} title={t('org.newCommittee')}>
        <View style={{ gap: 12 }}>
          <Input label={t('wizard.committeeName')} value={name} onChange={setName} icon="git-network" />
          <Btn title={t('wizard.addCommittee')} full loading={saving} onPress={saveCommittee} icon="checkmark" disabled={!name.trim()} />
        </View>
      </Sheet>
    </View>
  );
}
