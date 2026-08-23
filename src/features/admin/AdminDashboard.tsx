/**
 * features/admin/AdminDashboard.tsx
 * لوحة الأدمن: إدارة المستخدمين، الفروع، الكورسات، الفيدباك
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Pressable, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Txt, Btn, Card, Row, Spacer, Input, Stars } from '../../design/components';
import { Header } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { useApp } from '../../data/store';
import { getSupabase, SUPABASE_ENABLED } from '../../data/supabase';
import {
  fetchAllUsers, fetchAllBranches, fetchAllCourses,
  fetchAllFeedback,
} from '../../data/queries';
import type { BranchInfo, CourseInfo, FeedbackEntry } from '../../data/queries';

type Tab = 'overview' | 'users' | 'feedback' | 'branches';

export function AdminDashboard({ navigation }: any) {
  const { theme, isDark } = useTheme();
  const { user } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [feedback, setFeedback] = useState<any>({ course: [], instructor: [], organization: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [u, b, c, f] = await Promise.all([
      fetchAllUsers(),
      fetchAllBranches(),
      fetchAllCourses(),
      fetchAllFeedback(),
    ]);
    setUsers(u);
    setBranches(b);
    setCourses(c);
    setFeedback(f);
    setLoading(false);
  };

  const filteredUsers = users.filter(u => 
    !searchQuery || 
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.phone?.includes(searchQuery)
  );

  const stats = {
    totalUsers: users.length,
    students: users.filter(u => u.role === 'student').length,
    volunteers: users.filter(u => u.role === 'volunteer').length,
    supervisors: users.filter(u => u.role === 'supervisor').length,
    totalBranches: branches.length,
    totalCourses: courses.length,
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'نظرة عامة', icon: 'grid' },
    { key: 'users', label: 'المستخدمون', icon: 'people' },
    { key: 'feedback', label: 'الفيدباك', icon: 'star' },
    { key: 'branches', label: 'الفروع', icon: 'business' },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Header title="لوحة الأدمن" />

      {/* Tab Selector */}
      <View style={{ paddingHorizontal: spacing.s5, paddingBottom: spacing.s3 }}>
        <Row gap={8}>
          {tabs.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: radii.button,
                backgroundColor: tab === t.key ? theme.brand : isDark ? 'rgba(120,120,128,0.2)' : 'rgba(120,120,128,0.1)',
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Ionicons name={t.icon as any} size={16} color={tab === t.key ? '#fff' : theme.textSecondary} />
              <Txt variant="caption" color={tab === t.key ? '#fff' : theme.textSecondary}>{t.label}</Txt>
            </Pressable>
          ))}
        </Row>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.s5, paddingBottom: 100 }}>
        {tab === 'overview' ? (
          // ═══════════════ OVERVIEW TAB ═══════════════
          <View style={{ gap: 16 }}>
            {/* Stats Grid */}
            <Row gap={12} wrap>
              <Card style={{ flex: 1, minWidth: 140, alignItems: 'center', padding: 16 }}>
                <LinearGradient
                  colors={['#007AFF', '#5856D6']}
                  style={{
                    width: 56, height: 56, borderRadius: 28,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Ionicons name="people" size={28} color="#fff" />
                </LinearGradient>
                <Txt variant="numberHero">{stats.totalUsers}</Txt>
                <Txt variant="caption" color={theme.textMuted}>إجمالي المستخدمين</Txt>
              </Card>
              <Card style={{ flex: 1, minWidth: 140, alignItems: 'center', padding: 16 }}>
                <LinearGradient
                  colors={['#34C759', '#30D158']}
                  style={{
                    width: 56, height: 56, borderRadius: 28,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Ionicons name="school" size={28} color="#fff" />
                </LinearGradient>
                <Txt variant="numberHero">{stats.students}</Txt>
                <Txt variant="caption" color={theme.textMuted}>الطلاب</Txt>
              </Card>
              <Card style={{ flex: 1, minWidth: 140, alignItems: 'center', padding: 16 }}>
                <LinearGradient
                  colors={['#FF9F0A', '#FF6B35']}
                  style={{
                    width: 56, height: 56, borderRadius: 28,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Ionicons name="person" size={28} color="#fff" />
                </LinearGradient>
                <Txt variant="numberHero">{stats.volunteers}</Txt>
                <Txt variant="caption" color={theme.textMuted}>المتطوعون</Txt>
              </Card>
              <Card style={{ flex: 1, minWidth: 140, alignItems: 'center', padding: 16 }}>
                <LinearGradient
                  colors={['#BF5AF2', '#5E5CE6']}
                  style={{
                    width: 56, height: 56, borderRadius: 28,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 8,
                  }}
                >
                  <Ionicons name="business" size={28} color="#fff" />
                </LinearGradient>
                <Txt variant="numberHero">{stats.totalBranches}</Txt>
                <Txt variant="caption" color={theme.textMuted}>الفروع</Txt>
              </Card>
            </Row>

            {/* Recent Feedback */}
            <Card>
              <Row between center style={{ marginBottom: 12 }}>
                <Txt variant="h3">آخر التقييمات</Txt>
                <Pressable onPress={() => setTab('feedback')}>
                  <Txt variant="caption" color={theme.brand}>عرض الكل</Txt>
                </Pressable>
              </Row>
              {feedback.course.slice(0, 3).map((f: any, i: number) => (
                <View key={i} style={{ marginBottom: 12 }}>
                  <Row between center>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{f.profiles?.full_name || 'مجهول'}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>{f.courses?.title || 'كورس'}</Txt>
                    </View>
                    <Row center gap={2}>
                      {[1, 2, 3, 4, 5].map(star => (
                        <Ionicons
                          key={star}
                          name={star <= f.stars ? 'star' : 'star-outline'}
                          size={14}
                          color="#FFB800"
                        />
                      ))}
                    </Row>
                  </Row>
                  {f.comment ? (
                    <Txt variant="caption" color={theme.textSecondary} style={{ marginTop: 4 }}>
                      "{f.comment}"
                    </Txt>
                  ) : null}
                </View>
              ))}
            </Card>
          </View>
        ) : tab === 'users' ? (
          // ═══════════════ USERS TAB ═══════════════
          <View style={{ gap: 12 }}>
            <Input
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="ابحث بالاسم أو الإيميل أو الرقم..."
              icon="search"
            />
            
            <Txt variant="h3">المستخدمون ({filteredUsers.length})</Txt>
            
            {filteredUsers.map((u) => (
              <Card key={u.id}>
                <Row between center>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={{
                      width: 48, height: 48, borderRadius: 24,
                      backgroundColor: u.avatar_color || '#007AFF',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Txt variant="h3" color="#fff">
                        {u.full_name?.charAt(0) || '?'}
                      </Txt>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{u.full_name || 'بدون اسم'}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>
                        {u.email || u.phone || 'بدون بيانات تواصل'}
                      </Txt>
                      {u.phone ? (
                        <Txt variant="micro" color={theme.textMuted}>{u.phone}</Txt>
                      ) : null}
                    </View>
                  </View>
                  <View style={{
                    paddingHorizontal: 10, paddingVertical: 4,
                    borderRadius: 12,
                    backgroundColor: 
                      u.role === 'admin' ? '#FF3B30' + '22' :
                      u.role === 'volunteer' ? '#FF9F0A' + '22' :
                      u.role === 'supervisor' ? '#BF5AF2' + '22' :
                      '#007AFF' + '22',
                  }}>
                    <Txt variant="micro" color={
                      u.role === 'admin' ? '#FF3B30' :
                      u.role === 'volunteer' ? '#FF9F0A' :
                      u.role === 'supervisor' ? '#BF5AF2' :
                      '#007AFF'
                    }>
                      {u.role === 'admin' ? 'أدمن' :
                       u.role === 'volunteer' ? 'متطوع' :
                       u.role === 'supervisor' ? 'مشرف' : 'طالب'}
                    </Txt>
                  </View>
                </Row>
              </Card>
            ))}
          </View>
        ) : tab === 'feedback' ? (
          // ═══════════════ FEEDBACK TAB ═══════════════
          <View style={{ gap: 16 }}>
            {/* Course Feedback */}
            <Card>
              <Txt variant="h3" style={{ marginBottom: 12 }}>تقييمات الكورسات</Txt>
              {feedback.course.length === 0 ? (
                <Txt variant="caption" color={theme.textMuted}>لا توجد تقييمات بعد</Txt>
              ) : (
                feedback.course.map((f: any, i: number) => (
                  <View key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.line }}>
                    <Row between center>
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyMed">{f.profiles?.full_name || 'مجهول'}</Txt>
                        <Txt variant="caption" color={theme.textMuted}>{f.courses?.title || 'كورس'}</Txt>
                      </View>
                      <Row center gap={2}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <Ionicons
                            key={star}
                            name={star <= f.stars ? 'star' : 'star-outline'}
                            size={14}
                            color="#FFB800"
                          />
                        ))}
                      </Row>
                    </Row>
                    {f.comment ? (
                      <Txt variant="caption" color={theme.textSecondary} style={{ marginTop: 4 }}>
                        "{f.comment}"
                      </Txt>
                    ) : null}
                    <Txt variant="micro" color={theme.textMuted} style={{ marginTop: 4 }}>
                      {new Date(f.created_at).toLocaleDateString('ar-EG')}
                    </Txt>
                  </View>
                ))
              )}
            </Card>

            {/* Instructor Feedback */}
            <Card>
              <Txt variant="h3" style={{ marginBottom: 12 }}>تقييمات المدربين</Txt>
              {feedback.instructor.length === 0 ? (
                <Txt variant="caption" color={theme.textMuted}>لا توجد تقييمات بعد</Txt>
              ) : (
                feedback.instructor.map((f: any, i: number) => (
                  <View key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.line }}>
                    <Row between center>
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyMed">{f.user_profiles?.full_name || 'مجهول'}</Txt>
                        <Txt variant="caption" color={theme.textMuted}>
                          المدرب: {f.instructor_profiles?.full_name || 'غير محدد'}
                        </Txt>
                      </View>
                      <Row center gap={2}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <Ionicons
                            key={star}
                            name={star <= f.stars ? 'star' : 'star-outline'}
                            size={14}
                            color="#FF9F0A"
                          />
                        ))}
                      </Row>
                    </Row>
                    {f.comment ? (
                      <Txt variant="caption" color={theme.textSecondary} style={{ marginTop: 4 }}>
                        "{f.comment}"
                      </Txt>
                    ) : null}
                  </View>
                ))
              )}
            </Card>

            {/* Organization Feedback */}
            <Card>
              <Txt variant="h3" style={{ marginBottom: 12 }}>تقييمات الفروع</Txt>
              {feedback.organization.length === 0 ? (
                <Txt variant="caption" color={theme.textMuted}>لا توجد تقييمات بعد</Txt>
              ) : (
                feedback.organization.map((f: any, i: number) => (
                  <View key={i} style={{ marginBottom: 12 }}>
                    <Row between center>
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyMed">{f.profiles?.full_name || 'مجهول'}</Txt>
                        <Txt variant="caption" color={theme.textMuted}>{f.branches?.name || 'فرع'}</Txt>
                      </View>
                      <Row center gap={2}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <Ionicons
                            key={star}
                            name={star <= f.stars ? 'star' : 'star-outline'}
                            size={14}
                            color="#34C759"
                          />
                        ))}
                      </Row>
                    </Row>
                    {f.comment ? (
                      <Txt variant="caption" color={theme.textSecondary} style={{ marginTop: 4 }}>
                        "{f.comment}"
                      </Txt>
                    ) : null}
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : (
          // ═══════════════ BRANCHES TAB ═══════════════
          <View style={{ gap: 12 }}>
            <Txt variant="h3">الفروع ({branches.length})</Txt>
            {branches.map((branch) => (
              <Card key={branch.id}>
                <Row between center>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={{
                      width: 48, height: 48, borderRadius: 24,
                      backgroundColor: theme.brandSoft,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name="business" size={24} color={theme.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMed">{branch.name}</Txt>
                      <Txt variant="caption" color={theme.textMuted}>{branch.governorate}</Txt>
                      {branch.address ? (
                        <Txt variant="micro" color={theme.textMuted}>{branch.address}</Txt>
                      ) : null}
                      {branch.phone ? (
                        <Row center gap={4} style={{ marginTop: 4 }}>
                          <Ionicons name="call" size={12} color={theme.success} />
                          <Txt variant="micro" color={theme.success}>{branch.phone}</Txt>
                        </Row>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {branch.avg_rating > 0 ? (
                      <Row center gap={4}>
                        <Ionicons name="star" size={16} color="#FFB800" />
                        <Txt variant="bodyMed">{branch.avg_rating}</Txt>
                      </Row>
                    ) : null}
                    <Txt variant="micro" color={theme.textMuted}>
                      {branch.rating_count} تقييم
                    </Txt>
                  </View>
                </Row>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
