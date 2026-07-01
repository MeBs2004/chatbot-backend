import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
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

    sender: {
      type: String,
      enum: ["user"],
      default: "user",
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

export default mongoose.model("User", userSchema);