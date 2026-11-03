"""Collect raw NOAA MRMS pixels; publish only validated, current observations."""
import datetime as dt
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer/'
UTC = dt.timezone.utc
MAX_AGE = dt.timedelta(hours=3)


def request_json(operation, params):
    url = BASE + operation + '?' + urllib.parse.urlencode(params)
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'SodvilleRainfall/2.0'})
            with urllib.request.urlopen(req, timeout=35) as response:
                result = json.load(response)
            if result.get('error'):
                raise ValueError('NOAA service error: ' + str(result['error']))
            return result
        except Exception as error:
            last = error
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError('NOAA ' + operation + ' unavailable: ' + str(last))


def field_metadata(html):
    marker = 'window.SODVILLE_FIELDS = '
    geo, _ = json.JSONDecoder().raw_decode(html[html.index(marker) + len(marker):])

    def coordinates(obj):
        if isinstance(obj, list) and len(obj) >= 2 and all(isinstance(x, (float, int)) for x in obj[:2]):
            yield obj[:2]
        elif isinstance(obj, list):
            for child in obj:
                yield from coordinates(child)

    result = []
    for feature in geo['features']:
        points = list(coordinates(feature['geometry']['coordinates']))
        if not points:
            raise ValueError('Field geometry is missing.')
        props = feature['properties']
        result.append({'fieldId': str(props['FIELD_ID']), 'fieldName': props.get('FIELD_NAME', ''),
                       'farmName': props.get('FARM_NAME', ''),
                       'point': {'lon': round(sum(p[0] for p in points) / len(points), 6),
                                 'lat': round(sum(p[1] for p in points) / len(points), 6)}})
    if not result or len({m['fieldId'] for m in result}) != len(result):
        raise ValueError('Field inventory is empty or has duplicate IDs.')
    return result


def catalog(now, fetch=request_json):
    data = fetch('query', {'where': "category = 1 AND idp_subset LIKE 'conus_QPE_%'",
                          'outFields': 'objectid,idp_subset,idp_validendtime',
                          'returnGeometry': 'false', 'f': 'json'})
    if data.get('exceededTransferLimit') or not isinstance(data.get('features'), list):
        raise ValueError('NOAA raster catalog is incomplete.')
    selected = {}
    for hours in (1, 24, 48, 72):
        # NOAA's one-hour product is 01H, not 1H.
        subset = f'conus_QPE_{hours:02d}H'
        matches = [f['attributes'] for f in data['features']
                   if f.get('attributes', {}).get('idp_subset') == subset]
        if not matches:
            raise ValueError('NOAA raster missing: ' + subset)
        record = max(matches, key=lambda x: x.get('idp_validendtime') or 0)
        observed = dt.datetime.fromtimestamp(record['idp_validendtime'] / 1000, UTC)
        if now - observed > MAX_AGE or observed - now > dt.timedelta(minutes=15):
            raise ValueError('NOAA raster is stale or future dated: ' + subset)
        selected[hours] = {'id': int(record['objectid']), 'subset': subset,
                           'observedUtc': observed.isoformat()}
    required_times = [dt.datetime.fromisoformat(selected[h]['observedUtc']) for h in (24, 48, 72)]
    if max(required_times) - min(required_times) > dt.timedelta(hours=1):
        raise ValueError('NOAA rainfall windows have mismatched observation times.')
    return selected


def pixel_inches(value):
    try:
        mm = float(value)
        return round(mm / 25.4, 2) if math.isfinite(mm) and mm >= 0 else None
    except (ValueError, TypeError):
        return None


def sample_points(meta, product, fetch=request_json):
    values = []
    # Small GET requests avoid URL limits for the full 120-field multipoint geometry.
    for offset in range(0, len(meta), 25):
        batch = meta[offset:offset + 25]
        params = {'geometryType': 'esriGeometryMultipoint',
                  'geometry': json.dumps({'points': [[m['point']['lon'], m['point']['lat']] for m in batch],
                                          'spatialReference': {'wkid': 4326}}, separators=(',', ':')),
                  'mosaicRule': json.dumps({'mosaicMethod': 'esriMosaicLockRaster',
                                           'lockRasterIds': [product['id']]}, separators=(',', ':')),
                  'returnFirstValueOnly': 'true', 'interpolation': 'RSP_NearestNeighbor', 'f': 'json'}
        last = None
        for attempt in range(3):
            try:
                data = fetch('getSamples', params)
                if data.get('error') or not isinstance(data.get('samples'), list):
                    raise ValueError('NOAA returned an invalid samples response.')
                by_location = {}
                for sample in data['samples']:
                    index = int(sample.get('locationId', -1))
                    if index in by_location or index < 0 or index >= len(batch):
                        raise ValueError('NOAA returned duplicate or invalid sample locations.')
                    if int(sample.get('rasterId', -1)) != product['id']:
                        raise ValueError('NOAA sampled an unexpected rainfall raster.')
                    by_location[index] = pixel_inches(sample.get('value'))
                if len(by_location) != len(batch) or any(v is None for v in by_location.values()):
                    raise ValueError('NOAA rainfall samples are incomplete / NoData: ' + product['subset'])
                values.extend(by_location[i] for i in range(len(batch)))
                break
            except Exception as error:
                last = error
                if attempt == 2:
                    raise ValueError(str(last)) from last
                time.sleep(1)
    return values


def build_feed(meta, history, now, fetch=request_json):
    products = catalog(now, fetch)
    out = {'source': 'NOAA/NWS MRMS RadarOnly QPE', 'units': 'in', 'sourceUnits': 'mm',
           'conversion': 'mm/25.4', 'updatedUtc': now.isoformat(),
           'observedUtc': min(products[h]['observedUtc'] for h in (24, 48, 72)),
           'products': {str(h): p for h, p in products.items()}, 'fields': {}}
    for m in meta:
        out['fields'][m['fieldId']] = {k: v for k, v in m.items() if k != 'fieldId'}
    for hours in (1, 24, 48, 72):
        for m, inches in zip(meta, sample_points(meta, products[hours], fetch)):
            out['fields'][m['fieldId']][f'rain{hours}h'] = inches
    history = json.loads(json.dumps(history))
    observed = dt.datetime.fromisoformat(products[1]['observedUtc']).replace(minute=0, second=0, microsecond=0)
    cutoff = now - dt.timedelta(days=8)
    for m in meta:
        fid = m['fieldId']
        values = out['fields'][fid]
        prior = history.setdefault('fields', {}).setdefault(fid, [])
        slots = {dt.datetime.fromisoformat(x['time']): x.get('rain1h') for x in prior
                 if dt.datetime.fromisoformat(x['time']) >= cutoff}
        # The source observation hour is the key. Retrying cannot count an hour twice.
        slots[observed] = values['rain1h']
        entries = [{'time': at.isoformat(), 'rain1h': value} for at, value in sorted(slots.items())]
        history['fields'][fid] = entries
        expected = [slots.get(observed - dt.timedelta(hours=i)) for i in range(168)]
        values['rain7d'] = round(sum(expected), 2) if all(isinstance(v, (int, float)) and math.isfinite(v) and v >= 0 for v in expected) else None
        for threshold, key in ((.1, 'daysSince010'), (.5, 'daysSince050')):
            hits = [at for at, value in slots.items() if isinstance(value, (int, float)) and math.isfinite(value) and value >= threshold and at <= observed]
            values[key] = round((now - max(hits)).total_seconds() / 86400, 1) if hits else None
    history['updatedUtc'] = now.isoformat()
    out['validation'] = {'fieldCount': len(meta), **{f'with{h}h': len(meta) for h in (1, 24, 48, 72)}, 'complete': True}
    return out, history


def main(root=Path('.')):
    meta = field_metadata((root / 'index.html').read_text(encoding='utf-8'))
    history_path = root / 'rainfall-history.json'
    history = json.loads(history_path.read_text()) if history_path.exists() else {'fields': {}}
    feed, history = build_feed(meta, history, dt.datetime.now(UTC))
    # Never overwrite the last feed with empty samples or a provider error disguised as HTTP 200.
    for name, value in [('rainfall-history.json', history), ('rainfall.json', feed)]:
        target = root / name
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(value, indent=2 if name == 'rainfall.json' else None), encoding='utf-8')
        temp.replace(target)
    print(json.dumps({'updatedUtc': feed['updatedUtc'], 'observedUtc': feed['observedUtc'], 'validation': feed['validation']}))


if __name__ == '__main__':
    main()
