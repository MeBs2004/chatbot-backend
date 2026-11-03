// One-off: the industry picker dropped "Technology" (now Energy/Education/
// Digital Marketing/General/Other). Moves the 2 existing companies still on
// it ("Facebook", "Apple") to "Other".
//
// Run from backend/: node scripts/migrateTechnologyIndustry.mjs
import "dotenv/config";
import mongoose from "mongoose";
import Company from "../models/company.model.js";

await mongoose.connect(process.env.MONGO_URI);
const before = await Company.find({ industry: "Technology" }).select("_id name industry").lean();
console.log("Companies to migrate:", before);

const res = await Company.updateMany({ industry: "Technology" }, { $set: { industry: "Other" } });
console.log("Modified:", res.modifiedCount);

await mongoose.disconnect();
