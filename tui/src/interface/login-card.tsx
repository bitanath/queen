/* @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";

import { pollPairing, startPairing } from "../utils/bee-com-bridge";
import { useTheme } from "../theme/use-theme";
import { Card } from "../components/card";

type Phase = "starting" | "waiting" | "error";

export function LoginCard({ onConnected, onCancel }: { onConnected: () => void; onCancel?: () => void }) {
  const theme = useTheme();
  const renderer = useRenderer();
  const [phase, setPhase] = useState<Phase>("starting");
  const [url, setUrl] = useState<string>("");
  const [qr, setQr] = useState<string>("");
  const [error, setError] = useState<string>("");
  const cancel = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const start = await startPairing({ withQr: true });
        if (!alive) return;
        setUrl(start.pairingUrl);
        setQr(start.qr ?? "");
        setPhase("waiting");
        const outcome = await pollPairing({ isCancelled: () => cancel.current });
        if (!alive) return;
        void outcome;
        onConnected();
      } catch (e) {
        if (!alive || cancel.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
      cancel.current = true;
    };
  }, [onConnected]);

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      key.preventDefault();
      cancel.current = true;
      if (onCancel) onCancel();
      else {
        renderer.destroy();
        process.exit(0);
      }
    }
  });

  return (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <Card title="bee login" width={Math.min(72, 60)}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.colors.warning}>
            <b>You are not logged in.</b>
          </text>
          {phase === "starting" && <text fg={theme.colors.mutedForeground}>starting pairing…</text>}
          {phase === "waiting" && (
            <>
              <text fg={theme.colors.foreground}>Approve this device in the Bee app:</text>
              <text fg={theme.colors.primary}>{url}</text>
              {qr.length > 0 && <text fg={theme.colors.foreground}>{qr}</text>}
              <text fg={theme.colors.mutedForeground}>waiting for approval… (esc to cancel)</text>
            </>
          )}
          {phase === "error" && <text fg={theme.colors.error}>{error}</text>}
        </box>
      </Card>
    </box>
  );
}
