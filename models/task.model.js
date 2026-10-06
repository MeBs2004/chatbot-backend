import mongoose from "mongoose";

// ======================================================
// TASK
// General-purpose internal task assignment — distinct from
// Conversation.assignedTo (a single field on a conversation, with no
// status/priority/due-date lifecycle of its own). No prior art for
// this existed anywhere in the codebase (confirmed by audit).
// Mirrors Conversation.assignedTo's convention: single assignee,
// `null` = unassigned, cleared on user deactivation (see
// user.controller.js's unassignConversations, which this follows the
// same pattern for via unassignTasks in task.service.js).
// ======================================================

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"],
      default: "TODO",
      index: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
    },

    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    assigneeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    dueDate: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

taskSchema.index({ companyId: 1, assigneeId: 1 });
taskSchema.index({ companyId: 1, status: 1 });

export default mongoose.model("Task", taskSchema);
