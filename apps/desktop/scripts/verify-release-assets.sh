#!/usr/bin/env bash

set -euo pipefail

OUTPUT_DIR="${1:-release-assets}"

for metadata in latest.yml latest-mac.yml arm64-mac.yml; do
  if [ ! -f "$OUTPUT_DIR/$metadata" ]; then
    echo "FAIL: missing required metadata: $metadata"
    exit 1
  fi
done

python3 - "$OUTPUT_DIR" <<'PY'
import base64
import gzip
import hashlib
import json
import pathlib
import re
import sys

output_dir = pathlib.Path(sys.argv[1])
metadata_names = (
    'latest.yml',
    'latest-mac.yml',
    'arm64-mac.yml',
    'win-arm64.yml',
    'latest-linux.yml',
    'arm64-linux.yml',
)
metadata_files = [output_dir / name for name in metadata_names if (output_dir / name).is_file()]
errors: list[str] = []
primary_expectations = {
    'latest.yml': ('.exe', 'x64'),
    'latest-mac.yml': ('.zip', 'x64'),
    'arm64-mac.yml': ('.zip', 'arm64'),
    'win-arm64.yml': ('.exe', 'arm64'),
    'latest-linux.yml': ('.AppImage', None),
    'arm64-linux.yml': ('.AppImage', 'arm64'),
}


def parse_metadata(metadata_path: pathlib.Path) -> tuple[str | None, list[dict[str, str]], str | None, str | None]:
    version = None
    files: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    top_path = None
    top_sha512 = None

    for raw_line in metadata_path.read_text(encoding='utf-8').splitlines():
        version_match = re.match(r'^version:\s*[\'\"]?([^\'\"\s]+)', raw_line)
        if version_match:
            version = version_match.group(1)
            continue

        url_match = re.match(r'^\s*-\s+url:\s*(\S+)\s*$', raw_line)
        if url_match:
            current = {'url': url_match.group(1)}
            files.append(current)
            continue

        file_field_match = re.match(r'^\s{4}(sha512|size):\s*(\S+)\s*$', raw_line)
        if file_field_match and current is not None:
            current[file_field_match.group(1)] = file_field_match.group(2)
            continue

        path_match = re.match(r'^path:\s*(\S+)\s*$', raw_line)
        if path_match:
            top_path = path_match.group(1)
            continue

        sha_match = re.match(r'^sha512:\s*(\S+)\s*$', raw_line)
        if sha_match:
            top_sha512 = sha_match.group(1)

    return version, files, top_path, top_sha512


def sha512_base64(file_path: pathlib.Path) -> str:
    digest = hashlib.sha512()
    with file_path.open('rb') as input_file:
        for chunk in iter(lambda: input_file.read(1024 * 1024), b''):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode('ascii')


for metadata_path in metadata_files:
    version, files, top_path, top_sha512 = parse_metadata(metadata_path)
    if not version or not files:
        errors.append(f'{metadata_path.name}: missing version or files')
        continue

    for file_info in files:
        file_name = file_info.get('url', '')
        if pathlib.PurePosixPath(file_name).name != file_name:
            errors.append(f'{metadata_path.name}: asset must be a filename: {file_name}')
            continue
        version_pattern = rf'(^|[-_]){re.escape(version)}([-_.]|$)'
        if re.search(version_pattern, file_name) is None:
            errors.append(f'{metadata_path.name}: asset is not versioned: {file_name}')
            continue

        asset_path = output_dir / file_name
        if not asset_path.is_file():
            errors.append(f'{metadata_path.name}: missing asset: {file_name}')
            continue

        expected_size = file_info.get('size')
        if expected_size is None or int(expected_size) != asset_path.stat().st_size:
            errors.append(f'{metadata_path.name}: size mismatch: {file_name}')

        expected_sha512 = file_info.get('sha512')
        if expected_sha512 is None or expected_sha512 != sha512_base64(asset_path):
            errors.append(f'{metadata_path.name}: SHA-512 mismatch: {file_name}')

        is_windows_update = file_name.endswith('.exe')
        is_macos_update = file_name.endswith('.zip') and ('-mac-' in file_name or '-darwin-' in file_name)
        if is_windows_update or is_macos_update:
            blockmap_path = output_dir / f'{file_name}.blockmap'
            if not blockmap_path.is_file():
                errors.append(f'{metadata_path.name}: missing blockmap: {blockmap_path.name}')
            else:
                try:
                    with gzip.open(blockmap_path, 'rt', encoding='utf-8') as blockmap_file:
                        blockmap = json.load(blockmap_file)
                    if not isinstance(blockmap, dict) or 'version' not in blockmap:
                        raise ValueError('missing blockmap version')
                except Exception as error:
                    errors.append(f'{metadata_path.name}: invalid blockmap {blockmap_path.name}: {error}')

    if not top_path or not top_sha512:
        errors.append(f'{metadata_path.name}: missing top-level path or sha512')
    elif pathlib.PurePosixPath(top_path).name != top_path:
        errors.append(f'{metadata_path.name}: primary path must be a filename: {top_path}')
    else:
        expected_extension, expected_arch = primary_expectations[metadata_path.name]
        if not top_path.endswith(expected_extension) or (expected_arch and expected_arch not in top_path.lower()):
            errors.append(f'{metadata_path.name}: unexpected primary artifact: {top_path}')

        primary_path = output_dir / top_path
        if not primary_path.is_file():
            errors.append(f'{metadata_path.name}: missing primary path: {top_path}')
        elif top_sha512 != sha512_base64(primary_path):
            errors.append(f'{metadata_path.name}: primary SHA-512 mismatch: {top_path}')

if errors:
    for error in errors:
        print(f'FAIL: {error}')
    raise SystemExit(1)

for metadata_path in metadata_files:
    print(f'PASS: {metadata_path.name}')
print('ALL RELEASE ASSET CHECKS PASSED')
PY
