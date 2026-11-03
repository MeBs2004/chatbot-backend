import mongoose from "mongoose";
import { buildOfferingSchema } from "./offeringSchema.js";

// A product/service a company offers under one of its fuels (Section 5)
// — e.g. under "cng": "CNG Station Setup", "Mother Station", "CNG
// Dispensers". Selecting a fuel never implies every product under it
// is offered; a company explicitly enables the ones it actually sells.
const productServiceSchema = buildOfferingSchema();
productServiceSchema.index({ companyId: 1, fuelKey: 1, label: 1 }, { unique: true });

export default mongoose.model("EnergyProductService", productServiceSchema);
