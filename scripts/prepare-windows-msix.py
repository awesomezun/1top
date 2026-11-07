"""Stage a full-trust MSIX payload. Store identity must come from Partner Center."""
import argparse
import json
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET

from onetop import __version__

TEST_IDENTITY = {'name': '1top.MsixValidation', 'publisher': 'CN=1top MSIX CI',
                 'publisher_display_name': '1top validation only', 'display_name': '1top (validation)'}
NS = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10'
UAP = 'http://schemas.microsoft.com/appx/manifest/uap/windows10'
RESCAP = 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities'


def validate_identity(value, channel):
    required = set(TEST_IDENTITY)
    if not isinstance(value, dict) or not required <= value.keys():
        raise ValueError('Copy the four identity values from Partner Center > Product identity')
    if not all(isinstance(value[k], str) and value[k].strip() == value[k] and value[k] for k in required):
        raise ValueError('Identity values must be nonempty strings with no surrounding whitespace')
    if not re.fullmatch(r'[A-Za-z0-9.-]{3,50}', value['name']):
        raise ValueError('Invalid Package/Identity/Name')
    if not value['publisher'].startswith('CN=') or len(value['publisher']) > 8192:
        raise ValueError('Invalid Package/Identity/Publisher')
    if any(len(value[k]) > 256 for k in ('publisher_display_name', 'display_name')):
        raise ValueError('Display names are too long')
    if channel == 'store' and (value['name'] == TEST_IDENTITY['name'] or value['publisher'] == TEST_IDENTITY['publisher']
                               or any(re.search(r'PLACEHOLDER|REPLACE_|YOUR_|<|>', value[k], re.I) for k in required)):
        raise ValueError('A Store build needs the real reserved identity, not a test or placeholder identity')
    return {k: value[k] for k in required}


def manifest(identity, version):
    parts = version.split('.')
    if len(parts) != 4 or not all(p.isdigit() and 0 <= int(p) <= 65535 for p in parts) or int(parts[0]) == 0 or parts[-1] != '0':
        raise ValueError('MSIX version must be Major.Minor.Patch.0, with each part <= 65535')
    ET.register_namespace('', NS)
    ET.register_namespace('uap', UAP)
    ET.register_namespace('rescap', RESCAP)
    pkg = ET.Element(f'{{{NS}}}Package', IgnorableNamespaces='uap rescap')
    def node(parent, name, text=None, **attrs):
        result = ET.SubElement(parent, f'{{{NS}}}{name}', attrs)
        result.text = text
        return result
    node(pkg, 'Identity', Name=identity['name'], Publisher=identity['publisher'], Version=version, ProcessorArchitecture='x64')
    properties = node(pkg, 'Properties')
    node(properties, 'DisplayName', identity['display_name'])
    node(properties, 'PublisherDisplayName', identity['publisher_display_name'])
    node(properties, 'Description', 'Your AI sessions, usage, and computer resources in one dashboard.')
    node(properties, 'Logo', r'Assets\StoreLogo.png')
    resources = node(pkg, 'Resources')
    for language in ('en-us', 'ko-kr'):
        node(resources, 'Resource', Language=language)
    dependencies = node(pkg, 'Dependencies')
    node(dependencies, 'TargetDeviceFamily', Name='Windows.Desktop', MinVersion='10.0.19041.0', MaxVersionTested='10.0.26100.0')
    apps = node(pkg, 'Applications')
    app = node(apps, 'Application', Id='OneTop', Executable=r'app\1top.exe', EntryPoint='Windows.FullTrustApplication')
    ET.SubElement(app, f'{{{UAP}}}VisualElements', {
        'DisplayName': identity['display_name'], 'Description': 'AI session and resource monitor',
        'Square150x150Logo': r'Assets\Square150x150Logo.png', 'Square44x44Logo': r'Assets\Square44x44Logo.png',
        'BackgroundColor': '#0C0F12'})
    caps = node(pkg, 'Capabilities')
    ET.SubElement(caps, f'{{{RESCAP}}}Capability', Name='runFullTrust')
    ET.indent(pkg)
    return ET.tostring(pkg, encoding='utf-8', xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', choices=('test', 'store'), required=True)
    parser.add_argument('--identity', type=Path)
    parser.add_argument('--version', default=__version__ + '.0')
    parser.add_argument('--output', type=Path, default=Path('build/windows/msix-stage'))
    args = parser.parse_args()
    if args.channel == 'store' and not args.identity:
        parser.error('--identity is required for Store builds; reserve the app in Partner Center first')
    value = json.loads(args.identity.read_text(encoding='utf-8-sig')) if args.identity else TEST_IDENTITY
    identity = validate_identity(value, args.channel)
    raw_manifest = manifest(identity, args.version)
    root = Path(__file__).resolve().parents[1]
    payload = root / 'build/windows/dist/1top'
    if not (payload / '1top.exe').is_file():
        raise FileNotFoundError('Run build-windows.ps1 before packaging')
    stage = args.output.resolve()
    # Only delete the staging directory owned by this build script.
    if stage != (root / 'build/windows/msix-stage').resolve():
        raise ValueError('The MSIX stage must be build/windows/msix-stage')
    if stage.exists():
        shutil.rmtree(stage)
    shutil.copytree(payload, stage / 'app')
    (stage / 'app/distribution.json').write_text(json.dumps({'channel': args.channel, 'identity': identity}), encoding='utf-8')
    (stage / 'AppxManifest.xml').write_bytes(raw_manifest)
    from PIL import Image
    assets = stage / 'Assets'
    assets.mkdir()
    with Image.open(root / 'site/public/brand/v1.1.0/icon.png') as icon:
        for filename, size in [('StoreLogo.png', 50), ('Square150x150Logo.png', 150), ('Square44x44Logo.png', 44),
                               ('Square44x44Logo.targetsize-44_altform-unplated.png', 44)]:
            icon.convert('RGBA').resize((size, size), Image.Resampling.LANCZOS).save(assets / filename)
    print(json.dumps({'channel': args.channel, 'version': args.version, 'identity': identity, 'stage': str(stage)}))


if __name__ == '__main__':
    main()
