"""Read-only browser fixture binding and explicit post-build state requalification.

JSON requests on stdin use action preflight/snapshot/requalify. No action signs in,
issues HTTP, invokes Lifecycle.__init__, or writes the original server evidence.
"""
import copy
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

HEALTH_KEY = 'search_admission_health'
HEALTH_OBSERVATIONS = ('last_checked_at', 'last_healthy_at', 'next_check_at')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def private_json(path, root):
    path = pathlib.Path(path).resolve()
    require(path.parent == root and path.suffix == '.json', 'Evidence must be in the private runtime directory')
    require(path.stat().st_mode & 0o077 == 0, 'Evidence must be private')
    return json.loads(path.read_text())


def retain_observation(root, snapshot):
    """Keep raw read-only evidence even if the subsequent preservation check rejects it."""
    path = root / ('web-permission-observation-' + str(uuid.uuid4()) + '.json')
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
        json.dump({'kind': 'unqualified_read_only_observation', 'snapshot': snapshot}, output, indent=2, default=str)
        output.flush()
        os.fsync(output.fileno())
    return {'path': str(path), 'sha256': file_hash(path)}


def protected_rows_digest(tables):
    """Normalize only observation fields proved by the read-only monitor experiment."""
    from datetime import datetime
    result = {}
    for table, rows in tables.items():
        normalized = []
        for source in rows:
            row = copy.deepcopy(source)
            if table == 'af_system_config' and row.get('key') == HEALTH_KEY:
                datetime.fromisoformat(row['updated_at'].replace('Z', '+00:00'))
                row['updated_at'] = '<observed timestamp>'
                value = json.loads(row['value'])
                for field in HEALTH_OBSERVATIONS:
                    datetime.fromisoformat(value[field].replace('Z', '+00:00'))
                    value[field] = '<observed timestamp>'
                row['value'] = value
            normalized.append(digest(row))
        result[table] = sorted(normalized)
    return digest(result)


def exact_source_delta(before, after, expected):
    require(len(expected) == len(set(expected)), 'Duplicate expected source path')
    delta = {path: {'before_sha256': before.get(path), 'after_sha256': after.get(path)}
             for path in sorted(set(before) | set(after)) if before.get(path) != after.get(path)}
    require(set(delta) == set(expected), 'Source delta differs from reviewed exact path list')
    return delta


def process_record(proof, service):
    record = proof['services'][service]
    require(record.get('health') == 'passed' and record.get('environment_preserved') is True,
            'Incomplete native qualification')
    return {'pid': record['pid'], 'start_ticks': str(record['start_ticks']),
            'binary_sha256': record['binary_sha256']}


def identity(snapshot):
    return {key: snapshot[key] for key in ('run_id', 'workspace', 'builder_uuid', 'subject_uuid', 'owned')}


def verify_requalification_record(record, original, processes, proof_hashes, source_hash):
    """Reject a requalification for any other fixture, original evidence or native build."""
    require(record.get('version') == 1 and record.get('kind') == 'identity_state_requalification'
            and record.get('status') == 'passed', 'Not a passed state requalification')
    require(record['identity'] == identity(original), 'Requalification fixture identity differs')
    require(record['original_evidence'] == {
        'journal_sha256': original['server_journal_sha256'],
        'result_sha256': original['server_result_sha256'],
    }, 'Original passing evidence changed')
    require(record['qualified_processes'] == processes, 'Requalified process changed')
    require(record['current_proof_hashes'] == proof_hashes, 'Current native proof bytes changed')
    require(record['current_source_sha256'] == source_hash, 'Current source differs')
    require(record.get('checks') == {
        'restored_grant_graph': True, 'owned_document_bytes': True,
        'original_content': True, 'protected_rows': True,
    }, 'Requalification checks are incomplete')
    require(record.get('reran_server_lifecycle') is False, 'Requalification cannot claim the lifecycle was rerun')


def capture(request):
    """Current source/process validation precedes reading any actor credentials."""
    root = pathlib.Path(request['runtime_dir']).resolve()
    repo = pathlib.Path(request['server_repo']).resolve()
    require(root.stat().st_mode & 0o077 == 0, 'Private runtime directory required')
    sys.path.insert(0, str(repo / 'script'))
    import psycopg
    from group_permission_lifecycle import Lifecycle, qualified_service, verify_journal, PROTECTED_TABLES, owned_ids
    from oodrive_matrix_safety import runtime_binding

    journal_path = root / 'group-permission-lifecycle-private.json'
    result_path = root / 'group-permission-lifecycle-result.json'
    state, result = private_json(journal_path, root), private_json(result_path, root)
    runtime = private_json(root / 'runtime.json', root)
    require(state['status'] == result['status'] == 'passed', 'Server lifecycle must pass first')
    require(state['run_id'] == result['run_id'] and state['owned'] == result['owned'], 'Fixture identity differs')
    require(state['restoration']['status'] == result['restoration']['status'] == 'passed', 'Server restoration incomplete')
    require(state['protected_invariants_verified'] and result['protected_invariants_verified'], 'Server preservation unverified')
    proofs = {name: private_json(request[name + '_proof'], root) for name in ('cloud', 'worker')}
    processes = {name: qualified_service(proofs[name], name, runtime, repo) for name in proofs}
    require(proofs['cloud']['source'] == proofs['worker']['source'], 'Current native source qualifications disagree')
    proof_hashes = {name: file_hash(request[name + '_proof']) for name in proofs}
    original = {**identity(state), 'server_journal_sha256': file_hash(journal_path),
                'server_result_sha256': file_hash(result_path)}
    requalification = None
    if request['action'] != 'requalify':
        if request.get('requalification'):
            require(file_hash(request['requalification']) == request.get('requalification_sha256'), 'Reviewed requalification bytes changed')
            requalification = private_json(request['requalification'], root)
            verify_requalification_record(requalification, original, processes, proof_hashes, proofs['cloud']['source']['sha256'])
        else:
            require(processes == state['qualified_processes'], 'Live services differ from the passed server run')

    # __init__ authenticates and saves the journal; construct only its SELECT-based verifier.
    actors = private_json(root / 'actors.json', root)
    builder, subject = actors['member'], actors['owner']
    binding = runtime_binding(runtime, runtime['APPFLOWY_BASE_URL'].rstrip('/'),
                              runtime['APPFLOWY_GOTRUE_BASE_URL'].rstrip('/'), builder, state)
    verify_journal(state, binding, state['workspace'], builder['uuid'], subject['uuid'])
    verifier = Lifecycle.__new__(Lifecycle)
    verifier.psycopg, verifier.runtime, verifier.state = psycopg, runtime, state
    verifier.workspace, verifier.builder, verifier.subject = state['workspace'], builder, subject
    verifier.verify_actor_roles()
    require(not state.get('pending_group_create'), 'Pending fixture creation is not browser-ready')
    verifier.verify_owned()
    verifier.verify_restored_state()

    import urllib.parse
    web_url = urllib.parse.urlparse(runtime['APPFLOWY_WEB_URL'])
    require(web_url.hostname in ('localhost', '127.0.0.1', '::1') and web_url.port, 'Local Web origin required')
    listening = subprocess.check_output(['ss', '-ltnp', 'sport = :' + str(web_url.port)], text=True)
    web_pids = set(re.findall(r'pid=(\d+)', listening))
    require(len(web_pids) == 1, 'Exactly one Web listener required')
    web_pid = int(web_pids.pop())
    web_process = pathlib.Path('/proc') / str(web_pid)
    require((web_process / 'cwd').resolve() == pathlib.Path.cwd(), 'Web listener checkout differs')
    web_start = (web_process / 'stat').read_text().rsplit(') ', 1)[1].split()[19]
    identities, protected_rows = owned_ids(state), {}
    for table in PROTECTED_TABLES:
        rows = [row[0] for row in verifier.query('SELECT to_jsonb(t) FROM ' + table + ' t')]
        protected_rows[table] = sorted([row for row in rows if not any(
            value in identities for key, value in row.items()
            if key in ('group_id', 'space_view_id', 'view_id') and isinstance(value, str))], key=digest)
    protected = verifier.protected()
    snapshot = {
        **original, 'subject_uid': str(verifier.uid),
        'processes': {**processes, 'web': {'pid': web_pid, 'start_ticks': web_start}},
        'protected_rows': protected_rows, 'protected_rows_sha256': protected_rows_digest(protected_rows),
        'protected': protected, 'owned_document_content': verifier.document_content(),
        'owned_rows': verifier.owned_snapshot(), 'titles': {name: verifier.group_name(name) for name in state['owned']['pages']},
        'guard_source_sha256': file_hash(__file__),
    }
    # This is diagnostic evidence, not qualification. A transient health lease
    # or any unexpected policy/member change remains visible after rejection.
    snapshot['raw_observation'] = retain_observation(root, snapshot)
    if requalification:
        snapshot['requalification_sha256'] = file_hash(request['requalification'])
        baseline = requalification['snapshot']
        require(snapshot['protected_rows_sha256'] == baseline['protected_rows_sha256'], 'Requalified protected rows drifted')
        require(digest(snapshot['owned_document_content']) == digest(baseline['owned_document_content']), 'Requalified owned bytes drifted')
        require((protected['content_count'], protected['content_sha256']) ==
                (baseline['protected']['content_count'], baseline['protected']['content_sha256']), 'Requalified original content drifted')
    return root, state, proofs, proof_hashes, processes, snapshot


def generate_requalification(request, root, state, proofs, proof_hashes, processes, snapshot):
    baseline = private_json(request['baseline_snapshot'], root)
    require(identity(baseline) == identity(snapshot), 'Baseline belongs to another fixture')
    require({key: baseline[key] for key in ('server_journal_sha256', 'server_result_sha256')} ==
            {key: snapshot[key] for key in ('server_journal_sha256', 'server_result_sha256')}, 'Baseline original evidence differs')
    require({name: baseline['processes'][name] for name in processes} == state['qualified_processes'], 'Baseline native provenance differs')
    original_proofs = {name: private_json(request['original_' + name + '_proof'], root) for name in processes}
    require({name: process_record(original_proofs[name], name) for name in processes} == state['qualified_processes'],
            'Original native proof provenance differs')
    require(original_proofs['cloud']['source'] == original_proofs['worker']['source'], 'Original source qualifications disagree')
    expected = private_json(request['expected_source_delta'], root)
    require(isinstance(expected, list) and all(isinstance(path, str) for path in expected), 'Reviewed exact source path list required')
    delta = exact_source_delta(original_proofs['cloud']['source']['files'], proofs['cloud']['source']['files'], expected)
    original_protected = state['protected_after']
    for table, evidence in original_protected['tables'].items():
        if table == 'af_system_config':
            continue  # Its raw before/after observation drift was independently qualified.
        require(baseline['protected']['tables'][table] == evidence, 'Baseline original table evidence differs')
        rows = baseline['protected_rows'][table]
        require({'count': len(rows), 'sha256': digest(sorted(rows, key=digest))} == evidence,
                'Baseline raw rows disagree with original table evidence')
    require(protected_rows_digest(baseline['protected_rows']) == snapshot['protected_rows_sha256'], 'Protected policy/member rows changed')
    require(digest(snapshot['owned_document_content']) == digest(state['owned_document_content']) == digest(baseline['owned_document_content']),
            'Owned document bytes changed')
    for key in ('content_count', 'content_sha256'):
        require(snapshot['protected'][key] == baseline['protected'][key] == original_protected[key], 'Original content changed')
    record = {
        'version': 1, 'kind': 'identity_state_requalification', 'status': 'passed',
        'identity': identity(snapshot),
        'original_evidence': {'journal_sha256': snapshot['server_journal_sha256'], 'result_sha256': snapshot['server_result_sha256']},
        'original_proof_hashes': {name: file_hash(request['original_' + name + '_proof']) for name in processes},
        'current_proof_hashes': proof_hashes, 'qualified_processes': processes,
        'current_source_sha256': proofs['cloud']['source']['sha256'], 'source_delta': delta,
        'expected_source_delta_sha256': file_hash(request['expected_source_delta']),
        'baseline_snapshot': {'path': request['baseline_snapshot'], 'sha256': file_hash(request['baseline_snapshot'])},
        'checks': {'restored_grant_graph': True, 'owned_document_bytes': True, 'original_content': True, 'protected_rows': True},
        'reran_server_lifecycle': False,
        'limitations': ['Identity and state preservation only; the original 65 server checks were not rerun',
                        'Original server config table has only a digest; raw policy baseline is the reviewed original-process monitor capture'],
        'health_observation': {'key': HEALTH_KEY, 'permitted_value_fields': list(HEALTH_OBSERVATIONS), 'permitted_row_metadata': ['updated_at'],
                               'before_sha256': digest(next(row for row in baseline['protected_rows']['af_system_config'] if row['key'] == HEALTH_KEY)),
                               'after_sha256': digest(next(row for row in snapshot['protected_rows']['af_system_config'] if row['key'] == HEALTH_KEY))},
        'snapshot': snapshot,
    }
    verify_requalification_record(record, snapshot, processes, proof_hashes, proofs['cloud']['source']['sha256'])
    path = pathlib.Path(request['output']).resolve()
    require(path.parent == root and path.suffix == '.json', 'Requalification output must be private runtime JSON')
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
        json.dump(record, output, indent=2, default=str)
        output.flush()
        os.fsync(output.fileno())
    return {'status': 'passed', 'kind': record['kind'], 'path': str(path), 'sha256': file_hash(path),
            'source_delta_paths': sorted(delta), 'reran_server_lifecycle': False}


def main():
    request = json.load(sys.stdin)
    require(request['action'] in ('preflight', 'snapshot', 'requalify'), 'Unsupported read-only operation')
    root, state, proofs, proof_hashes, processes, snapshot = capture(request)
    output = generate_requalification(request, root, state, proofs, proof_hashes, processes, snapshot) \
        if request['action'] == 'requalify' else snapshot
    print(json.dumps(output, default=str))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Configuration values, connection strings and credentials stay out of reports.
        print(json.dumps({'error_class': type(error).__name__}))
        sys.exit(1)
