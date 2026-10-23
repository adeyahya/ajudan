import { GitBranch, Globe, KeyRound, Mail, MessageCircle, Send, Webhook, type LucideIcon } from "lucide-react";
import type { MessageKey } from "@/lib/i18n";
import type { TagTone } from "@/lib/status-tones";

/** CAPABILITY in src/lib/capabilities.ts (not imported: that module reads the DB and this one ships to the browser). */
const CAPABILITY = "capability";

/** What kind of outward action an approval is about (the Inbox card's kind badge). */
export type ApprovalKind = "whatsapp" | "github" | "http" | "browser" | "ability" | "publish" | "message" | "other";

export const KIND_META: Record<ApprovalKind, { tone: TagTone; label: MessageKey; icon: LucideIcon }> = {
  whatsapp: { tone: "green", label: "approvals.kind.whatsapp", icon: MessageCircle },
  github: { tone: "gray", label: "approvals.kind.github", icon: GitBranch },
  http: { tone: "blue", label: "approvals.kind.http", icon: Webhook },
  browser: { tone: "purple", label: "approvals.kind.browser", icon: Globe },
  ability: { tone: "orange", label: "approvals.kind.ability", icon: KeyRound },
  publish: { tone: "pink", label: "approvals.kind.publish", icon: Send },
  message: { tone: "gray", label: "approvals.kind.message", icon: Mail },
  other: { tone: "gray", label: "approvals.kind.other", icon: Send },
};

/** Tool name → kind. WhatsApp first: its send_message would also match the legacy rule. */
export function approvalKind(toolName: string): ApprovalKind {
  if (toolName === CAPABILITY) return "ability";
  if (toolName.startsWith("mcp__whatsapp__")) return "whatsapp";
  if (toolName.startsWith("mcp__github__")) return "github";
  if (toolName.endsWith("__http_request")) return "http";
  if (toolName.endsWith("__confirm_browser_action")) return "browser";
  if (toolName.endsWith("__publish_deliverable")) return "publish";
  if (toolName.endsWith("send_message")) return "message";
  return "other";
}
