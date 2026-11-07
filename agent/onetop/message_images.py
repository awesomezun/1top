"""Private photo attachments delivered to an existing local CLI session."""
import base64
import hashlib
import json
import os
import re
import struct
from pathlib import Path

MAX_BYTES = 524288
MAX_IMAGES = 3
MAX_STORE_BYTES = 128 * 1024 * 1024
RID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
DIGEST = re.compile(r'^[a-f0-9]{64}$')


def dimensions(data, mime):
    if mime == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 45:
        if data[12:16] == b'IHDR' and data[-12:] == b'\x00\x00\x00\x00IEND\xaeB`\x82':
            return struct.unpack('>II', data[16:24])
    if mime == 'image/jpeg' and data.startswith(b'\xff\xd8') and data.endswith(b'\xff\xd9'):
        pos = 2
        while pos + 4 <= len(data):
            if data[pos] != 255:break
            while pos < len(data) and data[pos] == 255:pos += 1
            if pos >= len(data):break
            marker = data[pos]; pos += 1
            if marker in (0xD9, 0xDA):break
            if marker == 0x01 or 0xD0 <= marker <= 0xD8:continue
            length = int.from_bytes(data[pos:pos+2], 'big')
            if length < 2 or pos + length > len(data):break
            if marker in (0xC0, 0xC1, 0xC2) and length >= 8:
                height, width = struct.unpack('>HH', data[pos+3:pos+7])
                return width, height
            pos += length
    raise ValueError('Attach a valid JPEG or PNG image.')


def decode_images(items):
    if not isinstance(items, list) or len(items) > MAX_IMAGES:
        raise ValueError('Attach up to 3 images.')
    result = []
    for item in items:
        if not isinstance(item, dict) or item.get('mime') not in ('image/jpeg', 'image/png'):
            raise ValueError('Only JPEG and PNG images are supported.')
        raw = item.get('data')
        if not isinstance(raw, str) or len(raw) > 4*((MAX_BYTES+2)//3):
            raise ValueError('Each image must be 512 KiB or smaller.')
        try:data = base64.b64decode(raw, validate=True)
        except (ValueError, TypeError):raise ValueError('Invalid image encoding.') from None
        if not data or len(data) > MAX_BYTES:raise ValueError('Each image must be 512 KiB or smaller.')
        width, height = dimensions(data, item['mime'])
        if not (0 < width <= 4096 and 0 < height <= 4096 and width*height <= 12000000):
            raise ValueError('Image dimensions are too large.')
        digest = hashlib.sha256(data).hexdigest()
        result.append({'id':digest, 'name':f'Image {len(result)+1}'+('.jpg' if item['mime']=='image/jpeg' else '.png'),
                       'mime':item['mime'], 'bytes':len(data), '_data':data})
    return result


def public_images(images):
    return [{k:row[k] for k in ('id','name','mime','bytes')} for row in images]


class ImageStore:
    def __init__(self, root):self.root = Path(root)

    def _path(self, rid, sid, row):
        if not RID.fullmatch(rid) or not DIGEST.fullmatch(row.get('id','')):
            raise ValueError('Invalid image reference.')
        suffix = {'image/jpeg':'.jpg', 'image/png':'.png'}.get(row.get('mime'))
        if not suffix:raise ValueError('Invalid image type.')
        scope = hashlib.sha256(sid.encode()).hexdigest()[:24]
        return self.root/f'{scope}-{rid}-{row["id"]}{suffix}'

    def stage(self, rid, sid, images):
        if not images:return []
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        if self.root.is_symlink():raise ValueError('Attachment storage is unavailable.')
        size = sum(p.stat().st_size for p in self.root.iterdir() if p.is_file() and not p.is_symlink())
        extra = sum({str(self._path(rid,sid,row)):len(row['_data']) for row in images if not self._path(rid,sid,row).exists()}.values())
        if size + extra > MAX_STORE_BYTES:raise ValueError('Local photo storage is full. Remove old files from the 1top attachments folder.')
        result = []
        for row in images:
            path = self._path(rid,sid,row)
            try:
                with os.fdopen(os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'wb') as stream:
                    stream.write(row['_data'])
            except FileExistsError:
                pass
            result.extend(self.restore(rid,sid,[{k:v for k,v in row.items() if k!='_data'}]))
        return result

    def restore(self, rid, sid, images):
        if len(images) > MAX_IMAGES:raise ValueError('Too many image references.')
        result = []
        for row in images:
            path = self._path(rid,sid,row)
            with os.fdopen(os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)), 'rb') as stream:
                data = stream.read(MAX_BYTES+1)
            if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['id']:
                raise ValueError('The stored image changed. Nothing sent.')
            result.append({**row,'_path':str(path.resolve())})
        return result


def image_prompt(text, images):
    if not images:return text
    paths = '\n'.join(json.dumps(row['_path'],ensure_ascii=False) for row in images)
    return text+'\n\nAttached images on this computer. Open these files to inspect them:\n'+paths
