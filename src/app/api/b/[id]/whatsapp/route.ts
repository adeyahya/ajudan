import QRCode from "qrcode";
import { linkState, readSyncStatus } from "@/lib/whatsapp";

/** Polled by the WhatsApp panel while linking: current state plus the QR as an image. */
export async function GET() {
  const state = await linkState();
  const qr =
    state.state === "qr"
      ? await QRCode.toDataURL(state.code, { margin: 1, width: 280, color: { dark: "#2a1d22", light: "#f8f0e3" } })
      : null;
  return Response.json({ ...state, qr, code: undefined, sync: readSyncStatus() }, { headers: { "Cache-Control": "no-store" } });
}
