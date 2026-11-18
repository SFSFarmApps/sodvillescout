(function (root) {
  'use strict';

  const hour = 3600000;
  const wetFieldReport = {
    observedAt: Date.parse('2026-11-18T12:00:00-06:00'),
    reason: 'Nov. 18 field report: wet across Scout blocks. Smith West photos confirm wet ground.'
  };
  const result = (score, reason) => ({
    score,
    status: score === null ? 'INSUFFICIENT DATA' : score < 50 ? 'TOO WET' : score < 85 ? 'MARGINAL' : 'WORKABLE',
    reason
  });

  function assess(fieldId, feed, soils, now = Date.now()) {
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
    const names = (soils || []).map(soil => soil.properties?.muname || '').join(' ').toLowerCase();
    if (!names.trim()) return result(null, 'Waiting for soil classification');
    const slow = /clay|victoria|raymondville|lomalta|orelia/.test(names);
    const fast = !slow && /sand|sandy|loamy sand/.test(names);
    const factor = slow ? 1.25 : fast ? 0.75 : 1;
    const reasons = [slow ? 'Slow-drying clay' : fast ? 'Fast-drying sandy soil' : 'Moderate-drying soil'];
    const last24 = rain.rain24h * factor;
    const prior24 = Math.max(0, rain.rain48h - rain.rain24h) * factor;
    const oldest24 = Math.max(0, rain.rain72h - rain.rain48h) * factor;
    let penalty = slow ? 8 : 0;
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

    let score = 100 - Math.min(100, Math.round(penalty));
    // These are conservative review thresholds, pending local field validation.
    const ageAtUpdate = rain.daysSince050;
    const ageNow = ageAtUpdate + Math.max(0, now - (Date.parse(feed.updatedUtc) || observedAt)) / (24 * hour);
    if (slow && Number.isFinite(ageAtUpdate) && ageAtUpdate >= 0 && ageNow < 5) {
      score = Math.min(score, 75);
      reasons.push('At least 0.50″ in a single recorded hour within the last five days');
    }
    if (slow && Number.isFinite(rain.rain7d) && rain.rain7d >= 1) {
      score = Math.min(score, 75);
      reasons.push(rain.rain7d.toFixed(2) + '″ in seven days');
    }
    if (reportAge >= 24 && reportAge < 72) {
      score = Math.min(score, 75);
      reasons.push('Nov. 18 wet-field report. Recheck ground before working.');
    }
    return result(score, reasons.join(' • '));
  }

  root.SodvilleWorkability = { assess };
})(typeof module === 'object' ? module.exports : globalThis);
