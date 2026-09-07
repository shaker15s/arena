/**
 * design/AnimatedTabContent.tsx — انتقال سلس بين محتوى التابات.
 *
 * الاستخدام:
 *   <Segmented value={tab} onChange={setTab} options={...} />
 *   <AnimatedTabContent tabKey={tab}>
 *     {tab === 'a' ? <ContentA /> : <ContentB />}
 *   </AnimatedTabContent>
 *
 * - المحتوى القديم يتلاشى ويتحرك طفيفًا لأسفل (~150ms)
 * - المحتوى الجديد يظهر بانزلاق ناعم من أسفل (~220ms) مع spring خفيف
 * - يحترم isReducedMotion() — عند التفعيل، الانتقال فوري
 * - الـ Segmented header يبقى ثابتًا تمامًا — فقط المحتوى يتحرك
 *
 * يعتمد على Animated API المدمج فقط — لا مكتبات إضافية.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { isReducedMotion } from './motion';
import { springs } from './tokens';

interface AnimatedTabContentProps {
  /** مفتاح التاب الحالي — عند تغييره يُشغَّل الأنيميشن */
  tabKey: string;
  children: React.ReactNode;
}

export function AnimatedTabContent({ tabKey, children }: AnimatedTabContentProps) {
  const isFirstRender = useRef(true);
  const [displayedKey, setDisplayedKey] = useState(tabKey);
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // أول رندر — لا حركة
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (tabKey === displayedKey) return;

    // Reduce Motion — انتقال فوري
    if (isReducedMotion()) {
      setDisplayedKey(tabKey);
      setDisplayedChildren(children);
      return;
    }

    // ═══ خروج: تلاشي + انزلاق طفيف لأسفل ═══
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 8,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // بعد اكتمال الخروج — تبديل المحتوى
      setDisplayedKey(tabKey);
      setDisplayedChildren(children);

      // ═══ دخول: ظهور ناعم + spring من أسفل ═══
      translateY.setValue(-6);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          damping: springs.default.damping,
          stiffness: springs.default.stiffness,
          mass: springs.default.mass,
          useNativeDriver: true,
        }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey]);

  // تحديث الأطفال عندما يتغير المحتوى بدون تغيير التاب (مثلاً بعد fetch)
  useEffect(() => {
    if (tabKey === displayedKey) {
      setDisplayedChildren(children);
    }
  }, [children, tabKey, displayedKey]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {displayedChildren}
    </Animated.View>
  );
}
