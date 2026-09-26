import mongoose from "mongoose";

// ======================================================
// CONVERSATION (Phase 8)
// Existing User/Bot/Visitor records cannot represent this phase's
// required state — no field anywhere durably says "this visitor's
// thread is owned by Agent X" or "AI is paused for this visitor"
// (see Phase 8 audit: the only prior signal was a per-message
// Bot.type === "handoff" classification, which the very next AI
// reply would silently overwrite). This model adds exactly that
// missing state as a thin overlay keyed the same way Visitor already
// is — message CONTENT still lives entirely in the existing User/Bot
// collections, untouched; this collection never stores message text
// itself except an internal-notes array and a denormalized preview.
//
// One Conversation per (companyId, visitorId) for that visitor's
// entire lifetime, mirroring Visitor's own unique key exactly —
// there is no session-boundary concept anywhere else in this
// codebase (messages already accumulate continuously per visitor
// forever), so inventing one here would be inconsistent. Closing and
// reopening toggle `status` on the same document; they never create
// a second Conversation for the same visitor.
// ======================================================

const noteSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },
    authorName: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const conversationSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },

    // Informational, not an authorization boundary by itself for
    // list queries (company-level filtering remains authoritative
    // there) — but IS re-checked via hasChatbotAccess for single-
    // conversation read/write endpoints. Null when a company has zero
    // or more than one Chatbot record (see chatbot.resolver.js) —
    // the same ambiguous-case fallback every other phase uses.
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", default: null, index: true },

    visitorId: { type: String, required: true, trim: true, index: true },

    status: {
      type: String,
      enum: ["OPEN", "PENDING", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    // AI: the existing chatbot pipeline (flow engine / keyword
    // handoff / webhook / Groq, unchanged) answers automatically.
    // HUMAN: automatic replies are fully suspended for this visitor
    // — see chatbot.message.js's mode check, which runs before any
    // of those systems are even reached.
    mode: {
      type: String,
      enum: ["AI", "HUMAN"],
      default: "AI",
      index: true,
    },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null, index: true },

    handoffAt: { type: Date, default: null },
    handoffReason: {
      type: String,
      enum: ["keyword", "flow_node", "manual", null],
      default: null,
    },

    startedAt: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    // Tracks ONLY the visitor's own most recent message — deliberately
    // separate from `lastMessageAt` (which any activity, including an
    // agent reply, also bumps for inbox sort order). This is the
    // cutoff used to find "agent replies the visitor hasn't been
    // shown yet" (see conversation.service.js
    // getPendingAgentReplySince) — using `lastMessageAt` there would
    // find nothing, since an agent's own reply already moved it
    // forward past itself.
    lastVisitorMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: "", trim: true, maxlength: 300 },
    lastSender: {
      type: String,
      enum: ["visitor", "ai", "agent", "system", null],
      default: null,
    },

    // Simplest correct read-state: every visitor message increments
    // it; any authenticated thread fetch resets it to 0 (see
    // conversation.service.js markRead). No per-message read
    // tracking — that would need a schema far beyond what this phase
    // requires.
    unreadCount: { type: Number, default: 0, min: 0 },

    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },

    // Only one real channel exists today (the public widget) — a
    // real field, not a placeholder for channels that don't exist
    // yet (see Phase 8 report, Known Limitations).
    source: { type: String, default: "widget" },

    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true }
);

conversationSchema.index({ companyId: 1, visitorId: 1 }, { unique: true });
conversationSchema.index({ companyId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ companyId: 1, assignedTo: 1 });

// Phase 9 — each supports one specific analytics query, not a blanket
// "index everything": chatbot-scoped "conversations started in range"
// ($match companyId+chatbotId+startedAt range), "handoffs in range"
// ($match companyId+handoffAt range), "closed in range" (same for
// closedAt). Sparse isn't used since these fields are meaningful
// `null` for most documents, not "field never applies".
conversationSchema.index({ companyId: 1, chatbotId: 1, startedAt: 1 });
conversationSchema.index({ companyId: 1, handoffAt: 1 });
conversationSchema.index({ companyId: 1, closedAt: 1 });

export default mongoose.model("Conversation", conversationSchema);
