import mongoose from "mongoose";
import { buildOfferingSchema } from "./offeringSchema.js";

// A project category/type under one of a company's fuels (Section 6)
// — e.g. under "solar": "Residential Solar", "Solar + Battery Storage".
const projectTypeSchema = buildOfferingSchema();
projectTypeSchema.index({ companyId: 1, fuelKey: 1, label: 1 }, { unique: true });

export default mongoose.model("EnergyProjectType", projectTypeSchema);
