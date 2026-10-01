/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisSpinner — a dependency-free loading spinner.
 *
 * Why not React Native's <ActivityIndicator>? Boosthis is GUEST code dropped
 * into arbitrary host apps. `ActivityIndicator` is backed by the native view
 * `RCTActivityIndicatorView`, which is registered lazily and is NOT guaranteed
 * to be present in every host — some setups throw at render:
 *
 *   Invariant Violation: View config getter callback for component
 *   `RCTActivityIndicatorView` must be a function (received `undefined`).
 *
 * That throw inside a Boosthis card is caught by BoosthisErrorBoundary, but it
 * still collapses the whole card to the "couldn't load" fallback — so the user
 * can never reach the sign-in form. A measurement tool must never depend on a
 * native component that might be missing in its host.
 *
 * This spinner is built ONLY from <View> + the Animated API — both bedrock RN
 * primitives that are always registered (the same ones the error-boundary
 * fallback renders with) — giving an equivalent spinner with zero
 * native-component risk.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

import { safeRun } from "../safe";

export function BoosthisSpinner({
  color,
  size = 18,
}: {
  color: string;
  size?: number;
}) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animate on the JS thread (useNativeDriver: false) so this spinner carries
    // ZERO native dependency — not even NativeAnimatedModule — which is the whole
    // point of replacing ActivityIndicator (its native view was missing in a host
    // app). start()/stop() run inside safeRun because effect throws are NOT caught
    // by BoosthisErrorBoundary; if Animated ever misbehaves in some host the
    // spinner simply degrades to a static ring instead of crashing the login card.
    let loop: Animated.CompositeAnimation | undefined;
    safeRun("spinner:start", () => {
      loop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 700,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      );
      loop.start();
    });
    return () => safeRun("spinner:stop", () => loop?.stop());
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const border = Math.max(2, Math.round(size / 9));

  return (
    <View
      accessibilityRole="progressbar"
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: border,
          borderColor: color,
          borderTopColor: "transparent",
          opacity: 0.9,
          transform: [{ rotate }],
        }}
      />
    </View>
  );
}
