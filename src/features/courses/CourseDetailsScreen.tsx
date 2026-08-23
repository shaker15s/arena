/**
 * features/courses/CourseDetailsScreen.tsx — شاشة تفاصيل الكورس الكاملة
 * مع كل المعلومات (المدرب، الفرع، التقييمات، التسجيل)
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../design/theme';
import { useI18n } from '../../i18n';
import { Txt, Btn, Card, Row, Spacer, Stars } from '../../design/components';
import { Header } from '../../design/components';
import { spacing, radii } from '../../design/tokens';
import { fetchCourseDetails, fetchBatchesForCourse, enrollStudent } from '../../data/queries';
import type { CourseInfo, BatchInfo } from '../../data/queries';
import { useApp } from '../../data/store';
import { getSupabase } from '../../data/supabase';

export function CourseDetailsScreen({ route, navigation }: any) {
  const { courseId } = route.params;
  const { theme, isDark } = useTheme();
  const { t } = useI18n();
  const { user } = useApp();
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    loadCourse();
  }, [courseId]);

  const loadCourse = async () => {
    setLoading(true);
    const [courseData, batchesData] = await Promise.all([
      fetchCourseDetails(courseId),
      fetchBatchesForCourse(courseId),
    ]);
    setCourse(courseData);
    setBatches(batchesData);
    setLoading(false);
  };

  const handleEnroll = async (batchId: string) => {
    if (!user) return;
    setEnrolling(true);
    
    // Get actual user_id from profiles
    const sb = getSupabase();
    const { data: profile } = await sb
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profile && (profile as any).id) {
      const success = await enrollStudent((profile as any).id, batchId);
      if (success) {
        alert('تم التسجيل بنجاح! 🎉');
        loadCourse();
      }
    }
    setEnrolling(false);
  };

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <Header title="جاري التحميل..." back={() => navigation.goBack()} />
      </View>
    );
  }

  if (!course) {
    return (
      <View style={{ flex: 1 }}>
        <Header title="خطأ" back={() => navigation.goBack()} />
        <Txt variant="body" align="center">لم يتم العثور على الكورس</Txt>
      </View>
    );
  }

  const dayNames = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Header Gradient */}
        <LinearGradient
          colors={[course.color, course.color + 'CC']}
          style={{ paddingTop: 60, paddingBottom: 30, paddingHorizontal: spacing.s5 }}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
            <View style={{
              width: 80, height: 80, borderRadius: 24,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="book" size={40} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="h1" color="#fff">{course.title}</Txt>
              <Spacer size={6} />
              <Row gap={12}>
                <Row center gap={4}>
                  <Ionicons name="folder" size={14} color="rgba(255,255,255,0.8)" />
                  <Txt variant="caption" color="rgba(255,255,255,0.9)">{course.field}</Txt>
                </Row>
                <Row center gap={4}>
                  <Ionicons name="time" size={14} color="rgba(255,255,255,0.8)" />
                  <Txt variant="caption" color="rgba(255,255,255,0.9)">{course.sessions_count} محاضرات</Txt>
                </Row>
              </Row>
            </View>
          </View>

          {/* Stats */}
          <Spacer size={16} />
          <Row gap={16}>
            <Card glass style={{ flex: 1, padding: 12, alignItems: 'center' }}>
              <Row center gap={4}>
                <Ionicons name="star" size={18} color="#FFB800" />
                <Txt variant="h3" color="#fff">{course.avg_rating || '—'}</Txt>
              </Row>
              <Txt variant="micro" color="rgba(255,255,255,0.8)">{course.rating_count} تقييم</Txt>
            </Card>
            <Card glass style={{ flex: 1, padding: 12, alignItems: 'center' }}>
              <Row center gap={4}>
                <Ionicons name="people" size={18} color="#fff" />
                <Txt variant="h3" color="#fff">{course.enrolled_count}/{course.capacity}</Txt>
              </Row>
              <Txt variant="micro" color="rgba(255,255,255,0.8)">طالب مسجل</Txt>
            </Card>
          </Row>
        </LinearGradient>

        {/* Info Section */}
        <View style={{ padding: spacing.s5, gap: 16 }}>
          {/* Instructor & Branch */}
          {course.instructor_name || course.branch_name ? (
            <Card>
              <Txt variant="h3" style={{ marginBottom: 12 }}>المعلومات الأساسية</Txt>
              {course.instructor_name ? (
                <Row center gap={10} style={{ marginBottom: 8 }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: theme.brandSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="person" size={18} color={theme.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="caption" color={theme.textMuted}>المدرب</Txt>
                    <Txt variant="bodyMed">{course.instructor_name}</Txt>
                  </View>
                </Row>
              ) : null}
              {course.branch_name ? (
                <Row center gap={10}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: theme.successSoft,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="location" size={18} color={theme.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="caption" color={theme.textMuted}>الفرع</Txt>
                    <Txt variant="bodyMed">{course.branch_name}</Txt>
                  </View>
                </Row>
              ) : null}
            </Card>
          ) : null}

          {/* Description */}
          {course.description ? (
            <Card>
              <Txt variant="h3" style={{ marginBottom: 8 }}>عن الكورس</Txt>
              <Txt variant="body" color={theme.textSecondary}>{course.description}</Txt>
            </Card>
          ) : null}

          {/* Topics */}
          {course.topics && course.topics.length > 0 ? (
            <Card>
              <Txt variant="h3" style={{ marginBottom: 12 }}>محاور الكورس</Txt>
              {course.topics.map((topic: string, i: number) => (
                <Row key={i} center gap={10} style={{ marginBottom: 8 }}>
                  <View style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: course.color + '22',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Txt variant="caption" color={course.color} bold>{i + 1}</Txt>
                  </View>
                  <Txt variant="body" style={{ flex: 1 }}>{topic}</Txt>
                </Row>
              ))}
            </Card>
          ) : null}

          {/* Batches */}
          {batches.length > 0 ? (
            <View>
              <Txt variant="h2" style={{ marginBottom: 12 }}>المجموعات المتاحة</Txt>
              {batches.map((batch) => (
                <Card key={batch.id} style={{ marginBottom: 12 }}>
                  <View style={{ gap: 10 }}>
                    <Row between center>
                      <View style={{ flex: 1 }}>
                        <Row center gap={6}>
                          <Ionicons name="calendar" size={16} color={theme.brand} />
                          <Txt variant="bodyMed">
                            {batch.start_date ? new Date(batch.start_date).toLocaleDateString('ar-EG') : 'قريباً'}
                          </Txt>
                        </Row>
                        {batch.room ? (
                          <Row center gap={4} style={{ marginTop: 4 }}>
                            <Ionicons name="location-outline" size={14} color={theme.textMuted} />
                            <Txt variant="caption" color={theme.textMuted}>{batch.room}</Txt>
                          </Row>
                        ) : null}
                        {batch.schedule?.days ? (
                          <Row center gap={4} style={{ marginTop: 4 }} wrap>
                            <Ionicons name="time-outline" size={14} color={theme.textMuted} />
                            {batch.schedule.days.map((d: number) => (
                              <Txt key={d} variant="micro" color={theme.textSecondary}>
                                {dayNames[d]}
                              </Txt>
                            ))}
                            <Txt variant="micro" color={theme.textSecondary}>
                              {batch.schedule.time}
                            </Txt>
                          </Row>
                        ) : null}
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Txt variant="h3">{batch.enrolled_count}/{batch.capacity}</Txt>
                        <Txt variant="micro" color={theme.textMuted}>مقعد</Txt>
                      </View>
                    </Row>
                    <Btn
                      title={batch.enrolled_count >= batch.capacity ? 'قائمة الانتظار' : 'سجّل الآن'}
                      onPress={() => handleEnroll(batch.id)}
                      loading={enrolling}
                      full
                      icon="add-circle"
                    />
                  </View>
                </Card>
              ))}
            </View>
          ) : (
            <Card style={{ alignItems: 'center', padding: 24 }}>
              <Ionicons name="calendar-outline" size={48} color={theme.textMuted} />
              <Spacer size={8} />
              <Txt variant="bodyMed" align="center">لا توجد مجموعات متاحة حالياً</Txt>
              <Txt variant="caption" color={theme.textMuted} align="center">
                تابع الكورس لمعرفة المواعيد الجديدة
              </Txt>
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
