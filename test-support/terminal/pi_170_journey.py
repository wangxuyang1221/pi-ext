"""Pi 1.7 host behavior at the installed UI boundary."""
import base64
import hashlib
import json
import os
import re


def resume_reports(raw, token):
    reports = []
    for packet in re.findall(rb'\x1b\]7577;([^\x1b\x07]+)(?:\x1b\\|\x07)', raw):
        body, signature = packet.rsplit(b':mac=', 1)
        assert signature.decode() == hashlib.sha256(body + b':' + token.encode()).hexdigest()
        fields = dict(field.split('=', 1) for field in body.decode().split(':'))
        if 'argv' in fields:
            fields['argv'] = [base64.b64decode(arg, validate=True).decode() for arg in fields['argv'].split(',')]
        reports.append(fields)
    return reports


def verify_pi_170(journey, header):
    check, wait = journey.check, journey.wait
    root = journey.root
    agent = root / 'agent'
    decoy = root / 'unused-agent'
    check(b'\x1b]7577;' not in journey.raw, 'Previous tokenless session emitted no resume packet through quit')
    decoy.mkdir()
    sentinel = decoy / 'settings.json'
    contents = '{"defaultProjectTrust":"never","theme":"unused-profile","shellCommandPrefix":"export UNUSED_PROFILE=wrong-directory"}'
    sentinel.write_text(contents)
    # An atime older than mtime makes a real read observable on relatime mounts, too.
    control = root / 'atime-control'
    control.write_text(contents)
    old_atime = 946684800_000_000_000
    for path in (sentinel, decoy, control):
        os.utime(path, ns=(old_atime, path.stat().st_mtime_ns))
    control.read_bytes()
    tracks_reads = control.stat().st_atime_ns != old_atime
    original_stat = sentinel.stat()
    journey.env['PI_CODING_AGENT_DIR'] = str(decoy)
    token = 'offline-pty-program-resume'
    journey.env['OSC7577_TOKEN'] = token
    (agent / 'models.json').write_text('{invalid')
    journey.start(['--agent-dir', str(agent)])
    wait(lambda: re.search(r'Warning:.*Failed to parse models.json', journey.view()), 'invalid model configuration warning')
    check(header in journey.view(), 'Explicit profile loads its installed UI')

    def requests():
        return [event['data'] for event in journey.records() if event['type'] == 'request']

    # Empty history lets the real copy handler run without changing the system clipboard.
    baseline = len(requests())
    journey.keys(b'/cop', 'type a partial copy command')
    wait(lambda: re.search(r'^\s*→\s+/?copy\b', journey.view(), re.M), 'copy suggestion selected')
    alt_enter = b'\x1b[13;3u'
    journey.keys(alt_enter, 'Alt+Enter completes the idle copy command')
    wait(lambda: 'No agent messages to copy yet.' in journey.view(), 'idle copy handler responded')
    (root / 'workspace/unique-path-170.txt').touch()
    journey.keys(b'@unique-path-', 'start a file completion')
    wait(lambda: 'unique-path-170.txt' in journey.view(), 'file autocomplete visible')
    journey.keys(alt_enter, 'Alt+Enter applies the path')
    journey.settle()
    check(any(re.match(r'^\s*[›❯]\s*@?unique-path-170\.txt\s*$', row) for row in journey.screen.display)
          and len(requests()) == baseline, 'Path remains in the editor without a model request')
    journey.snap('completed path draft')
    journey.keys(b'\x05\x15', 'clear completed draft')

    def usage():
        before = len(journey.records())
        journey.command('/audit-context')
        def observations():
            return [e['data'] for e in journey.records()[before:] if e['type'] == 'audit_context']
        wait(observations, 'host context observation')
        return observations()[-1]

    base = usage()
    payload = 'usage-' * 2200
    (root / 'workspace/context-sample.txt').write_text(payload + '\nCONTEXT-END\n')
    for prefix, excluded in [('!!', True), ('!', False)]:
        before = len(journey.raw)
        journey.command(prefix + 'cat context-sample.txt')
        wait(lambda: b'CONTEXT-END' in journey.raw[before:], 'real user Bash output ' + prefix)
        journey.settle()
        observed = usage()
        last = observed['bash'][-1]
        check(last['length'] >= len(payload) and last['excluded'] == excluded and last['command'] == 'cat context-sample.txt',
              'Session records the expected Bash output and exclusion flag for ' + prefix)
        tokens = observed['usage']['tokens']
        check(tokens == base['usage']['tokens'] if excluded else tokens > base['usage']['tokens'],
              'Host token estimate stays fixed for !! and increases for ! (' + prefix + ')')

    proof = root / 'workspace/child-environment'
    result = journey.request('Execute child environment probe', {
        'calls': [{'name': 'bash', 'arguments': {'command': 'printf "%s/%s" "${OSC7577_TOKEN-unset}" "${UNUSED_PROFILE-unset}" > child-environment'}}],
        'reply': 'MODEL-WITH-INVALID-CONFIG-OK',
    })[-1]
    check(not result['isError'] and proof.read_text() == 'unset/unset' and 'MODEL-WITH-INVALID-CONFIG-OK' in journey.view(),
          'Fixture model completes with malformed models.json and child Bash sees neither the token nor decoy shell settings')

    # Queue only once there is a live model request and a visible streamed response.
    before = len(requests())
    (root / 'plan.json').write_text(json.dumps({'reply': 'STREAM-170 ' + 'Follow-up acceptance. ' * 160}))
    journey.command('Stream before queue')
    wait(lambda: len(requests()) == before + 1 and 'STREAM-170' in journey.view(), 'live stream before follow-up')
    journey.keys(b'QUEUED-170' + alt_enter, 'queue a follow-up while streaming')
    wait(lambda: re.search(r'Follow.up:\s*QUEUED-170', journey.view(), re.I), 'visible pending follow-up')
    check(len(requests()) == before + 1, 'Pending follow-up waits for the active response')
    (root / 'plan.json').write_text(json.dumps({'reply': 'FOLLOW-UP-DELIVERED'}))
    wait(lambda: len(requests()) == before + 2 and 'FOLLOW-UP-DELIVERED' in journey.view(), 'queued turn received')
    last = requests()[-1][-1]
    check(last['role'] == 'user' and 'QUEUED-170' in json.dumps(last['content']), 'Provider receives the complete queued user turn')

    reports = resume_reports(journey.raw, token)
    expected = ['pi', '--agent-dir', str(agent), '--session-dir', str(root / 'sessions'), '--session', base['sessionId']]
    for i, arg in enumerate(journey.cli):
        if arg in ('--no-skills', '--no-context-files', '--no-prompt-templates'):
            expected.append(arg)
        elif arg in ('--tools', '-e'):
            expected.extend(journey.cli[i:i + 2])
    check(any(report.get('argv') == expected for report in reports), 'Authenticated resume argv reproduces session, profile, restrictions and extension')
    offset = len(journey.raw)
    journey.stop()
    ending = resume_reports(journey.raw[offset:], token)
    check(bool(ending) and ending[-1].get('clear') == '1', 'Native quit clears the registered session')
    final_stat = sentinel.stat()
    journey.actions.append({'decoyReadTimestampsAvailable': tracks_reads})
    if tracks_reads:
        check(final_stat.st_atime_ns == original_stat.st_atime_ns and decoy.stat().st_atime_ns == old_atime,
              'Host neither reads decoy settings nor enumerates the decoy directory')
    check((final_stat.st_ino, final_stat.st_mtime_ns) == (original_stat.st_ino, original_stat.st_mtime_ns),
          'Host leaves decoy settings in place without rewriting them')
    check(list(decoy.iterdir()) == [sentinel] and sentinel.read_text() == contents, 'Environment profile retains only its original sentinel')
