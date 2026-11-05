#!/usr/bin/env python3
"""Inspect the pinned GD module without distributing any game code.

Use --slice to retain selected function bodies for local disassembly. The
result is deliberately NOT a playable game; unselected bodies trap.
"""
import argparse
import hashlib
import json
from pathlib import Path


class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def byte(self):
        value = self.data[self.pos]
        self.pos += 1
        return value

    def uint(self):
        value = shift = 0
        while True:
            byte = self.byte()
            value |= (byte & 127) << shift
            if byte < 128:
                return value
            shift += 7
            if shift > 70:
                raise ValueError('Invalid LEB128')

    def name(self):
        size = self.uint()
        value = self.data[self.pos:self.pos + size].decode()
        self.pos += size
        return value

    def sint(self):
        value = shift = 0
        while True:
            byte = self.byte()
            value |= (byte & 127) << shift
            shift += 7
            if byte < 128:
                return value - (1 << shift) if byte & 64 else value


def uint(value):
    result = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        result.append(byte | (128 if value else 0))
        if not value:
            return bytes(result)


def sections(data):
    if data[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('Not a version 1 WebAssembly module')
    reader = Reader(data)
    reader.pos = 8
    result = []
    while reader.pos < len(data):
        section_id, size = reader.byte(), reader.uint()
        payload = data[reader.pos:reader.pos + size]
        if len(payload) != size:
            raise ValueError('Truncated section')
        result.append((section_id, payload))
        reader.pos += size
    return result


def inspect(data):
    result = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
              'imports': [], 'exports': [], 'types': [], 'functionTypes': []}
    for section_id, payload in sections(data):
        reader = Reader(payload)
        if section_id == 1:
            for _ in range(reader.uint()):
                if reader.byte() != 0x60:
                    raise ValueError('Unexpected non-function type')
                params = [reader.byte() for _ in range(reader.uint())]
                returns = [reader.byte() for _ in range(reader.uint())]
                result['types'].append({'params': params, 'results': returns})
        elif section_id == 2:
            for _ in range(reader.uint()):
                module, name, kind = reader.name(), reader.name(), reader.byte()
                if kind != 0:
                    raise ValueError('This probe expects function-only imports')
                type_id = reader.uint()
                result['imports'].append({'module': module, 'name': name, 'type': type_id})
                result['functionTypes'].append(type_id)
        elif section_id == 3:
            result['functionTypes'].extend(reader.uint() for _ in range(reader.uint()))
        elif section_id == 7:
            for _ in range(reader.uint()):
                result['exports'].append({'name': reader.name(), 'kind': reader.byte(),
                                          'index': reader.uint()})
        elif section_id == 10:
            result['definedFunctions'] = reader.uint()
    return result


def data_segments(data):
    result = []
    for section_id, payload in sections(data):
        if section_id != 11:
            continue
        reader = Reader(payload)
        for _ in range(reader.uint()):
            flags = reader.uint()
            if flags == 2:
                assert reader.uint() == 0
            if flags == 1:
                address = None
            else:
                assert reader.byte() == 0x41
                address = reader.sint() & 0xffffffff
                assert reader.byte() == 0x0b
            size = reader.uint()
            result.append((address, payload[reader.pos:reader.pos + size]))
            reader.pos += size
    return result


def table_elements(data):
    result = {}
    for section_id, payload in sections(data):
        if section_id != 9:
            continue
        reader = Reader(payload)
        for _ in range(reader.uint()):
            assert reader.uint() == 0
            assert reader.byte() == 0x41
            offset = reader.sint()
            assert reader.byte() == 0x0b
            for index in range(reader.uint()):
                result[offset + index] = reader.uint()
    return result


def function_bodies(data):
    imported = len(inspect(data)['imports'])
    for section_id, payload in sections(data):
        if section_id != 10:
            continue
        reader = Reader(payload)
        result = {}
        for index in range(imported, imported + reader.uint()):
            size = reader.uint()
            result[index] = payload[reader.pos:reader.pos + size]
            reader.pos += size
        return result
    return {}


def slice_module(data, selected):
    output = bytearray(data[:8])
    imported = len(inspect(data)['imports'])
    for section_id, payload in sections(data):
        if section_id == 10:
            reader = Reader(payload)
            count = reader.uint()
            parts = [uint(count)]
            for index in range(imported, imported + count):
                size = reader.uint()
                body = payload[reader.pos:reader.pos + size]
                reader.pos += size
                if index not in selected:
                    body = b'\x00\x00\x0b'  # no locals; unreachable; end
                parts.extend((uint(len(body)), body))
            payload = b''.join(parts)
        output.extend(bytes([section_id]) + uint(len(payload)) + payload)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('module', type=Path)
    parser.add_argument('--slice', type=Path)
    parser.add_argument('--functions', default='')
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    data = args.module.read_bytes()
    result = inspect(data)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2) + '\n')
    if args.slice:
        selected = {int(x) for x in args.functions.split(',') if x}
        args.slice.write_bytes(slice_module(data, selected))
    print(json.dumps({'sha256': result['sha256'], 'bytes': len(data),
                      'imports': len(result['imports']),
                      'definedFunctions': result['definedFunctions'],
                      'gameExports': [x for x in result['exports'] if x['name'].startswith('gd_')]}))


if __name__ == '__main__':
    main()
