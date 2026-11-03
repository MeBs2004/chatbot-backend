// Pure-logic tests for the Phase 4 supplier matching engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSuppliers } from "../services/energy/supplierMatching.service.js";

const REQUIRED = [
  { equipmentId: "eq_panel", name: "550W Panel", mandatory: true },
  { equipmentId: "eq_inverter", name: "5kW Inverter", mandatory: true },
];

const SUPPLIER_A = { _id: "sup_a", name: "Acme Solar Supplies", active: true, supportedFuelKeys: ["solar"], equipmentIds: ["eq_panel"], supportedProjectTypeIds: [], serviceRegions: [], verificationStatus: "verified", leadTimeDays: 7 };
const SUPPLIER_B = { _id: "sup_b", name: "Beta Power Co", active: true, supportedFuelKeys: ["solar"], equipmentIds: ["eq_panel", "eq_inverter"], supportedProjectTypeIds: [], serviceRegions: ["Maharashtra"], verificationStatus: "unverified", leadTimeDays: 14 };
const SUPPLIER_C_INACTIVE = { _id: "sup_c", name: "Inactive Co", active: false, supportedFuelKeys: ["solar"], equipmentIds: ["eq_panel"], serviceRegions: [] };
const SUPPLIER_D_WRONG_FUEL = { _id: "sup_d", name: "CNG Only Co", active: true, supportedFuelKeys: ["cng"], equipmentIds: ["eq_panel"], serviceRegions: [] };

test("matches suppliers that support the fuel and supply the equipment; excludes inactive and wrong-fuel suppliers", () => {
  const result = matchSuppliers(REQUIRED, [SUPPLIER_A, SUPPLIER_B, SUPPLIER_C_INACTIVE, SUPPLIER_D_WRONG_FUEL], { fuelKey: "solar" });
  const panelMatches = result.matchesByEquipment.eq_panel.map((m) => m.supplierId);
  assert.deepEqual(panelMatches.sort(), ["sup_a", "sup_b"]);
  assert.equal(result.matchesByEquipment.eq_inverter.length, 1);
  assert.equal(result.matchesByEquipment.eq_inverter[0].supplierId, "sup_b");
});

test("an equipment item with no qualifying supplier is reported as unmatched, not silently dropped", () => {
  const result = matchSuppliers(REQUIRED, [SUPPLIER_A], { fuelKey: "solar" }); // A doesn't supply the inverter
  assert.equal(result.unmatchedEquipment.length, 1);
  assert.equal(result.unmatchedEquipment[0].equipmentId, "eq_inverter");
  assert.equal(result.matchesByEquipment.eq_panel.length, 1);
});

test("region restriction: a supplier with configured regions only matches within them; one with no regions configured has no restriction", () => {
  const regional = { ...SUPPLIER_B, serviceRegions: ["Gujarat"] };
  const unrestricted = { ...SUPPLIER_A, serviceRegions: [] };
  const inGujarat = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [regional, unrestricted], { fuelKey: "solar", region: "Gujarat" });
  assert.equal(inGujarat.matchesByEquipment.eq_panel.length, 2, "both the regional match and the unrestricted supplier qualify");

  const inKerala = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [regional, unrestricted], { fuelKey: "solar", region: "Kerala" });
  const keralaSupplierIds = inKerala.matchesByEquipment.eq_panel.map((m) => m.supplierId);
  assert.ok(!keralaSupplierIds.includes(regional._id), "a Gujarat-only supplier shouldn't match a Kerala project");
  assert.ok(keralaSupplierIds.includes(unrestricted._id));
});

test("a 'Pan India' supplier matches any region", () => {
  const panIndia = { ...SUPPLIER_A, serviceRegions: ["Pan India"] };
  const result = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [panIndia], { fuelKey: "solar", region: "Assam" });
  assert.equal(result.matchesByEquipment.eq_panel.length, 1);
});

test("project type restriction: a supplier with configured project types only matches those; reasons explain the match", () => {
  const restricted = { ...SUPPLIER_A, supportedProjectTypeIds: ["pt_residential"] };
  const matchingPT = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [restricted], { fuelKey: "solar", projectTypeId: "pt_residential" });
  assert.equal(matchingPT.matchesByEquipment.eq_panel.length, 1);
  assert.ok(matchingPT.matchesByEquipment.eq_panel[0].reasons.some((r) => /project type/i.test(r)));

  const wrongPT = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [restricted], { fuelKey: "solar", projectTypeId: "pt_commercial" });
  assert.equal(wrongPT.unmatchedEquipment.length, 1);
});

test("never fabricates verification or lead time — passes through exactly what's recorded", () => {
  const result = matchSuppliers([{ equipmentId: "eq_panel", name: "Panel" }], [SUPPLIER_B], { fuelKey: "solar" });
  const match = result.matchesByEquipment.eq_panel[0];
  assert.equal(match.verificationStatus, "unverified");
  assert.equal(match.leadTimeDays, 14);
});
