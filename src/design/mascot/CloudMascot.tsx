/**
 * design/mascot/CloudMascot.tsx — واجهة توافقية لتميمة مسار الرسمية («صقر مسار - فطن»)
 * توجه كافة الاستدعاءات التراثية إلى الصقر فطن لتوحيد الهوية البصرية بنسبة 100%
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { MasarMascot } from './MasarMascot';
import { FatenBehaviorState } from './mascot.types';

export type CloudMascotMode =
  | 'idle'
  | 'happy'
  | 'celebrate'
  | 'sad'
  | 'thinking'
  | 'streak_fire';

export interface CloudMascotProps {
  size?: number;
  mode?: CloudMascotMode;
  interactive?: boolean;
  speechText?: string;
  showSpeechBubble?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

const MODE_MAP: Record<CloudMascotMode, FatenBehaviorState> = {
  idle: 'idle',
  happy: 'success',
  celebrate: 'achievement',
  sad: 'recovery',
  thinking: 'working',
  streak_fire: 'streak_fire',
};

export function CloudMascot({
  size = 130,
  mode = 'idle',
  interactive = true,
  speechText,
  showSpeechBubble = false,
  style,
  onPress,
}: CloudMascotProps) {
  const mappedBehavior = MODE_MAP[mode] || 'idle';

  return (
    <MasarMascot
      size={size}
      behavior={mappedBehavior}
      interactive={interactive}
      speechText={speechText}
      hideFloatingBubble={!showSpeechBubble}
      style={style}
      onPress={onPress}
    />
  );
}
