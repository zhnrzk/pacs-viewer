#!/usr/bin/env python3

import argparse
import base64
import http.client
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

_local = threading.local()
_print_lock = threading.Lock()


def _connection(host, port, timeout):
    connection = getattr(_local, 'connection', None)
    if connection is None:
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        _local.connection = connection
    return connection


def _reset_connection():
    connection = getattr(_local, 'connection', None)
    if connection is not None:
        try:
            connection.close()
        except Exception:
            pass
        _local.connection = None


def upload_file(path, host, port, endpoint, auth_header, timeout):
    with open(path, 'rb') as stream:
        body = stream.read()

    headers = {'Content-Type': 'application/dicom'}
    if auth_header:
        headers['Authorization'] = auth_header

    last_error = None
    for _ in range(2):
        connection = _connection(host, port, timeout)
        try:
            connection.request('POST', endpoint, body=body, headers=headers)
            response = connection.getresponse()
            response.read()
        except Exception as exc:
            last_error = exc
            _reset_connection()
            continue

        if response.status in (200, 201):
            return 'imported', None
        if response.status == 409:
            return 'skipped', None
        return 'failed', 'HTTP {0} {1}'.format(response.status, response.reason)

    return 'failed', str(last_error)


def collect_files(path):
    if os.path.isfile(path):
        return [path]

    files = []
    for root, _, filenames in os.walk(path):
        for filename in filenames:
            files.append(os.path.join(root, filename))
    return files


def main():
    parser = argparse.ArgumentParser(
        description='Recursively import DICOM files into Orthanc through the REST API.'
    )
    parser.add_argument('host', help='Orthanc hostname or IP address')
    parser.add_argument('port', type=int, help='Orthanc HTTP port')
    parser.add_argument('path', help='File or directory to import')
    parser.add_argument('username', nargs='?', help='HTTP Basic username')
    parser.add_argument('password', nargs='?', help='HTTP Basic password')
    parser.add_argument('--base-path', default='', help='Base path such as /orthanc when using nginx')
    parser.add_argument('--jobs', type=int, default=4, help='Number of parallel uploads (default: 4)')
    parser.add_argument('--timeout', type=float, default=60.0, help='Socket timeout in seconds (default: 60)')
    args = parser.parse_args()

    if (args.username is None) != (args.password is None):
        parser.error('username and password must be provided together')
    if args.jobs < 1:
        parser.error('--jobs must be at least 1')

    files = collect_files(args.path)
    if not files:
        print('No files found in {0}'.format(args.path))
        return 1

    auth_header = None
    if args.username is not None:
        token = base64.b64encode(
            '{0}:{1}'.format(args.username, args.password).encode('utf-8')
        ).decode('ascii')
        auth_header = 'Basic ' + token

    endpoint = args.base_path.rstrip('/') + '/instances'
    counts = {'imported': 0, 'skipped': 0, 'failed': 0}
    failures = []

    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        futures = {
            executor.submit(
                upload_file,
                path,
                args.host,
                args.port,
                endpoint,
                auth_header,
                args.timeout,
            ): path
            for path in files
        }

        for future in as_completed(futures):
            path = futures[future]
            try:
                status, error = future.result()
            except Exception as exc:
                status, error = 'failed', str(exc)

            counts[status] += 1
            if status == 'failed':
                failures.append((path, error))

            with _print_lock:
                if status == 'failed':
                    print('{0} => failure ({1})'.format(path, error))
                else:
                    print('{0} => {1}'.format(path, status))

    print(
        '\nSummary: {imported} imported, {skipped} already stored, {failed} failed '
        '({total} total)'.format(total=len(files), **counts)
    )

    if failures:
        print('\nFailed files:')
        for path, error in failures:
            print('  {0}: {1}'.format(path, error))
        return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
