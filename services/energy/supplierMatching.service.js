// ======================================================
// SUPPLIER MATCHING ENGINE (Phase 4, Part 4) — pure function, same
// contract as solutionEngine.service.js: given already-scoped data
// (never queries the DB itself), it never invents a match, never
// claims stock/certification/lead time beyond what's actually
// recorded, and always explains why a supplier matched or why an
// equipment item has no match. The caller (energySupplier.controller.js
// / the public widget controller) is responsible for fetching only
// this company's own suppliers before calling this.
// ======================================================

// Phase 5.1 — `region` may still be the original free-text string
// (Phase 4 behavior, unchanged), or a structured location object
// ({city, state, country, postalCode}) from the new structured
// location feature. Either shape is reduced to an ordered list of
// candidate strings, most specific first, and existing supplier
// `serviceRegions` config (plain strings, including the wildcard
// values "pan india"/"all"/"nationwide") is matched against it exactly
// as before — this does not add geographic precision the matching
// never had; a city match is still just a case-insensitive string
// equality check against whatever a company typed into its supplier's
// region list.
function regionCandidates(region) {
  if (!region) return [];
  if (typeof region === "string") return [region];
  return [region.city, region.state, region.country].filter((v) => typeof v === "string" && v.trim());
}

function regionMatches(supplierRegions, region) {
  if (!supplierRegions || supplierRegions.length === 0) return true; // "where region restrictions apply" — none configured means no restriction
  const candidates = regionCandidates(region).map((c) => c.trim().toLowerCase());
  if (candidates.length === 0) return true; // nothing to check against
  return supplierRegions.some((r) => {
    const hay = String(r).trim().toLowerCase();
    if (hay === "pan india" || hay === "all" || hay === "nationwide") return true;
    return candidates.includes(hay);
  });
}

function describeRegion(region) {
  const candidates = regionCandidates(region);
  return candidates.length ? candidates[0] : "";
}

/**
 * @param {{equipmentId: string, name: string, mandatory?: boolean}[]} requiredEquipment
 * @param {object[]} suppliers this company's own supplier documents (already fetched)
 * @param {{fuelKey: string, projectTypeId?: string|null, region?: string|{city?:string,state?:string,country?:string,postalCode?:string}|null}} context
 */
export function matchSuppliers(requiredEquipment, suppliers, { fuelKey, projectTypeId, region } = {}) {
  const matchesByEquipment = {};
  const unmatchedEquipment = [];

  for (const item of requiredEquipment || []) {
    const equipmentId = String(item.equipmentId);
    const matches = [];

    for (const supplier of suppliers) {
      if (supplier.active === false) continue;
      const reasons = [];

      if (!(supplier.supportedFuelKeys || []).includes(fuelKey)) continue;
      reasons.push(`Supports ${fuelKey.toUpperCase()}`);

      const suppliesThisItem = (supplier.equipmentIds || []).some((id) => String(id) === equipmentId);
      if (!suppliesThisItem) continue;
      reasons.push(`Supplies "${item.name}"`);

      if (projectTypeId && (supplier.supportedProjectTypeIds || []).length > 0) {
        const supportsProjectType = supplier.supportedProjectTypeIds.some((id) => String(id) === String(projectTypeId));
        if (!supportsProjectType) continue;
        reasons.push("Supports this project type");
      }

      if (!regionMatches(supplier.serviceRegions, region)) continue;
      const regionLabel = describeRegion(region);
      if (regionLabel && (supplier.serviceRegions || []).length > 0) reasons.push(`Covers your region (${regionLabel})`);

      matches.push({
        supplierId: supplier._id,
        name: supplier.name,
        verificationStatus: supplier.verificationStatus,
        leadTimeDays: supplier.leadTimeDays,
        reasons,
      });
    }

    if (matches.length === 0) unmatchedEquipment.push({ equipmentId: item.equipmentId, name: item.name, mandatory: Boolean(item.mandatory) });
    else matchesByEquipment[equipmentId] = matches;
  }

  return { matchesByEquipment, unmatchedEquipment };
}
