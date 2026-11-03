import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('rainfall', Path(__file__).parents[1] / 'scripts/update-rainfall.py')
rainfall = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rainfall)
NOW = dt.datetime(2026, 11, 3, 18, 30, tzinfo=dt.timezone.utc)
OBSERVED = NOW.replace(minute=0)
META = [{'fieldId': 'synthetic', 'fieldName': 'Synthetic test field', 'farmName': 'Test', 'point': {'lon': 0, 'lat': 0}}]


def fake(operation, params):
    if operation == 'query':
        return {'features': [{'attributes': {'objectid': h, 'idp_subset': f'conus_QPE_{h:02d}H', 'idp_validendtime': int(OBSERVED.timestamp() * 1000)}} for h in [1, 24, 48, 72]]}
    raster = json.loads(params['mosaicRule'])['lockRasterIds'][0]
    return {'samples': [{'locationId': i, 'value': '25.4', 'rasterId': raster} for i, _ in enumerate(json.loads(params['geometry'])['points'])]}


class RainfallTests(unittest.TestCase):
    def test_one_hour_catalog_is_zero_padded_and_source_times_recorded(self):
        feed, _ = rainfall.build_feed(META, {}, NOW, fake)
        self.assertEqual(feed['products']['1']['subset'], 'conus_QPE_01H')
        self.assertEqual(feed['observedUtc'], OBSERVED.isoformat())
        self.assertEqual(feed['fields']['synthetic']['rain72h'], 1)
        self.assertTrue(feed['validation']['complete'])

    def test_raw_pixels_units_and_no_data(self):
        self.assertEqual(rainfall.pixel_inches('25.4'), 1)
        self.assertEqual(rainfall.pixel_inches('0'), 0)
        for value in ['NoData', '-999', 'NaN', 'Infinity', None]:
            self.assertIsNone(rainfall.pixel_inches(value))

    def test_provider_errors_and_missing_72_hour_catalog_cannot_publish(self):
        def missing(op, params):
            data = fake(op, params)
            data['features'] = data['features'][:-1]
            return data
        with self.assertRaisesRegex(ValueError, '72H'):
            rainfall.build_feed(META, {}, NOW, missing)
        with self.assertRaises(ValueError):
            rainfall.catalog(NOW + dt.timedelta(hours=5), fake)

    @patch.object(rainfall.time, 'sleep')
    def test_empty_samples_retry_and_fail_instead_of_fresh_blank_feed(self, sleep):
        attempts = []
        def empty(op, params):
            if op == 'query':
                return fake(op, params)
            attempts.append(1)
            return {'samples': []}
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            rainfall.build_feed(META, {}, NOW, empty)
        self.assertEqual(len(attempts), 3)

    @patch.object(rainfall.time, 'sleep')
    def test_transient_empty_response_recovers(self, sleep):
        calls = []
        def recover(op, params):
            if op == 'getSamples':
                calls.append(1)
                if len(calls) == 1:
                    return {'samples': []}
            return fake(op, params)
        self.assertEqual(rainfall.build_feed(META, {}, NOW, recover)[0]['validation']['with72h'], 1)
        self.assertEqual(len(calls), 5)

    @patch.object(rainfall.time, 'sleep')
    def test_wrong_raster_or_duplicate_samples_are_rejected(self, sleep):
        for wrong in [True, False]:
            def broken(op, params):
                data = fake(op, params)
                if op == 'getSamples':
                    if wrong:
                        data['samples'][0]['rasterId'] = 999
                    else:
                        data['samples'].append(data['samples'][0])
                return data
            with self.assertRaises(ValueError):
                rainfall.build_feed(META, {}, NOW, broken)

    def test_requests_are_bounded_and_lock_raw_product(self):
        meta = [{**META[0], 'fieldId': str(i)} for i in range(120)]
        calls = []
        def checked(op, params):
            if op == 'getSamples':
                calls.append(1)
                self.assertLessEqual(len(json.loads(params['geometry'])['points']), 25)
                self.assertNotIn('renderingRule', params)
                self.assertEqual(json.loads(params['mosaicRule'])['mosaicMethod'], 'esriMosaicLockRaster')
            return fake(op, params)
        self.assertEqual(rainfall.build_feed(meta, {}, NOW, checked)[0]['validation']['fieldCount'], 120)
        self.assertEqual(len(calls), 20)

    def test_history_is_keyed_to_observation_hour_and_requires_contiguous_7_days(self):
        prior = {'fields': {'synthetic': [{'time': (OBSERVED - dt.timedelta(hours=i)).isoformat(), 'rain1h': 0} for i in range(1, 169)]}}
        first, history = rainfall.build_feed(META, prior, NOW, fake)
        self.assertEqual(first['fields']['synthetic']['rain7d'], 1)
        again, history2 = rainfall.build_feed(META, history, NOW + dt.timedelta(minutes=5), fake)
        self.assertEqual(again['fields']['synthetic']['rain7d'], 1)
        self.assertEqual(len(history['fields']['synthetic']), len(history2['fields']['synthetic']))
        prior['fields']['synthetic'].pop(50)
        self.assertIsNone(rainfall.build_feed(META, prior, NOW, fake)[0]['fields']['synthetic']['rain7d'])

    def test_failed_refresh_preserves_last_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'rainfall.json').write_text('{"last":"good"}')
            (root / 'rainfall-history.json').write_text('{"fields":{}}')
            (root / 'index.html').write_text('window.SODVILLE_FIELDS = ' + json.dumps({'features': [{'properties': {'FIELD_ID': 'synthetic'}, 'geometry': {'coordinates': [[[0, 0], [1, 0], [0, 0]]]}}]}))
            with patch.object(rainfall, 'build_feed', side_effect=ValueError('provider missing')):
                with self.assertRaises(ValueError):
                    rainfall.main(root)
            self.assertEqual((root / 'rainfall.json').read_text(), '{"last":"good"}')
            self.assertEqual((root / 'rainfall-history.json').read_text(), '{"fields":{}}')


if __name__ == '__main__':
    unittest.main()
