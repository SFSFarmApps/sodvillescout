(function (root) {
  'use strict';

  const hour = 3600000;
  const soilProfiles = new WeakMap();
  const wetFieldReport = {
    observedAt: Date.parse('2026-11-18T12:00:00-06:00'),
    reason: 'Nov. 18 field report: wet across Scout blocks. Smith West photos confirm wet ground.'
  };
  const result = (score, reason) => ({
    score,
    status: score === null ? 'INSUFFICIENT DATA' : score < 50 ? 'TOO WET' : score < 85 ? 'MARGINAL' : 'WORKABLE',
    reason
  });

  function soilProfile(soils, areaOf) {
    if (!soils?.length) return null;
    const cached = soilProfiles.get(soils);
    if (cached && cached.areaOf === areaOf) return cached.profile;
    let total = 0, clay = 0, sand = 0;
    for (const soil of soils) {
      const name = (soil.properties?.muname || '').trim().toLowerCase();
      if (!name) continue;
      const area = areaOf && soil.geometry ? areaOf(soil) : 1;
      if (!Number.isFinite(area) || area <= 0) continue;
      total += area;
      if (/clay|victoria|raymondville|lomalta|orelia/.test(name)) clay += area;
      else if (/sand|sandy/.test(name)) sand += area;
    }
    const profile = total ? { clay: clay / total, sand: sand / total } : null;
    soilProfiles.set(soils, { areaOf, profile });
    return profile;
  }

  function assess(fieldId, feed, soils, now = Date.now(), areaOf) {
    const reportAge = (now - wetFieldReport.observedAt) / hour;
    if (reportAge >= 0 && reportAge < 24) return result(25, wetFieldReport.reason);

    const observedAt = Date.parse(feed?.observedUtc || feed?.updatedUtc);
    const rain = feed?.fields?.[fieldId];
    if (!Number.isFinite(observedAt) || now - observedAt > 12 * hour || observedAt - now > hour) {
      return result(null, 'Waiting for current rainfall observations');
    }
    if (!rain || !['rain24h', 'rain48h', 'rain72h'].every(key => Number.isFinite(rain[key]) && rain[key] >= 0)) {
      return result(null, 'Waiting for complete rainfall data');
    }
    const soil = soilProfile(soils, areaOf);
    if (!soil) return result(null, 'Waiting for soil classification');
    const factor = 1 + 0.25 * (soil.clay - soil.sand);
    const reasons = [soil.clay
      ? Math.round(soil.clay * 100) + '% slow-drying clay'
      : soil.sand ? Math.round(soil.sand * 100) + '% fast-drying sandy soil' : 'Moderate-drying soil'];
    const last24 = rain.rain24h * factor;
    const prior24 = Math.max(0, rain.rain48h - rain.rain24h) * factor;
    const oldest24 = Math.max(0, rain.rain72h - rain.rain48h) * factor;
    let penalty = 8 * soil.clay;
    if (last24 >= 1) penalty += 70;
    else if (last24 >= 0.5) penalty += 52;
    else if (last24 >= 0.25) penalty += 34;
    else if (last24 >= 0.1) penalty += 18;
    if (prior24 >= 0.5) penalty += 28;
    else if (prior24 >= 0.25) penalty += 18;
    else if (prior24 >= 0.1) penalty += 8;
    if (oldest24 >= 0.5) penalty += 18;
    else if (oldest24 >= 0.25) penalty += 11;
    else if (oldest24 >= 0.1) penalty += 5;
    if (rain.rain24h > 0) reasons.push(rain.rain24h.toFixed(2) + '″ in 24 hours');

    // Use older observations as a small residual when the recent-rain windows are dry.
    const updatedAt = Date.parse(feed.updatedUtc);
    const daysSinceFeed = Math.max(0, now - (Number.isFinite(updatedAt) ? updatedAt : observedAt)) / (24 * hour);
    const age010 = Number.isFinite(rain.daysSince010) && rain.daysSince010 >= 0
      ? rain.daysSince010 + daysSinceFeed : Infinity;
    if (age010 >= 3 && age010 < 7) {
      penalty += (7 - age010) * 2.5 * factor;
      reasons.push('Last recorded 0.10″ hour was ' + age010.toFixed(1) + ' days ago');
    }

    let score = Math.max(0, 100 - penalty);
    const age050 = Number.isFinite(rain.daysSince050) && rain.daysSince050 >= 0
      ? rain.daysSince050 + daysSinceFeed : Infinity;
    const recentHeavyRain = soil.clay > 0 && age050 < 5;
    const wetWeek = soil.clay > 0 && Number.isFinite(rain.rain7d) && rain.rain7d >= 1;
    if (recentHeavyRain) {
      reasons.push('At least 0.50″ in a single recorded hour within the last five days');
    }
    if (wetWeek) {
      reasons.push(rain.rain7d.toFixed(2) + '″ in seven days');
    }
    const recoveringFromWetReport = reportAge >= 24 && reportAge < 72;
    if (recoveringFromWetReport) {
      reasons.push('Nov. 18 wet-field report. Recheck ground before working.');
    }
    if ((recentHeavyRain || wetWeek || recoveringFromWetReport) && score > 50) {
      // Keep recovery ratings marginal while retaining differences between fields.
      score = 50 + (score - 50) * 0.64;
    }
    return result(Math.round(score), reasons.join(' • '));
  }

  root.SodvilleWorkability = { assess };
})(typeof module === 'object' ? module.exports : globalThis);
