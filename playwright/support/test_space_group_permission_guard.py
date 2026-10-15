"""Offline checks: no fixture, credentials, database, browser or network required."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('permission_guard', pathlib.Path(__file__).with_name('space-group-permission-guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ProtectedRowsTests(unittest.TestCase):
    def setUp(self):
        self.rows = {
            'af_system_config': [
                {'key': 'search_admission_health', 'updated_at': '2026-10-12T00:00:00Z', 'description': 'managed',
                 'value': json.dumps({'version': 1, 'configuration_hash': 'original', 'state': 'healthy', 'lease': None,
                                     'last_checked_at': '2026-10-12T00:00:00Z', 'last_healthy_at': '2026-10-12T00:00:00Z',
                                     'next_check_at': '2026-10-12T00:00:10Z'})},
                {'key': 'search_indexing_enabled', 'value': 'true', 'updated_at': 'original'},
            ],
            'af_workspace_member': [{'uid': '1234567890123456789', 'role': 2, 'updated_at': 'original'}],
        }

    def test_only_observed_health_timestamps_can_change(self):
        after = copy.deepcopy(self.rows)
        row = after['af_system_config'][0]
        value = json.loads(row['value'])
        for field in guard.HEALTH_OBSERVATIONS:
            value[field] = '2026-10-12T00:00:20Z'
        row['value'], row['updated_at'] = json.dumps(value), '2026-10-12T00:00:10Z'
        self.assertEqual(guard.protected_rows_digest(self.rows), guard.protected_rows_digest(after))
        self.assertEqual(self.rows['af_system_config'][0]['updated_at'], '2026-10-12T00:00:00Z')

    def test_policy_state_lease_and_other_metadata_remain_strict(self):
        for field in ('configuration_hash', 'state', 'version', 'lease'):
            with self.subTest(field=field):
                after = copy.deepcopy(self.rows)
                value = json.loads(after['af_system_config'][0]['value'])
                value[field] = 'changed'
                after['af_system_config'][0]['value'] = json.dumps(value)
                self.assertNotEqual(guard.protected_rows_digest(self.rows), guard.protected_rows_digest(after))
        for table, index, field in [('af_system_config', 0, 'description'), ('af_system_config', 1, 'value'),
                                    ('af_system_config', 1, 'updated_at'), ('af_workspace_member', 0, 'updated_at'),
                                    ('af_workspace_member', 0, 'role')]:
            with self.subTest(table=table, field=field):
                after = copy.deepcopy(self.rows)
                after[table][index][field] = 'changed'
                self.assertNotEqual(guard.protected_rows_digest(self.rows), guard.protected_rows_digest(after))

    def test_missing_or_invalid_observation_is_not_normalized(self):
        for field in guard.HEALTH_OBSERVATIONS:
            with self.subTest(field=field):
                after = copy.deepcopy(self.rows)
                value = json.loads(after['af_system_config'][0]['value'])
                value[field] = 'invalid timestamp'
                after['af_system_config'][0]['value'] = json.dumps(value)
                with self.assertRaises(ValueError):
                    guard.protected_rows_digest(after)

    def test_rows_cannot_disappear_or_be_added(self):
        for add in (True, False):
            after = copy.deepcopy(self.rows)
            if add:
                after['af_workspace_member'].append({'uid': 'other', 'role': 2})
            else:
                after['af_workspace_member'].clear()
            self.assertNotEqual(guard.protected_rows_digest(self.rows), guard.protected_rows_digest(after))


class RequalificationTests(unittest.TestCase):
    def setUp(self):
        self.original = {'run_id': 'run', 'workspace': 'workspace', 'builder_uuid': 'builder', 'subject_uuid': 'subject',
                         'owned': {'pages': {'primary': 'page'}}, 'server_journal_sha256': 'journal', 'server_result_sha256': 'result'}
        self.processes = {'cloud': {'pid': 10, 'start_ticks': '20', 'binary_sha256': 'cloud'},
                          'worker': {'pid': 11, 'start_ticks': '21', 'binary_sha256': 'worker'}}
        self.proofs = {'cloud': 'cloud-proof', 'worker': 'worker-proof'}
        self.record = {
            'version': 1, 'kind': 'identity_state_requalification', 'status': 'passed',
            'identity': guard.identity(self.original), 'qualified_processes': self.processes,
            'original_evidence': {'journal_sha256': 'journal', 'result_sha256': 'result'},
            'current_proof_hashes': self.proofs, 'current_source_sha256': 'source',
            'checks': {'restored_grant_graph': True, 'owned_document_bytes': True, 'original_content': True, 'protected_rows': True},
            'reran_server_lifecycle': False,
        }

    def verify(self, record):
        guard.verify_requalification_record(record, self.original, self.processes, self.proofs, 'source')

    def test_accepts_exact_state_requalification(self):
        self.verify(self.record)

    def test_rejects_other_fixture_and_changed_original_evidence(self):
        for field in ('run_id', 'workspace', 'builder_uuid', 'subject_uuid', 'owned'):
            record = copy.deepcopy(self.record)
            record['identity'][field] = 'changed'
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(record)
        for field in ('journal_sha256', 'result_sha256'):
            record = copy.deepcopy(self.record)
            record['original_evidence'][field] = 'changed'
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(record)

    def test_rejects_changed_process_proof_or_source(self):
        for field in ('pid', 'start_ticks', 'binary_sha256'):
            record = copy.deepcopy(self.record)
            record['qualified_processes']['cloud'][field] = 'changed'
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(record)
        record = copy.deepcopy(self.record)
        record['current_proof_hashes']['worker'] = 'changed'
        with self.assertRaises(ValueError):
            self.verify(record)
        record = copy.deepcopy(self.record)
        record['current_source_sha256'] = 'changed'
        with self.assertRaises(ValueError):
            self.verify(record)

    def test_rejects_incomplete_or_misrepresented_checks(self):
        for field in self.record['checks']:
            record = copy.deepcopy(self.record)
            record['checks'][field] = False
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(record)
        for field, value in [('status', 'failed'), ('kind', 'server-lifecycle'), ('reran_server_lifecycle', True), ('version', 2)]:
            record = copy.deepcopy(self.record)
            record[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.verify(record)

    def test_source_delta_requires_exact_reviewed_paths(self):
        before, after = {'allowed.rs': 'old', 'same.rs': 'same'}, {'allowed.rs': 'new', 'same.rs': 'same'}
        self.assertEqual(set(guard.exact_source_delta(before, after, ['allowed.rs'])), {'allowed.rs'})
        for expected in ([], ['allowed.rs', 'unrelated.rs'], ['allowed.rs', 'allowed.rs']):
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                guard.exact_source_delta(before, after, expected)
        with self.assertRaises(ValueError):
            guard.exact_source_delta(before, {**after, 'unreviewed.rs': 'extra'}, ['allowed.rs'])


class ObservationEvidenceTests(unittest.TestCase):
    def test_observations_are_private_distinct_and_never_labelled_qualified(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            original = {'protected_rows': {'table': [{'policy': 'strict'}]}}
            first = guard.retain_observation(root, original)
            second = guard.retain_observation(root, {'protected_rows': {'table': [{'policy': 'changed'}]}})
            self.assertNotEqual(first['path'], second['path'])
            for record in (first, second):
                self.assertEqual(pathlib.Path(record['path']).stat().st_mode & 0o777, 0o600)
                self.assertEqual(guard.file_hash(record['path']), record['sha256'])
                self.assertEqual(guard.private_json(record['path'], root)['kind'], 'unqualified_read_only_observation')
            self.assertEqual(guard.private_json(first['path'], root)['snapshot'], original)


if __name__ == '__main__':
    unittest.main()
