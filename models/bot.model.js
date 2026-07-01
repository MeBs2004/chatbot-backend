import mongoose from "mongoose";

const botSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    visitorId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Bot", botSchema);