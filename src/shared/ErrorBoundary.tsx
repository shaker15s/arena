/**
 * shared/ErrorBoundary.tsx — حاجز أعطال عام.
 * قبل هذا الملف لم يكن في التطبيق أي ErrorBoundary: أي exception في شاشة
 * كان يعني شاشة بيضاء ميتة بلا مخرج. الآن يظهر كارت خطأ ثنائي اللغة مع
 * زر «إعادة المحاولة» يعيد تركيب الشجرة.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // لا يوجد نظام تتبع أخطاء بعد؛ نسجل في الكونسول للتشخيص المحلي.
    // eslint-disable-next-line no-console
    console.error('[masar] uncaught error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    // لا نستخدم DS/الثيم هنا عمدًا — الحاجز يجب أن يعمل حتى لو انهار الثيم نفسه.
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0F172A' }}>
        <View style={{ maxWidth: 420, width: '100%', backgroundColor: '#1E293B', borderRadius: 20, padding: 24, gap: 12 }}>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>⚠️</Text>
          <Text style={{ color: '#F8FAFC', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>
            حدث خطأ غير متوقع{'\n'}Something went wrong
          </Text>
          <Text style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center' }} numberOfLines={3}>
            {this.state.error.message}
          </Text>
          <Pressable
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="إعادة المحاولة — Try again"
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#2563EB' : '#3B82F6',
              borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4,
            })}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>إعادة المحاولة · Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}
