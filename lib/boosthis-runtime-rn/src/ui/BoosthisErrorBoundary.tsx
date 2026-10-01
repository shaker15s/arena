/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisErrorBoundary — the SDK→host safety net.
 *
 * Boosthis is a drop-in performance toolkit: it renders its own UI INSIDE a
 * host app it does not control. A render-time throw anywhere in a Boosthis UI
 * component (a meter compute hitting unexpected real-device data, a malformed
 * cached snapshot, etc.) would otherwise bubble up to the host's root and crash
 * the WHOLE app — exactly what a measurement tool must never do.
 *
 * This class component contains any such throw so the failure stays local:
 * Boosthis degrades to a quiet fallback (or nothing) while the host app keeps
 * running. The Boosthis UI is wrapped in these boundaries at three levels
 * (engine panel, dashboard, launcher modal) so one failing card never takes
 * down the rest of the dashboard, let alone the host.
 *
 * Pure React on purpose: it imports NO react-native primitives and renders only
 * `children` or a caller-supplied `fallback`, so the boundary itself has no
 * surface that can throw, and it drops into any React renderer unchanged.
 *
 * Privacy: a caught error's message/stack can contain app data, and Boosthis's
 * contract is that nothing leaves the device without passing the PII guard. The
 * boundary itself never transmits or persists the raw error — it logs once to
 * the on-device console in __DEV__ only. It DOES hand the error to the crash
 * reporter (`reportRenderError`), but that path is privacy-safe by construction:
 * the reporter redacts the error to a closed, PII-scrubbed fingerprint on-device
 * (and is a no-op unless the app enabled telemetry), so the raw message/stack
 * still never leaves the device. Failing soft + silent is the correct posture
 * for a drop-in SDK.
 */
import React from "react";
import { reportRenderError } from "../crashReporter";

export interface BoosthisErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Rendered in place of `children` after a caught error. Defaults to `null`
   * (render nothing), which is the right choice for an outermost net where the
   * host should simply see Boosthis disappear rather than show an error.
   */
  fallback?: React.ReactNode;
  /**
   * Render-prop fallback shown after a caught error, receiving a `reset()` that
   * clears the error so the subtree re-mounts and the user can retry, plus the
   * caught `error` itself so the fallback can show a short, on-device-only
   * diagnostic line (name + first message line — never a stack, never
   * transmitted). Takes precedence over `fallback`. This lets a full-screen
   * Boosthis surface (the dashboard or the terms/connect gate) show a VISIBLE
   * "couldn’t load — try again" card instead of collapsing to a silent black
   * void inside the host's own modal. The boundary itself stays pure React — the
   * caller supplies the element, so no react-native primitive is imported here.
   */
  fallbackRender?: (reset: () => void, error?: unknown) => React.ReactNode;
  /** Optional label included in the __DEV__ console warning to identify which
   * Boosthis surface failed (e.g. "engine-panel"). Never transmitted. */
  name?: string;
}

interface BoosthisErrorBoundaryState {
  hasError: boolean;
  /** The caught error, surfaced to `fallbackRender` for an on-device-only
   *  diagnostic line. Never transmitted, persisted, or uploaded. */
  error?: unknown;
}

export class BoosthisErrorBoundary extends React.Component<
  BoosthisErrorBoundaryProps,
  BoosthisErrorBoundaryState
> {
  state: BoosthisErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): BoosthisErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    // Hand the render throw to the crash reporter as an SDK-internal crash
    // (kind: "render"). The reporter redacts on-device to a PII-scrubbed
    // fingerprint and is a no-op unless telemetry was enabled, so the raw
    // error never leaves the device. Wrapped defensively so a fault here can
    // never break the boundary's own contract of failing soft + silent.
    try {
      reportRenderError(error);
    } catch {
      // Boundary must never throw from its own error handler.
    }
    // On-device, dev-only console diagnostic. We never log the raw error
    // off-device; the privacy contract forbids sending anything that has not
    // passed the PII guard.
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
    if (dev) {
      const where = this.props.name ? ` (${this.props.name})` : "";
      // eslint-disable-next-line no-console
      console.warn(
        `[boosthis] UI error contained by internal boundary${where} — ` +
          `Boosthis failed soft so the host app keeps running:`,
        error,
        info?.componentStack ?? "",
      );
    }
  }

  /**
   * Clear the error so children re-mount on the next render — the "Try again"
   * affordance behind the visible fallback. Arrow property for a stable
   * identity that can be passed straight to the render prop.
   */
  private reset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallbackRender) {
        return this.props.fallbackRender(this.reset, this.state.error);
      }
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
